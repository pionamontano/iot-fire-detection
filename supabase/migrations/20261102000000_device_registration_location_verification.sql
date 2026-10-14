-- =============================================================
-- Device registration no longer asks the admin for a device code,
-- an install address, coordinates or thresholds:
--
--   * register_device() generates the next device code (AGS-001,
--     AGS-002, ...) and returns it together with the new API key, so
--     the admin can enter both in the node's Wi-Fi setup portal. The
--     API key is otherwise only ever visible through
--     regenerate_device_api_key() (20260924000000) - authenticated has
--     no SELECT grant on devices.api_key (20261015000000).
--   * Thresholds come from the column defaults (temp 60, CO 200).
--   * The install address and pin are set later by the resident the
--     device is linked to (update_own_device_location() below), so
--     location_desc may now be empty until they do.
--
-- A pin the resident places is a claim, not a fact, and it is the
-- position responders are sent to when the device has no GPS fix.
-- devices.location_verified records whether an admin has confirmed
-- it. The trigger below keeps that flag honest: any change to the
-- address or pin made by a non-admin user resets it to false, and
-- only an admin can set it to true. Backend contexts with no
-- auth.uid() (service role, SQL editor, seed scripts) are trusted as
-- before and may set it directly.
-- =============================================================

-- ── Location may be unset until the resident provides it ────────
ALTER TABLE devices ALTER COLUMN location_desc DROP NOT NULL;

-- ── Verification state ───────────────────────────────────────────
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS location_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS location_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS location_verified_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- Every pin that exists today was entered by an admin on the
-- registration form, or came from the device's own GPS through an
-- approved address discrepancy (resolve_address_discrepancy), so the
-- existing pins are treated as confirmed.
UPDATE devices
SET location_verified = true,
    location_verified_at = now()
WHERE latitude IS NOT NULL AND longitude IS NOT NULL
  AND NOT location_verified;

create or replace function public.devices_location_verification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_location_changed boolean;
begin
  -- ingest-reading touches last_seen_at on every telemetry post (service role, no auth.uid()),
  -- so only look the role up when there is a signed-in user.
  if v_uid is not null then
    v_is_admin := coalesce(public.get_auth_role() = 'admin', false);
  end if;

  if tg_op = 'INSERT' then
    v_location_changed := true;
  else
    v_location_changed :=
      new.location_desc is distinct from old.location_desc
      or new.latitude is distinct from old.latitude
      or new.longitude is distinct from old.longitude;
  end if;

  if v_uid is not null and not v_is_admin then
    -- A resident (always through a SECURITY DEFINER RPC - residents
    -- have no UPDATE grant on devices) can never confirm their own
    -- location, and moving it withdraws an earlier confirmation.
    if v_location_changed then
      new.location_verified := false;
    else
      new.location_verified := old.location_verified;
    end if;
  end if;

  if not new.location_verified then
    new.location_verified_at := null;
    new.location_verified_by := null;
  elsif tg_op = 'INSERT' or not old.location_verified or v_location_changed then
    new.location_verified_at := now();
    new.location_verified_by := v_uid;
  else
    new.location_verified_at := old.location_verified_at;
    new.location_verified_by := old.location_verified_by;
  end if;

  return new;
end;
$$;

drop trigger if exists devices_location_verification on public.devices;
create trigger devices_location_verification
  before insert or update on public.devices
  for each row execute function public.devices_location_verification();

-- ── Device code generation ───────────────────────────────────────
create sequence if not exists public.device_code_seq;

-- Continue after the highest existing AGS-NNN code.
select setval(
  'public.device_code_seq',
  greatest(coalesce((
    select max(substring(device_code from '^AGS-(\d+)$')::bigint)
    from devices
    where device_code ~ '^AGS-\d+$'
  ), 0), 1),
  coalesce((select bool_or(device_code ~ '^AGS-\d+$') from devices), false)
);

revoke all on sequence public.device_code_seq from public, anon, authenticated;

create or replace function public.register_device(p_label text default null)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
  v_label text;
  v_id uuid;
  v_key text;
begin
  if coalesce(public.get_auth_role(), '') <> 'admin' then
    raise exception 'Only an admin can register a device';
  end if;

  v_label := nullif(trim(coalesce(p_label, '')), '');
  if v_label is not null and length(v_label) > 100 then
    raise exception 'Device name must be 100 characters or fewer';
  end if;

  -- Skip any code that was created by hand outside this function.
  loop
    v_code := 'AGS-' || lpad(nextval('public.device_code_seq')::text, 3, '0');
    exit when not exists (select 1 from devices where device_code = v_code);
  end loop;

  -- api_key comes from the column default (CSPRNG via pgcrypto),
  -- thresholds from their column defaults.
  insert into devices (device_code, label)
  values (v_code, coalesce(v_label, v_code))
  returning id, api_key into v_id, v_key;

  -- Only these three fields, never the devices row: a SECURITY DEFINER
  -- composite return would bypass the column grants (see
  -- 20261028000000_resident_update_device_address_rpc.sql).
  return json_build_object('id', v_id, 'device_code', v_code, 'api_key', v_key);
end;
$$;

revoke all on function public.register_device(text) from public, anon;
grant execute on function public.register_device(text) to authenticated;

-- ── Resident sets their own address and pin ──────────────────────
-- Same narrow pattern as update_own_device_location_desc
-- (20261028000000): the device is derived from the caller's own
-- profile, never a client-supplied id. The trigger above marks the
-- result unverified.
create or replace function public.update_own_device_location(
  p_location_desc text,
  p_latitude double precision,
  p_longitude double precision
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_device_id uuid;
  v_desc text;
begin
  select device_id into v_device_id
  from profiles
  where id = auth.uid() and role = 'resident' and status = 'approved' and is_active;

  if v_device_id is null then
    raise exception 'No device linked to an approved resident account';
  end if;

  v_desc := trim(coalesce(p_location_desc, ''));
  if v_desc = '' then
    raise exception 'Address cannot be empty';
  end if;
  if length(v_desc) > 200 then
    raise exception 'Address must be 200 characters or fewer';
  end if;

  if p_latitude is null or p_longitude is null
     or p_latitude = 'NaN'::double precision or p_longitude = 'NaN'::double precision
     or p_latitude < -90 or p_latitude > 90
     or p_longitude < -180 or p_longitude > 180
     or (p_latitude = 0 and p_longitude = 0) then
    raise exception 'A valid map pin is required';
  end if;

  update devices
  set location_desc = v_desc,
      latitude = p_latitude,
      longitude = p_longitude
  where id = v_device_id;

  return (
    select json_build_object(
      'location_desc', location_desc,
      'latitude', latitude,
      'longitude', longitude,
      'location_verified', location_verified
    )
    from devices where id = v_device_id
  );
end;
$$;

revoke all on function public.update_own_device_location(text, double precision, double precision) from public, anon;
grant execute on function public.update_own_device_location(text, double precision, double precision) to authenticated;

-- ── Column grants and view ───────────────────────────────────────
-- Restates the complete list (see 20261024000000 for why).
-- location_verified_by is not exposed: the UI only needs whether and when.
GRANT SELECT (
  id, device_code, label, location_desc, co_threshold, temp_threshold,
  bfp_contact, is_active, created_at, last_seen_at, latitude, longitude,
  local_ip, firmware_version, firmware_url, firmware_md5, firmware_version_reported,
  location_verified, location_verified_at
) ON public.devices TO authenticated;

create or replace view public.devices_safe
with (security_invoker = true) as
select
  d.id,
  d.device_code,
  d.label,
  d.location_desc,
  get_device_api_key_secure(d.id) as api_key,
  d.co_threshold,
  d.temp_threshold,
  d.bfp_contact,
  d.is_active,
  d.created_at,
  d.last_seen_at,
  d.latitude,
  d.longitude,
  d.local_ip,
  d.firmware_version,
  d.firmware_url,
  d.firmware_md5,
  d.firmware_version_reported,
  d.location_verified,
  d.location_verified_at
from public.devices d
left join public.profiles p on p.id = auth.uid()
where
  p.role in ('admin', 'bfp_responder')
  or (
    p.role = 'resident'
    and d.id = p.device_id
  );

grant select on public.devices_safe to authenticated;

-- =============================================================
-- Let a resident edit their own device's registered address text
-- (e.g. add unit/floor detail) directly, not only through approving
-- a system-detected GPS discrepancy (resolve_address_discrepancy,
-- 20261016000000). Residents have no UPDATE grant on devices at all
-- (20260924040000_restrict_devices_base_table_to_admin.sql), so this
-- follows the same narrow-RPC pattern as
-- update_own_device_alert_settings (20260917080000): the target
-- device is derived from the caller's own profile, never a
-- client-supplied device id, and only location_desc is touched -
-- latitude/longitude (the GPS side of the location) are untouched,
-- so this can never be used to fake a device's registered position.
--
-- Returns only the new location_desc, not the devices row: devices_safe
-- masks api_key via get_device_api_key_secure() and column-level GRANTs
-- withhold the raw column from residents entirely, but a SECURITY
-- DEFINER function's composite-type return bypasses both, so `returning
-- *`/`returns public.devices` here would hand the raw api_key straight
-- back to the resident's client.
-- =============================================================

create or replace function public.update_own_device_location_desc(
  p_location_desc text
)
returns text
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
  where id = auth.uid() and role = 'resident' and status = 'approved';

  if v_device_id is null then
    raise exception 'No device linked to an approved resident account';
  end if;

  v_desc := trim(p_location_desc);
  if v_desc = '' then
    raise exception 'Location description cannot be empty';
  end if;
  if length(v_desc) > 200 then
    raise exception 'Location description must be 200 characters or fewer';
  end if;

  update devices
  set location_desc = v_desc
  where id = v_device_id;

  return v_desc;
end;
$$;

revoke all on function public.update_own_device_location_desc(text) from public, anon;
grant execute on function public.update_own_device_location_desc(text) to authenticated;

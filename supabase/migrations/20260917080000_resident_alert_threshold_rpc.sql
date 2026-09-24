-- =============================================================
-- NEW-01 fix: ResidentAlertSettings.tsx lets a resident tune their
-- own device's temp_threshold/co_threshold, but there is no RLS
-- UPDATE policy granting residents any write access to devices at
-- all (only "Admin full access on devices" covers UPDATE) - the
-- save call was already broken by RLS.
--
-- A bare UPDATE policy scoped to "your own device" isn't safe here:
-- Postgres RLS is row-level, not column-level, so it can't stop a
-- resident's UPDATE from also touching device_code, api_key,
-- is_active, or bfp_contact (the fire station's own contact number,
-- used by gsmSendBfpSms() for real Tier 2 dispatch - see the
-- accompanying frontend fix, which stops this page from touching
-- that column at all).
--
-- Fix: a narrow SECURITY DEFINER function that only ever touches
-- temp_threshold/co_threshold, derives the target device from the
-- caller's own profile (never a client-supplied device id), and
-- enforces the same bounds the UI's sliders already promise
-- (0-100 C, 0-1000 ppm) as defense in depth.
-- =============================================================

create or replace function public.update_own_device_alert_settings(
  p_temp_threshold double precision,
  p_co_threshold integer
)
returns public.devices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device_id uuid;
  v_result public.devices;
begin
  select device_id into v_device_id
  from profiles
  where id = auth.uid() and role = 'resident' and status = 'approved';

  if v_device_id is null then
    raise exception 'No device linked to an approved resident account';
  end if;

  if p_temp_threshold is null or p_temp_threshold < 0 or p_temp_threshold > 100 then
    raise exception 'temp_threshold must be between 0 and 100';
  end if;

  if p_co_threshold is null or p_co_threshold < 0 or p_co_threshold > 1000 then
    raise exception 'co_threshold must be between 0 and 1000';
  end if;

  update devices
  set temp_threshold = p_temp_threshold,
      co_threshold = p_co_threshold
  where id = v_device_id
  returning * into v_result;

  return v_result;
end;
$$;

grant execute on function public.update_own_device_alert_settings(double precision, integer) to authenticated;

CREATE OR REPLACE FUNCTION get_device_api_key_secure(d_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role TEXT;
  v_api_key TEXT;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role = 'admin' THEN
    SELECT api_key INTO v_api_key FROM devices WHERE id = d_id;
    RETURN v_api_key;
  END IF;
  RETURN NULL;
END;
$$;

-- Drop the view first because we are changing the underlying table permissions
DROP VIEW IF EXISTS public.devices_safe;

-- Revoke select on the whole table for authenticated users
REVOKE SELECT ON public.devices FROM authenticated;

-- Grant select on all columns EXCEPT api_key to authenticated users
GRANT SELECT (id, device_code, label, location_desc, co_threshold, temp_threshold, bfp_contact, is_active, created_at, last_seen_at, latitude, longitude, local_ip) ON public.devices TO authenticated;

-- Restore the policies that were removed in 20260924040000_restrict_devices_base_table_to_admin.sql
DROP POLICY IF EXISTS "BFP Responder can read devices" ON public.devices;
CREATE POLICY "BFP Responder can read devices"
  ON public.devices FOR SELECT USING (get_auth_role() = 'bfp_responder');

DROP POLICY IF EXISTS "Resident can read own device" ON public.devices;
CREATE POLICY "Resident can read own device"
  ON public.devices FOR SELECT USING (
    get_auth_role() = 'resident'
    AND id = (SELECT device_id FROM profiles WHERE profiles.id = auth.uid())
  );

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
  d.local_ip
from public.devices d
left join public.profiles p on p.id = auth.uid()
where
  p.role in ('admin', 'bfp_responder')
  or (
    p.role = 'resident'
    and d.id = p.device_id
  );

grant select on public.devices_safe to authenticated;

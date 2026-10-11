-- =============================================================
-- FIX: Allow admin to SELECT * on the devices base table.
-- The previous migration (20261015000000) used column-level grants
-- which broke `SELECT *` from PostgREST for all roles, including admins,
-- because `authenticated` role lacked SELECT on `api_key`.
--
-- We drop the non-admin RLS policies from `devices` base table,
-- grant SELECT on all columns back to `authenticated`, and
-- change `devices_safe` to a SECURITY DEFINER view (security_invoker = off)
-- so that non-admins can query `devices_safe` without needing direct
-- access to the `devices` base table.
-- =============================================================

-- Drop the view first to change permissions
DROP VIEW IF EXISTS public.devices_safe;

-- Restore full SELECT access to authenticated role so `SELECT *` works
GRANT SELECT ON public.devices TO authenticated;

-- Drop the non-admin RLS policies from the base table so non-admins cannot query it directly
DROP POLICY IF EXISTS "BFP Responder can read devices" ON public.devices;
DROP POLICY IF EXISTS "Resident can read own device" ON public.devices;

-- Ensure the admin policy exists (it should already from init, but good to be explicit)
-- It is already: CREATE POLICY "Admin full access on devices" ON devices FOR ALL USING (get_auth_role() = 'admin');

-- Recreate devices_safe as SECURITY DEFINER (security_invoker = false)
-- This allows non-admins to read from devices_safe even though they can no longer read from devices directly.
CREATE OR REPLACE VIEW public.devices_safe
WITH (security_invoker = off) AS
SELECT
  d.id,
  d.device_code,
  d.label,
  d.location_desc,
  CASE WHEN p.role = 'admin' THEN d.api_key ELSE NULL END AS api_key,
  d.co_threshold,
  d.temp_threshold,
  d.bfp_contact,
  d.is_active,
  d.created_at,
  d.last_seen_at,
  d.latitude,
  d.longitude,
  d.local_ip
FROM public.devices d
LEFT JOIN public.profiles p ON p.id = auth.uid()
WHERE
  p.role IN ('admin', 'bfp_responder')
  OR (
    p.role = 'resident'
    AND d.id = p.device_id
  );

GRANT SELECT ON public.devices_safe TO authenticated;

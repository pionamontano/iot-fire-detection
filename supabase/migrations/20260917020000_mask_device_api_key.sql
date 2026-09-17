-- =============================================================
-- HIGH-01 fix: RLS is row-level, not column-level. The existing
-- "BFP Responder can read devices" and "Resident can read own
-- device" SELECT policies correctly scope which ROWS are visible,
-- but every visible row is returned in full — including the
-- plaintext api_key column, which is the sole authentication
-- secret for IoT ingestion/alert endpoints. Any responder can read
-- every device's api_key; a resident can read their own device's.
--
-- Postgres column-level GRANTs can't fix this because admin,
-- bfp_responder and resident are all just app-level values in
-- profiles.role - at the Postgres connection level they're all the
-- same "authenticated" role, so a column grant can't distinguish
-- between them.
--
-- Fix: a security_invoker view that runs with the caller's own
-- privileges (so the base table's row-level RLS policies still
-- apply unchanged) and additionally masks api_key to NULL unless
-- the caller's app role is 'admin'. Non-admin frontend reads
-- (Responder/Resident pages) should query devices_safe instead of
-- devices. Admin-only pages (Devices.tsx, Dashboard.tsx, Alerts.tsx,
-- InteractiveMap.tsx, Logs.tsx, Users.tsx) keep reading the base
-- devices table directly, and device creation/writes still go
-- through the base table (this view is not writable).
-- =============================================================

create or replace view public.devices_safe
with (security_invoker = on) as
select
  id,
  device_code,
  label,
  location_desc,
  case when public.get_auth_role() = 'admin' then api_key else null end as api_key,
  co_threshold,
  temp_threshold,
  bfp_contact,
  is_active,
  created_at,
  last_seen_at
from public.devices;

grant select on public.devices_safe to authenticated;

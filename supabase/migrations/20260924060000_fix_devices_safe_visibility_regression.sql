-- =============================================================
-- Regression fix: 20260924040000 closed the api_key masking bypass
-- by dropping the non-admin SELECT policies ("BFP Responder can
-- read devices", "Resident can read own device") from the base
-- `devices` table. That was correct for the base table, but
-- devices_safe is a `security_invoker` view - its own row
-- visibility depends entirely on the CALLING role's RLS/grants on
-- the base table. With those policies gone, a resident or responder
-- querying devices_safe now gets ZERO rows, not just a masked
-- api_key - the whole non-admin device-read path broke.
--
-- Confirmed live with disposable resident and responder test
-- accounts: devices_safe returned [] for both, immediately after
-- 20260924040000 was applied.
--
-- Fix: switch devices_safe to a non-invoker view. A non-invoker view
-- runs with the view owner's privileges against the base table
-- (bypassing the caller's own RLS/grants on `devices` entirely -
-- the same mechanism that made column masking necessary in the
-- first place), so the view now does its own row-scoping directly
-- in its WHERE clause instead of relying on the base table's RLS to
-- do it. This is the same row-scoping logic the two dropped
-- policies used to express. api_key masking (the CASE expression)
-- is unchanged. The base `devices` table still has zero non-admin
-- SELECT policies - devices_safe no longer needs the caller to have
-- any privilege on it at all to return the right rows.
-- =============================================================

create or replace view public.devices_safe
with (security_invoker = off) as
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
  last_seen_at,
  latitude,
  longitude
from public.devices
where
  public.get_auth_role() in ('admin', 'bfp_responder')
  or (
    public.get_auth_role() = 'resident'
    and id = (select device_id from public.profiles where profiles.id = auth.uid())
  );

grant select on public.devices_safe to authenticated;

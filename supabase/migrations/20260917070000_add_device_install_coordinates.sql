-- =============================================================
-- LOW-02 fix: the Device TypeScript interface and the admin device
-- creation form (Devices.tsx) both already have latitude/longitude
-- fields, but the devices table never had matching columns - the
-- form silently dropped them before insert. InteractiveMap.tsx
-- compensated by fabricating a fake position for every device from
-- a hash of its id, since d.latitude/d.longitude were always
-- undefined from a real query. That made the admin map show
-- plausible-looking but entirely fictional device locations.
--
-- Adds the real columns (nullable - a device may not have a known
-- install location yet) so the form's values actually persist and
-- the map can show real positions instead of fabricated ones.
-- =============================================================

alter table public.devices
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

-- Keep devices_safe (added in 20260917020000_mask_device_api_key.sql)
-- in sync with the base table's columns now that these two exist.
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
  last_seen_at,
  latitude,
  longitude
from public.devices;

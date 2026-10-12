-- =============================================================
-- OTA firmware support: lets an admin point a device at a new
-- firmware build (hosted in Supabase Storage) without a physical
-- re-flash. get-device-config already returns runtime thresholds
-- and contacts on the firmware's existing poll cycle; this adds
-- the same pattern for firmware distribution.
--
-- firmware_version is compared by the firmware against its
-- compiled-in FIRMWARE_VERSION; a mismatch triggers a download of
-- firmware_url and a flash via the ESP32 Update library.
-- =============================================================

ALTER TABLE devices ADD COLUMN IF NOT EXISTS firmware_version TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS firmware_url TEXT;

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
  longitude,
  local_ip,
  firmware_version,
  firmware_url
from public.devices
where
  public.get_auth_role() in ('admin', 'bfp_responder')
  or (
    public.get_auth_role() = 'resident'
    and id = (select device_id from public.profiles where profiles.id = auth.uid())
  );

grant select on public.devices_safe to authenticated;

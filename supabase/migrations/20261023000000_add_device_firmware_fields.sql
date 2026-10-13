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
-- firmware_md5 (hex, 32 chars) is optional but recommended: when
-- set, the firmware verifies it via Update.setMD5() before
-- activating the new image, so a corrupted download or a wrong/
-- unexpected binary at firmware_url is rejected rather than
-- flashed. HTTPS alone only proves the download came from
-- Supabase, not that the binary is the one actually built.
--
-- Builds on 20261015000000_fix_devices_safe_security_invoker.sql's
-- devices_safe definition (security_invoker = true, single
-- profiles join, get_device_api_key_secure() masking) rather than
-- the older pre-fix shape, so the RLS-bypass that migration closed
-- stays closed. The new columns also need an explicit column-level
-- GRANT on the base table, since a security_invoker view enforces
-- the querying user's own privileges.
-- =============================================================

ALTER TABLE devices ADD COLUMN IF NOT EXISTS firmware_version TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS firmware_url TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS firmware_md5 TEXT;

GRANT SELECT (firmware_version, firmware_url, firmware_md5) ON public.devices TO authenticated;

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
  d.firmware_md5
from public.devices d
left join public.profiles p on p.id = auth.uid()
where
  p.role in ('admin', 'bfp_responder')
  or (
    p.role = 'resident'
    and d.id = p.device_id
  );

grant select on public.devices_safe to authenticated;

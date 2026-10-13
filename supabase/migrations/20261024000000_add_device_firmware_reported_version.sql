-- =============================================================
-- firmware_version_reported: the version the device actually told
-- us it's running, via ingest-reading's telemetry payload — distinct
-- from firmware_version, which is the target an admin wants it on.
-- Lets the admin UI show "running vX / target vY" instead of
-- assuming an OTA push succeeded just because it was requested.
--
-- Also fixes a bug in 20261023000000_add_device_firmware_fields.sql:
-- that migration's GRANT SELECT only listed the 3 columns it was
-- adding (firmware_version, firmware_url, firmware_md5), not the
-- full column set. tests/device-columns.test.ts compares
-- DEVICE_COLUMN_LIST against only the LATEST migration's
-- GRANT SELECT list (migrations are additive in Postgres, but the
-- test has no way to know that without re-deriving the grant list
-- itself), so every migration that touches this grant must restate
-- the complete list of selectable columns, not just the new ones.
-- =============================================================

ALTER TABLE devices ADD COLUMN IF NOT EXISTS firmware_version_reported TEXT;

GRANT SELECT (
  id, device_code, label, location_desc, co_threshold, temp_threshold,
  bfp_contact, is_active, created_at, last_seen_at, latitude, longitude,
  local_ip, firmware_version, firmware_url, firmware_md5, firmware_version_reported
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
  d.firmware_version_reported
from public.devices d
left join public.profiles p on p.id = auth.uid()
where
  p.role in ('admin', 'bfp_responder')
  or (
    p.role = 'resident'
    and d.id = p.device_id
  );

grant select on public.devices_safe to authenticated;

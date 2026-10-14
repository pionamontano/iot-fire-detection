// Explicit column list for reads of the base `public.devices` table.
//
// WHY: migration 20261015000000_fix_devices_safe_security_invoker.sql revokes table-wide SELECT on
// `devices` from the `authenticated` role and grants SELECT on specific columns only (`api_key` is
// deliberately NOT granted). Postgres expands `select('*')` / an embedded `devices(*)` to every column
// and checks privilege on each one, so a wildcard read fails with "permission denied" (SQLSTATE 42501)
// for ANY authenticated user - admins included (role-level grants cannot tell admin from resident).
//
// RULES:
//  * Use DEVICE_COLUMNS wherever the app reads `devices` directly (admin pages). Non-admin pages read
//    the `devices_safe` view instead.
//  * Never add `api_key` here. Admins obtain a new key only through the regenerate_device_api_key RPC.
//  * This list must equal the column list in the latest `GRANT SELECT (...) ON public.devices` migration.
//    tests/device-columns.test.ts enforces that and bans wildcard reads of `devices`.
//    If a grant changes, change both together.
//  * Verified against the repository's migrations only. The LIVE project's grants have NOT been inspected.
//
// Column -> why the admin UI needs it (grep evidence in src/pages/admin/*):
//   id             row identity, joins to alert_events/sensor_readings/profiles (all pages)
//   device_code    shown/searched everywhere; Users assign-device dropdown
//   label          device name shown in Dashboard, Devices, Alerts, Map
//   location_desc  address text in Devices, Alerts, Logs, Map popups/search
//   co_threshold   Devices edit form                                         (Devices)
//   temp_threshold Devices edit form                                         (Devices)
//   bfp_contact    Devices edit form                                         (Devices)
//   is_active      status badge/power toggle (Dashboard, Alerts, Map)
//   created_at     ordering and "registered" logs (Dashboard, Devices, Alerts, Users, Logs)
//   last_seen_at   connectivity status via deviceStatus.ts (Dashboard, Alerts, Map)
//   latitude       registered install coordinates (Devices form, Map)
//   longitude      registered install coordinates (Devices form, Map)
//   local_ip       Device type / Devices page
//   firmware_version          OTA target version admin sets         (Devices edit form)
//   firmware_url               OTA target .bin location               (Devices edit form)
//   firmware_md5                OTA target .bin integrity check         (Devices edit form)
//   firmware_version_reported  version the device last reported running (Devices edit form, read-only)
//   location_verified          admin confirmed the resident's pin (Devices list badge + edit form, maps)
//   location_verified_at       when it was confirmed                  (Devices edit form)
export const DEVICE_COLUMN_LIST = [
  'id',
  'device_code',
  'label',
  'location_desc',
  'co_threshold',
  'temp_threshold',
  'bfp_contact',
  'is_active',
  'created_at',
  'last_seen_at',
  'latitude',
  'longitude',
  'local_ip',
  'firmware_version',
  'firmware_url',
  'firmware_md5',
  'firmware_version_reported',
  'location_verified',
  'location_verified_at',
] as const;

/** Comma-separated form for PostgREST `select(...)`, e.g. `select(DEVICE_COLUMNS)`. */
export const DEVICE_COLUMNS: string = DEVICE_COLUMN_LIST.join(',');

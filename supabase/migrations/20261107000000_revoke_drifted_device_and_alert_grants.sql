-- =============================================================
-- Bring production's grants on devices and alert_events back to what
-- the migrations intend.
--
-- A production ACL dump (2026-10-15) showed privileges that earlier
-- migrations had revoked, or never meant to hand out:
--   * devices: table-wide SELECT for anon and authenticated. 20261015000000
--     replaced authenticated's table-wide SELECT with a column list that
--     leaves out api_key; anon never reads devices.
--   * alert_events: INSERT and UPDATE for anon and authenticated, plus
--     column UPDATE for authenticated. Revoked in 20260917010000 (INSERT),
--     20261012000001 / 20261022000000 (UPDATE). Incidents are written only
--     by the service role (trigger-alert, ingest-reading,
--     confirm-sms-status) and changed by clients only through
--     transition_incident() (SECURITY DEFINER).
--   * devices_safe: INSERT/UPDATE/DELETE for anon and authenticated. The
--     view is a join and not updatable; SELECT is all it needs.
-- RLS already kept these from matching rows, so this restores defence in
-- depth rather than closing an open hole. On a stack built from the
-- migrations (local, CI, new projects) every statement is a no-op.
--
-- Note: a table-level REVOKE SELECT also removes column-level SELECT
-- grants, so authenticated's column list is granted again right after.
-- It must stay equal to DEVICE_COLUMNS in src/lib/deviceColumns.ts.
--
-- Rollback:
--   grant select on public.devices to anon, authenticated;
--   grant insert, update on public.alert_events to anon, authenticated;
--   grant insert, update, delete on public.devices_safe to anon, authenticated;
-- =============================================================

revoke select on public.devices from anon, authenticated;
grant select (
  id, device_code, label, location_desc, co_threshold, temp_threshold, bfp_contact, is_active,
  created_at, last_seen_at, latitude, longitude, local_ip,
  firmware_version, firmware_url, firmware_md5, firmware_version_reported,
  location_verified, location_verified_at
) on public.devices to authenticated;

revoke insert, update on public.alert_events from anon, authenticated;

revoke insert, update, delete on public.devices_safe from anon, authenticated;

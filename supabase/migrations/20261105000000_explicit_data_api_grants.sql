-- =============================================================
-- Explicit Data API grants.
--
-- Every earlier migration was written for a Supabase project whose
-- default privileges auto-granted new public tables, sequences and
-- functions to anon / authenticated / service_role; the migrations only
-- REVOKE what they want hidden. Supabase has dropped that default (new
-- cloud projects, and local stacks from CLI v2.11x: the
-- `auto_expose_new_tables` opt-out is removed on 2026-10-30). Built from
-- these migrations alone, a fresh project or `supabase start` grants the
-- API roles nothing: every PostgREST call, every RPC and even the
-- service-role Edge Functions fail with "permission denied".
--
-- This migration states the intended grants explicitly, so the schema no
-- longer depends on the platform default. It is GRANT-only and every
-- grant below is already held in production (checked against a dump of
-- production's ACLs on 2026-10-15), so applying it there changes nothing.
--
-- It grants what the earlier migrations intend, which is in places LESS
-- than production currently holds (production has drifted; those gaps are
-- deliberately not reproduced here):
--   * devices: authenticated gets column-level SELECT only (20261015000000
--     revoked table-wide SELECT so api_key stays unreadable).
--   * alert_events: anon/authenticated get SELECT only (INSERT revoked in
--     20260917010000, UPDATE in 20261012000001/20261022000000, DELETE and
--     TRUNCATE in 20261101000000).
-- (Not fixed here, so that this migration stays a no-op in production:
-- 20260924080000 revoked check_login_lockout from anon/authenticated but
-- not from PUBLIC. 20261106000000 closes that.)
-- Only the privileges the Data API uses are granted (SELECT/INSERT/UPDATE/
-- DELETE, sequence USAGE/SELECT/UPDATE, function EXECUTE); RLS remains the
-- row-level boundary for every table.
--
-- From now on, a migration that creates a table, view, sequence or
-- function must GRANT it to the roles that need it.
-- =============================================================

-- ── Tables: full DML for all API roles, RLS decides the rows ──
grant select, insert, update, delete on
  public.address_discrepancies,
  public.firmware_releases,
  public.login_lockout_overrides,
  public.profiles,
  public.push_subscriptions,
  public.registration_requests,
  public.settings,
  public.station_settings,
  public.support_requests
to anon, authenticated, service_role;

-- ── Tables written only by Edge Functions / SECURITY DEFINER RPCs ──
grant select, update, delete on public.login_attempts, public.sensor_readings to anon, authenticated;
grant select, insert, update, delete on public.login_attempts, public.sensor_readings to service_role;

grant select on public.alert_events to anon, authenticated;
grant select, insert, update, delete on public.alert_events to service_role;

grant select, insert, update, delete on public.alert_notifications, public.telegram_link_tokens to service_role;

-- ── devices: api_key column hidden from authenticated (read devices_safe instead) ──
grant select, insert, update, delete on public.devices to anon, service_role;
grant insert, update, delete on public.devices to authenticated;
grant select (
  id, device_code, label, location_desc, co_threshold, temp_threshold, bfp_contact, is_active,
  created_at, last_seen_at, latitude, longitude, local_ip,
  firmware_version, firmware_url, firmware_md5, firmware_version_reported,
  location_verified, location_verified_at
) on public.devices to authenticated;

grant select on public.devices_safe to anon, authenticated, service_role;

grant usage, select, update on sequence public.device_code_seq to service_role;

-- ── Functions callable by every API role (each checks the caller itself) ──
grant execute on function
  public.get_auth_role(),
  public.admin_unlock_login(text),
  public.get_device_api_key_secure(uuid),
  public.regenerate_device_api_key(uuid),
  public.update_own_device_alert_settings(double precision, integer),
  public.alert_events_lifecycle_guard(),
  public.devices_location_verification(),
  public.protect_profile_fields()
to anon, authenticated, service_role;

-- ── Functions for signed-in users only ──
grant execute on function
  public.create_telegram_link_token(),
  public.get_dashboard_stats(),
  public.get_incident_resident_contact(uuid),
  public.is_approved_admin(),
  public.register_device(text),
  public.resolve_address_discrepancy(uuid, text, text, text, text, text, text, text),
  public.transition_incident(uuid, text, text),
  public.update_own_device_location(text, double precision, double precision),
  public.update_own_device_location_desc(text)
to authenticated, service_role;

-- ── Service-role only (Edge Functions) ──
grant execute on function
  public.check_login_lockout(text),
  public.claim_notification(uuid, integer, text, text, integer, interval),
  public.complete_notification(uuid, integer, text, text, text, text, text, text, boolean),
  public.raise_alert(uuid, integer, double precision, double precision, double precision, double precision, boolean, text)
to service_role;

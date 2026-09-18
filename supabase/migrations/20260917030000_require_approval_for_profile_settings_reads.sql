-- =============================================================
-- HIGH-03 fix: profiles, settings, and station_settings all had a
-- SELECT policy scoped to `auth.role() = 'authenticated'` rather
-- than going through get_auth_role(). Unlike every other
-- authenticated-tier policy in this schema, that check doesn't
-- require profiles.status = 'approved' - so a pending or rejected
-- account (who can still log in, just can't navigate the app past
-- AuthGuard) could read every user's full profile row (name, phone,
-- address, device link), system settings, and station contact info
-- directly via the REST API.
--
-- Fix: swap the bare auth.role() check for get_auth_role() IS NOT
-- NULL, matching the pattern already used on devices/sensor_readings
-- /alert_events. get_auth_role() returns NULL for any non-approved
-- user regardless of role, and the actual role value for any
-- approved admin/bfp_responder/resident - so this only removes
-- access for pending/rejected accounts, no one else.
-- =============================================================

drop policy if exists "Authenticated users can read profiles" on public.profiles;
create policy "Approved users can read profiles"
  on public.profiles
  for select
  using (get_auth_role() is not null);

drop policy if exists "Anyone authenticated can read settings" on public.settings;
create policy "Approved users can read settings"
  on public.settings
  for select
  using (get_auth_role() is not null);

drop policy if exists "Station settings are viewable by everyone." on public.station_settings;
create policy "Approved users can view station settings"
  on public.station_settings
  for select
  using (get_auth_role() is not null);

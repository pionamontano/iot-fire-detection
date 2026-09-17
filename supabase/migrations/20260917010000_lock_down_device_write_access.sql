-- =============================================================
-- CRIT-03 fix: sensor_readings / alert_events INSERT was
-- application-layer-only (x-device-key checked by the Edge
-- Functions), while the DB-level RLS policy was WITH CHECK (true)
-- and the anon/authenticated Postgres roles held a blanket INSERT
-- grant on both tables. That meant anyone holding the public anon
-- key could POST directly to PostgREST and forge sensor readings
-- or alert events for any device_id, completely bypassing the
-- device-key check.
--
-- Fix: revoke the INSERT grant from anon/authenticated so only the
-- service-role key (used exclusively by ingest-reading and
-- trigger-alert, which already perform the real x-device-key check)
-- can write to these tables. service_role bypasses RLS entirely via
-- its BYPASSRLS attribute, so this doesn't affect the Edge Functions.
-- The old "WITH CHECK (true)" policies are replaced with explicit
-- deny policies so the intent is documented in the policy itself,
-- not just in a grant that's easy to overlook later.
-- =============================================================

revoke insert on public.sensor_readings from anon, authenticated;
revoke insert on public.alert_events    from anon, authenticated;

drop policy if exists "Allow devices to insert readings" on public.sensor_readings;
create policy "Direct client inserts are blocked - use ingest-reading"
  on public.sensor_readings
  for insert
  to anon, authenticated
  with check (false);

drop policy if exists "Allow system to insert alerts" on public.alert_events;
create policy "Direct client inserts are blocked - use trigger-alert"
  on public.alert_events
  for insert
  to anon, authenticated
  with check (false);

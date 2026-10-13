-- =============================================================
-- Defense-in-depth follow-up to 20261022000000 (Step 6c, issue #97).
--
-- Problem: "Admin full access on alert events" (init.sql) is a `FOR ALL USING (get_auth_role() = 'admin')`
-- policy on alert_events, covering SELECT/INSERT/UPDATE/DELETE. INSERT and UPDATE for `authenticated` (the
-- Postgres role every admin connects as) have since been fully revoked at the GRANT level (20260917010000
-- revoked INSERT; 20261012000001 and 20261022000000 revoked UPDATE), and DELETE was never granted. Postgres
-- checks table/column ACL before RLS, so today this FOR ALL policy is inert for anything but SELECT - but
-- it is a silent backstop: if any future migration, a schema restore, or a Supabase dashboard action ever
-- re-grants INSERT/UPDATE/DELETE on alert_events to `authenticated`, this policy would immediately let
-- admin-role users write arbitrary alert_events rows again, bypassing transition_incident()'s
-- transition-table validation, with no additional review triggered.
--
-- Change: replace the FOR ALL policy with a SELECT-only one, preserving the only capability admin actually
-- uses today - reading alerts/incidents on the admin Alerts/Dashboard/Logs/Map pages.
--
-- Not affected: bfp_responder/resident read policies, transition_incident() (SECURITY DEFINER), service_role.
--
-- Rollback:
--   drop policy if exists "Admin can read alert events" on alert_events;
--   create policy "Admin full access on alert events" on alert_events for all using (get_auth_role() = 'admin');
-- =============================================================

drop policy if exists "Admin full access on alert events" on public.alert_events;

create policy "Admin can read alert events"
  on public.alert_events for select using (get_auth_role() = 'admin');

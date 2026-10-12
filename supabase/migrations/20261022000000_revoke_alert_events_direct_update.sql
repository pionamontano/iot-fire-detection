-- =============================================================
-- Step 6c: revoke direct UPDATE on alert_events (issue #97).
--
-- Prerequisite: this must be deployed strictly AFTER 20261021000000 (6.1, transition_incident()) and the
-- 6.2 frontend change (src/lib/incidents.ts, ResponderDashboard.tsx, admin Alerts.tsx) are both live, because
-- those are what move every legitimate admin/responder write off direct table UPDATEs and onto the RPC.
--
-- Problem: 20261012000001 granted `authenticated` column UPDATE on alert_events (incident_status,
-- acknowledged_by, acknowledged_at, outcome_notes, resolved_at), gated only by RLS policies checking the
-- caller's role. The 6.1 guard trigger keeps incident_status and resolved_at in agreement and blocks
-- reopening/re-closing, but it does not enforce the transition table (who may move from which status to
-- which) - that validation lives only in transition_incident(). A direct UPDATE could still skip
-- acknowledgement, let a responder close an incident only admins may manually close, or set
-- acknowledged_by/resolved_by to an arbitrary uuid. Now that transition_incident() is the only path the UI
-- uses, that direct path is dead code and a lingering privilege-escalation surface.
--
-- Change: drop the two UPDATE policies and the column grant added in 20261012000001. `authenticated` keeps
-- SELECT on alert_events (it never had INSERT, revoked earlier in 20260917010000) and EXECUTE on
-- transition_incident() (granted in 20261021000000, SECURITY DEFINER, so it is unaffected by this revoke -
-- it runs as the function owner, not the caller).
--
-- Not affected: service_role (ingest-reading's auto-resolve, trigger-alert's telegram_sent flag,
-- confirm-sms-status) - this revoke only names `authenticated`, and service_role has BYPASSRLS and its own
-- grants besides.
--
-- Rollback:
--   create policy "Allow system and admin to update alerts" on alert_events for update using (get_auth_role() in ('admin'));
--   create policy "BFP Responder can update incident status" on alert_events for update using (get_auth_role() = 'bfp_responder') with check (get_auth_role() = 'bfp_responder');
--   grant update (incident_status, acknowledged_by, acknowledged_at, outcome_notes, resolved_at) on alert_events to authenticated;
-- =============================================================

drop policy if exists "Allow system and admin to update alerts" on public.alert_events;
drop policy if exists "BFP Responder can update incident status" on public.alert_events;

revoke update (incident_status, acknowledged_by, acknowledged_at, outcome_notes, resolved_at)
  on public.alert_events from authenticated;

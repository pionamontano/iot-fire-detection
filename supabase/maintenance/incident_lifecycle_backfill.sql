-- PROPOSED DATA BACKFILL for the incident lifecycle (Step 6.1). *** DO NOT RUN without explicit owner approval ***
-- and only after reviewing incident_lifecycle_dry_run.sql on the same database. It MODIFIES rows (never deletes).
-- Runs in one transaction; it rolls back if any inconsistent row remains or the constraint cannot be validated.
--
-- Rules (best-known values; the legacy writers recorded no time/actor, so these are approximations):
--   1. closed status (resolved/false_alarm) but resolved_at NULL  -> resolved_at = acknowledged_at, else triggered_at
--   2. resolved_at set but status still open                      -> incident_status = 'resolved'
--   Both: resolution_source = 'legacy' (never an invented actor). resolved_by stays NULL.
-- Requires migration 20261021000000_incident_lifecycle.sql (the guard trigger permits repairing legacy rows).

begin;

-- Never attribute a backfilled closure to whichever user/session runs this script: clear any caller identity
-- for this transaction so auth.uid() is NULL and resolved_by stays NULL.
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);

update public.alert_events
   set resolved_at = coalesce(acknowledged_at, triggered_at),
       resolution_source = 'legacy'
 where incident_status in ('resolved', 'false_alarm') and resolved_at is null;

update public.alert_events
   set incident_status = 'resolved',
       resolution_source = coalesce(resolution_source, 'legacy')
 where resolved_at is not null and incident_status in ('active', 'acknowledged', 'responding');

do $$
declare n integer;
begin
  select count(*) into n from public.alert_events
   where (incident_status in ('resolved', 'false_alarm')) is distinct from (resolved_at is not null);
  if n > 0 then
    raise exception 'backfill incomplete: % inconsistent incident(s) remain; rolling back', n;
  end if;
end;
$$;

alter table public.alert_events validate constraint alert_events_lifecycle_sync;

commit;

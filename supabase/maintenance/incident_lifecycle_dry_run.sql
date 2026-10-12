-- READ-ONLY dry run for the incident-lifecycle backfill (Step 6.1). Changes nothing. Run it on the target
-- database BEFORE deciding on the backfill. Output contains counts and incident ids only (no personal data).

select
  count(*)                                                                                     as total_incidents,
  count(*) filter (where incident_status in ('resolved', 'false_alarm') and resolved_at is null) as closed_status_but_no_resolved_at,
  count(*) filter (where resolved_at is not null and incident_status in ('active', 'acknowledged', 'responding')) as resolved_at_but_open_status,
  count(*) filter (where resolved_at is null and incident_status in ('active', 'acknowledged', 'responding')) as genuinely_open
from public.alert_events;

-- Duplicate OPEN incidents per device (must be empty before the 5.1b unique index can be created)
select device_id, count(*) as open_incidents
from public.alert_events
where resolved_at is null
group by device_id
having count(*) > 1;

-- The rows a backfill would touch (ids and statuses only)
select id, device_id, incident_status, triggered_at, acknowledged_at, resolved_at
from public.alert_events
where (incident_status in ('resolved', 'false_alarm') and resolved_at is null)
   or (resolved_at is not null and incident_status in ('active', 'acknowledged', 'responding'))
order by triggered_at
limit 200;

-- State of the lifecycle constraint (convalidated = false until the backfill is approved and VALIDATE is run)
select conname, convalidated from pg_constraint where conname = 'alert_events_lifecycle_sync';

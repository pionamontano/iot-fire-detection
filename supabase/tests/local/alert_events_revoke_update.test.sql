-- Step 6c: direct UPDATE on alert_events is revoked for `authenticated` (issue #97). Local harness only.
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$
begin raise notice '%: %', case when ok then 'PASS' else 'FAIL' end, name; end $$;
create or replace function pg_temp.fails_with(sql text, state text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlstate = state; end $$;
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;
\set adm  '00000000-0000-0000-0000-0000000000a1'
\set resp '00000000-0000-0000-0000-0000000000c1'

insert into devices(id, device_code, label, location_desc) values
  ('30000000-0000-0000-0000-000000000900', 'L-900', 'Revoke test', 'loc');
insert into alert_events(device_id, alert_tier, co_ppm, temp_celsius) values
  ('30000000-0000-0000-0000-000000000900', 2, 400, 80) returning id as aid \gset

-- ================= grants and policies =================
select pg_temp.check('authenticated has no table-level UPDATE on alert_events', not has_table_privilege('authenticated', 'alert_events', 'UPDATE'));
select pg_temp.check('authenticated has no column UPDATE on incident_status', not has_column_privilege('authenticated', 'alert_events', 'incident_status', 'UPDATE'));
select pg_temp.check('authenticated has no column UPDATE on resolved_at', not has_column_privilege('authenticated', 'alert_events', 'resolved_at', 'UPDATE'));
select pg_temp.check('authenticated has no column UPDATE on acknowledged_by', not has_column_privilege('authenticated', 'alert_events', 'acknowledged_by', 'UPDATE'));
select pg_temp.check('"Allow system and admin to update alerts" policy was dropped', (select count(*) = 0 from pg_policies where tablename = 'alert_events' and policyname = 'Allow system and admin to update alerts'));
select pg_temp.check('"BFP Responder can update incident status" policy was dropped', (select count(*) = 0 from pg_policies where tablename = 'alert_events' and policyname = 'BFP Responder can update incident status'));
select pg_temp.check('authenticated keeps SELECT on alert_events (reads are unaffected)', has_table_privilege('authenticated', 'alert_events', 'SELECT'));

-- ================= a direct write is rejected outright, not just normalised by the 6.1 guard =================
set role authenticated; select pg_temp.as_user(:'adm');
select pg_temp.check('admin direct UPDATE (whole row) is rejected (42501 insufficient privilege)',
  pg_temp.fails_with(format('update alert_events set incident_status = ''acknowledged'' where id = %L', :'aid'), '42501'));
reset role;

set role authenticated; select pg_temp.as_user(:'resp');
select pg_temp.check('responder direct UPDATE of resolved_at (previously granted) is rejected (42501)',
  pg_temp.fails_with(format('update alert_events set resolved_at = now() where id = %L', :'aid'), '42501'));
select pg_temp.check('responder direct UPDATE of outcome_notes (previously granted) is rejected (42501)',
  pg_temp.fails_with(format('update alert_events set outcome_notes = ''x'' where id = %L', :'aid'), '42501'));
reset role;

select pg_temp.check('incident untouched by the denied attempts', (select incident_status = 'active' and resolved_at is null and outcome_notes is null from alert_events where id = :'aid'));

-- ================= the RPC is unaffected (SECURITY DEFINER runs as the function owner, not the caller) =================
select pg_temp.as_user(:'resp');
select pg_temp.check('transition_incident still works for an authorized responder',
  (select incident_status = 'acknowledged' and acknowledged_by = :'resp'::uuid from transition_incident(:'aid', 'acknowledged')));

-- ================= service_role is untouched: ingest-reading / confirm-sms-status / trigger-alert keep writing directly =================
set role service_role;
update alert_events set resolved_at = now(), sms_sent_owner = true where id = :'aid';
reset role;
select pg_temp.check('service_role can still write alert_events directly', (select resolved_at is not null and sms_sent_owner from alert_events where id = :'aid'));

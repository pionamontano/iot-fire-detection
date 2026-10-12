-- Step 6.1: lifecycle guard trigger, CHECK constraint, transition_incident(), backfill scripts. Local harness only.
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$
begin raise notice '%: %', case when ok then 'PASS' else 'FAIL' end, name; end $$;
create or replace function pg_temp.fails_with(sql text, state text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlstate = state; end $$;
create or replace function pg_temp.fails_msg(sql text, state text, pattern text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlstate = state and sqlerrm like pattern; end $$;
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;
\set resp  '00000000-0000-0000-0000-0000000000c1'
\set resp2 '00000000-0000-0000-0000-0000000000c2'
\set adm   '00000000-0000-0000-0000-0000000000a1'
\set res1  '00000000-0000-0000-0000-0000000000b1'
\set rej   '00000000-0000-0000-0000-0000000000d1'

insert into devices(id, device_code, label, location_desc)
select ('30000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'L-' || n, 'Lifecycle ' || n, 'loc' from generate_series(1, 120) n;
-- helper: a fresh incident for device #n
create or replace function pg_temp.mk(n int, st text default 'active') returns uuid language plpgsql as $$
declare v uuid; begin
  insert into alert_events(device_id, alert_tier, co_ppm, temp_celsius, incident_status)
  values (('30000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 2, 400, 80, st) returning id into v; return v; end $$;

-- ================= structure =================
select pg_temp.check('guard trigger exists', (select count(*) = 1 from pg_trigger where tgname = 'alert_events_lifecycle_guard' and not tgisinternal));
select pg_temp.check('CHECK constraint exists and is NOT VALID (existing rows are not scanned)', (select not convalidated from pg_constraint where conname = 'alert_events_lifecycle_sync'));
select pg_temp.check('new columns exist', (select count(*) = 2 from information_schema.columns where table_name = 'alert_events' and column_name in ('resolved_by', 'resolution_source')));
select pg_temp.check('device_cleared_at is NOT part of 6.1 (decision D6.1 pending)', (select count(*) = 0 from information_schema.columns where table_name = 'alert_events' and column_name = 'device_cleared_at'));
select pg_temp.check('device_readings_clear is NOT part of 6.1', (select count(*) = 0 from pg_proc where proname = 'device_readings_clear'));

-- ================= guard: every legacy writer, executed as its real role =================
select pg_temp.mk(1) as g1 \gset
set role authenticated; select pg_temp.as_user(:'resp');
update alert_events set incident_status = 'resolved' where id = :'g1';          -- responder handleUpdateStatus('resolved')
reset role;
select pg_temp.check('[responder resolve, legacy write] resolved_at is now set by the database; closure attributed to the responder; source=legacy',
  (select resolved_at is not null and resolved_by = :'resp'::uuid and resolution_source = 'legacy' and incident_status = 'resolved' from alert_events where id = :'g1'));

select pg_temp.mk(2) as g2 \gset
set role authenticated; select pg_temp.as_user(:'resp');
update alert_events set incident_status = 'false_alarm' where id = :'g2';
reset role;
select pg_temp.check('[responder false alarm, legacy write] resolved_at set', (select resolved_at is not null and incident_status = 'false_alarm' from alert_events where id = :'g2'));

select pg_temp.mk(3) as g3 \gset
set role authenticated; select pg_temp.as_user(:'adm');
update alert_events set resolved_at = now() where id = :'g3';                    -- admin Alerts.handleResolveAlert
reset role;
select pg_temp.check('[admin resolve, legacy write] status is now normalised to resolved (was stale "active")',
  (select incident_status = 'resolved' and resolved_by = :'adm'::uuid and resolution_source = 'legacy' from alert_events where id = :'g3'));

select pg_temp.mk(4) as g4 \gset
select pg_temp.as_user('');   -- the service role carries no user identity
set role service_role;
update alert_events set resolved_at = now() where device_id = '30000000-0000-0000-0000-000000000004' and resolved_at is null;   -- ingest-reading auto-resolve
reset role;
select pg_temp.check('[ingest auto-resolve, legacy write] status normalised; no actor invented (service role has no user)',
  (select incident_status = 'resolved' and resolved_by is null and resolution_source = 'legacy' from alert_events where id = :'g4'));

select pg_temp.mk(5) as g5 \gset
set role authenticated; select pg_temp.as_user(:'resp');
update alert_events set incident_status = 'acknowledged', acknowledged_by = :'resp', acknowledged_at = now() where id = :'g5';
update alert_events set incident_status = 'responding' where id = :'g5';
reset role;
select pg_temp.check('[responder ack / responding, legacy writes] unchanged behaviour; incident stays open',
  (select incident_status = 'responding' and resolved_at is null and acknowledged_by = :'resp'::uuid from alert_events where id = :'g5'));

select pg_temp.mk(6) as g6 \gset
set role service_role; update alert_events set sms_sent_owner = true, telegram_sent = true where id = :'g6'; reset role;
select pg_temp.check('[confirm-sms-status / trigger-alert flag updates] unaffected', (select sms_sent_owner and telegram_sent and incident_status = 'active' from alert_events where id = :'g6'));

-- inserts
insert into alert_events(device_id, alert_tier, co_ppm, temp_celsius, resolved_at) values ('30000000-0000-0000-0000-000000000007', 1, 1, 1, now()) returning id as g7 \gset
select pg_temp.check('INSERT with resolved_at set => status normalised to resolved', (select incident_status = 'resolved' from alert_events where id = :'g7'));
insert into alert_events(device_id, alert_tier, co_ppm, temp_celsius, incident_status) values ('30000000-0000-0000-0000-000000000008', 1, 1, 1, 'false_alarm') returning id as g8 \gset
select pg_temp.check('INSERT with a closed status => resolved_at filled', (select resolved_at is not null from alert_events where id = :'g8'));

-- ================= guard: closed incidents are immutable (status / resolved_at) =================
select pg_temp.check('reopen (resolved_at -> NULL) rejected (55000)', pg_temp.fails_with(format('update alert_events set resolved_at = null where id = %L', :'g1'), '55000'));
select pg_temp.check('reopen by setting status back to active is rejected (55000)', pg_temp.fails_with(format('update alert_events set incident_status = ''active'' where id = %L', :'g1'), '55000'));
select pg_temp.check('re-close with a different status (resolved -> false_alarm) rejected (55000)', pg_temp.fails_with(format('update alert_events set incident_status = ''false_alarm'' where id = %L', :'g1'), '55000'));
select pg_temp.check('rewriting resolved_at of a closed incident rejected (55000)', pg_temp.fails_with(format('update alert_events set resolved_at = now() + interval ''1 day'' where id = %L', :'g1'), '55000'));
select pg_temp.check('combined reopen (status active AND resolved_at null) rejected (55000)', pg_temp.fails_with(format('update alert_events set incident_status = ''active'', resolved_at = null where id = %L', :'g1'), '55000'));
-- but delivery/audit fields on a closed incident stay writable, and nobody takes credit for the closure
select pg_temp.as_user(:'adm');
update alert_events set outcome_notes = 'late note', sms_sent_bfp = true where id = :'g1';
select pg_temp.check('closed incident: notes / SMS flags can still be updated (e.g. late confirm-sms-status)', (select outcome_notes = 'late note' and sms_sent_bfp from alert_events where id = :'g1'));
select pg_temp.check('...and resolved_by is NOT overwritten by the editor (still the responder)', (select resolved_by = :'resp'::uuid from alert_events where id = :'g1'));

-- ================= legacy rows already in the database (simulated), repaired when touched, constraint validation gated =================
alter table alert_events drop constraint alert_events_lifecycle_sync;
alter table alert_events disable trigger alert_events_lifecycle_guard;
insert into alert_events(id, device_id, alert_tier, co_ppm, temp_celsius, incident_status, resolved_at, acknowledged_at, triggered_at) values
 ('c0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000011', 2, 1, 1, 'resolved', null, '2026-01-02 10:00+00', '2026-01-02 09:00+00'),   -- closed status, no resolved_at, acknowledged
 ('c0000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000012', 2, 1, 1, 'false_alarm', null, null, '2026-01-03 09:00+00'),                   -- closed status, no resolved_at, never acknowledged
 ('c0000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000013', 1, 1, 1, 'active', '2026-01-04 10:00+00', null, '2026-01-04 09:00+00'),      -- resolved_at set, stale status
 ('c0000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000014', 1, 1, 1, 'acknowledged', '2026-01-05 10:00+00', '2026-01-05 09:30+00', '2026-01-05 09:00+00'),
 ('c0000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000015', 1, 1, 1, 'responding', '2026-01-06 10:00+00', '2026-01-06 09:30+00', '2026-01-06 09:00+00');
alter table alert_events enable trigger alert_events_lifecycle_guard;
alter table alert_events add constraint alert_events_lifecycle_sync check ((incident_status in ('resolved', 'false_alarm')) = (resolved_at is not null)) not valid;

select pg_temp.check('VALIDATE CONSTRAINT is refused while legacy inconsistent rows exist (23514)', pg_temp.fails_with('alter table alert_events validate constraint alert_events_lifecycle_sync', '23514'));
-- touching a legacy row repairs it (BEFORE trigger runs ahead of the CHECK) - e.g. a late SMS confirmation
update alert_events set sms_sent_owner = true where id = 'c0000000-0000-0000-0000-000000000001';
select pg_temp.check('touching legacy row 1 (closed status, no resolved_at) sets resolved_at', (select resolved_at is not null and incident_status = 'resolved' from alert_events where id = 'c0000000-0000-0000-0000-000000000001'));
select pg_temp.check('...and the repair does not credit the user who happened to touch it (status was closed earlier by someone else)', (select resolved_by is null and resolution_source = 'legacy' from alert_events where id = 'c0000000-0000-0000-0000-000000000001'));
update alert_events set sms_sent_owner = true where id = 'c0000000-0000-0000-0000-000000000003';
select pg_temp.check('touching legacy row 3 (resolved_at set, stale status) normalises status', (select incident_status = 'resolved' and resolution_source = 'legacy' and resolved_by is null from alert_events where id = 'c0000000-0000-0000-0000-000000000003'));
select pg_temp.check('...a repair of a legacy row does not attribute the closure to whoever touched it (resolved_by stays NULL)',
  (select resolved_by is null from alert_events where id = 'c0000000-0000-0000-0000-000000000003'));
select pg_temp.check('reopening a LEGACY row that is closed only by resolved_at (stale status) is rejected too (55000)',
  pg_temp.fails_with($q$update alert_events set resolved_at = null where id = 'c0000000-0000-0000-0000-000000000004'$q$, '55000'));
-- one legacy row (2 and 4,5) left untouched: still inconsistent, constraint still not validatable
select pg_temp.check('untouched legacy rows remain inconsistent until the backfill', (select count(*) = 3 from alert_events where (incident_status in ('resolved','false_alarm')) is distinct from (resolved_at is not null)));

-- ---- the proposed backfill + dry-run scripts, executed locally ----
\o /dev/null
\ir ../../maintenance/incident_lifecycle_dry_run.sql
\o
select pg_temp.check('dry-run script is read-only (runs without modifying rows)', (select count(*) = 3 from alert_events where (incident_status in ('resolved','false_alarm')) is distinct from (resolved_at is not null)));
select pg_temp.as_user(:'adm');   -- deliberately leave a user identity in the session; the script must ignore it
\ir ../../maintenance/incident_lifecycle_backfill.sql
select pg_temp.check('backfill: closed-status rows get resolved_at = acknowledged_at (else triggered_at)',
  (select resolved_at = '2026-01-03 09:00+00' and resolution_source = 'legacy' from alert_events where id = 'c0000000-0000-0000-0000-000000000002'));
select pg_temp.check('backfill: rows with resolved_at and open status become resolved (resolved_at untouched)',
  (select incident_status = 'resolved' and resolved_at = '2026-01-05 10:00+00' from alert_events where id = 'c0000000-0000-0000-0000-000000000004')
  and (select incident_status = 'resolved' and resolved_at = '2026-01-06 10:00+00' from alert_events where id = 'c0000000-0000-0000-0000-000000000005'));
select pg_temp.check('backfill never invents an actor (even if the session had a user identity)', (select count(*) = 0 from alert_events where resolution_source = 'legacy' and resolved_by is not null and id::text like 'c0000000%'));
select pg_temp.check('constraint is VALIDATED after the backfill', (select convalidated from pg_constraint where conname = 'alert_events_lifecycle_sync'));
select pg_temp.check('no inconsistent rows remain anywhere', (select count(*) = 0 from alert_events where (incident_status in ('resolved','false_alarm')) is distinct from (resolved_at is not null)));
select md5(string_agg(t::text, '' order by t.id)) as h_before from alert_events t \gset
\ir ../../maintenance/incident_lifecycle_backfill.sql
select pg_temp.check('backfill is idempotent: a second run changes no row', (select md5(string_agg(t::text, '' order by t.id)) = :'h_before' from alert_events t));

-- ================= transition_incident: authorization =================
select pg_temp.mk(20) as t1 \gset
select pg_temp.as_user(:'res1');
select pg_temp.check('resident cannot transition (42501)', pg_temp.fails_with(format('select transition_incident(%L, ''acknowledged'')', :'t1'), '42501'));
select pg_temp.as_user(:'rej');
select pg_temp.check('rejected account cannot transition (42501)', pg_temp.fails_with(format('select transition_incident(%L, ''acknowledged'')', :'t1'), '42501'));
select pg_temp.as_user(:'resp2');
select pg_temp.check('PENDING responder cannot transition (42501)', pg_temp.fails_with(format('select transition_incident(%L, ''acknowledged'')', :'t1'), '42501'));
select pg_temp.as_user('');
select pg_temp.check('unauthenticated caller cannot transition (42501)', pg_temp.fails_with(format('select transition_incident(%L, ''acknowledged'')', :'t1'), '42501'));
update profiles set is_active = false where id = :'resp';
select pg_temp.as_user(:'resp');
select pg_temp.check('DEACTIVATED approved responder cannot transition (42501)', pg_temp.fails_with(format('select transition_incident(%L, ''acknowledged'')', :'t1'), '42501'));
update profiles set is_active = true where id = :'resp';
select pg_temp.check('incident untouched by all the denied attempts', (select incident_status = 'active' and acknowledged_by is null from alert_events where id = :'t1'));
select pg_temp.check('anon cannot execute transition_incident', not has_function_privilege('anon', 'public.transition_incident(uuid,text,text)', 'execute'));
select pg_temp.check('authenticated can execute transition_incident', has_function_privilege('authenticated', 'public.transition_incident(uuid,text,text)', 'execute'));
select pg_temp.check('transition_incident pins search_path and is security definer', (select prosecdef and proconfig::text like '%search_path=public, pg_temp%' from pg_proc where proname = 'transition_incident'));
select pg_temp.as_user(:'resp');
select pg_temp.check('invalid target status (22023)', pg_temp.fails_with(format('select transition_incident(%L, ''active'')', :'t1'), '22023'));
select pg_temp.check('NULL target status (22023)', pg_temp.fails_with(format('select transition_incident(%L, null)', :'t1'), '22023'));
select pg_temp.check('notes over 2000 chars (22001)', pg_temp.fails_with(format('select transition_incident(%L, ''acknowledged'', repeat(''x'', 2001))', :'t1'), '22001'));
select pg_temp.check('unknown incident (P0002)', pg_temp.fails_with($q$select transition_incident('deadbeef-0000-0000-0000-000000000000', 'acknowledged')$q$, 'P0002'));

-- ================= transition_incident: EXHAUSTIVE matrix (expected outcomes hard-coded independently) =================
create temp table expected(from_st text, to_st text, role text, outcome text);
-- outcome: ok = succeeds and ends in to_st; noop = same status; 55000 = rejected
insert into expected
select f, t, r,
  case
    when f = t then 'noop'
    when f in ('resolved', 'false_alarm') then '55000'
    when r = 'bfp_responder' and (f, t) in (('active','acknowledged'), ('acknowledged','responding'), ('acknowledged','resolved'), ('acknowledged','false_alarm'), ('responding','resolved'), ('responding','false_alarm')) then 'ok'
    when r = 'admin'         and (f, t) in (('active','acknowledged'), ('acknowledged','responding'), ('acknowledged','resolved'), ('acknowledged','false_alarm'), ('responding','resolved'), ('responding','false_alarm'), ('active','resolved'), ('active','false_alarm')) then 'ok'
    else '55000'
  end
from unnest(array['active','acknowledged','responding','resolved','false_alarm']) f,
     unnest(array['acknowledged','responding','resolved','false_alarm']) t,
     unnest(array['bfp_responder','admin']) r;
create temp table matrix_result(from_st text, to_st text, role text, outcome text, actual text);
do $$
declare
  e record; v uuid; n int := 30; actual text; r alert_events; uid text;
begin
  for e in select * from expected order by 1, 2, 3 loop
    n := n + 1;
    v := pg_temp.mk(n, case when e.from_st in ('acknowledged','responding') then 'active' else e.from_st end);
    -- put the incident into the required starting state through the legitimate path (as a responder), so the setup is realistic
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
    if e.from_st in ('acknowledged', 'responding') then perform transition_incident(v, 'acknowledged'); end if;
    if e.from_st = 'responding' then perform transition_incident(v, 'responding'); end if;
    uid := case e.role when 'admin' then '00000000-0000-0000-0000-0000000000a1' else '00000000-0000-0000-0000-0000000000c1' end;
    perform set_config('request.jwt.claim.sub', uid, false);
    begin
      select * into r from transition_incident(v, e.to_st);
      actual := case when e.from_st = e.to_st then 'noop' when r.incident_status = e.to_st then 'ok' else 'WRONG-STATE:' || r.incident_status end;
    exception when others then actual := sqlstate;
    end;
    insert into matrix_result values (e.from_st, e.to_st, e.role, e.outcome, actual);
  end loop;
end $$;
select pg_temp.check('matrix: all ' || count(*) || ' (from, to, role) combinations behave exactly as specified', count(*) = 40 and bool_and(outcome = actual)) from matrix_result;
select pg_temp.check('matrix mismatch detail: ' || coalesce(string_agg(from_st || '->' || to_st || '/' || role || ' expected ' || outcome || ' got ' || actual, '; '), 'none'), count(*) = 0) from matrix_result where outcome <> actual;
select pg_temp.check('matrix: a closed incident rejects every change (or no-ops on the same status), for both roles', (select count(*) = 16 and bool_and(actual in ('55000','noop')) from matrix_result where from_st in ('resolved','false_alarm')));

-- defence in depth: the function rejects first (clear message); the trigger would reject the same write underneath
select pg_temp.mk(95, 'resolved') as dd \gset
select pg_temp.as_user(:'adm');
select pg_temp.check('admin re-closing a closed incident is stopped by the function with a clear message (layer 1)', pg_temp.fails_msg(format('select transition_incident(%L, ''false_alarm'')', :'dd'), '55000', '%already closed%'));
select pg_temp.check('a direct write doing the same is stopped by the trigger (layer 2)', pg_temp.fails_msg(format('update alert_events set incident_status = ''false_alarm'' where id = %L', :'dd'), '55000', '%cannot be modified or re-closed%'));

-- ================= transition_incident: field effects =================
select pg_temp.mk(80) as f1 \gset
select pg_temp.as_user(:'resp');
select pg_temp.check('acknowledge sets acknowledged_by = caller, acknowledged_at, status; still open',
  (select incident_status = 'acknowledged' and acknowledged_by = :'resp'::uuid and acknowledged_at is not null and resolved_at is null from transition_incident(:'f1', 'acknowledged')));
select pg_temp.as_user(:'adm');
select pg_temp.check('a second actor re-acknowledging is a no-op: acknowledged_by is not stolen', (select acknowledged_by = :'resp'::uuid from transition_incident(:'f1', 'acknowledged')));
select pg_temp.as_user(:'resp');
select transition_incident(:'f1', 'responding');
select pg_temp.check('responder can resolve FROM responding (the FE-002 dead end) - all closure fields set together, notes kept',
  (select incident_status = 'resolved' and resolved_at is not null and resolved_by = :'resp'::uuid and resolution_source = 'responder' and outcome_notes = 'extinguished'
     from transition_incident(:'f1', 'resolved', 'extinguished')));
select pg_temp.check('closing is idempotent: repeating it changes nothing', (select resolved_at = (select a.resolved_at from alert_events a where a.id = :'f1') from transition_incident(:'f1', 'resolved', 'different note')));
select pg_temp.check('...and does not overwrite the original notes', (select outcome_notes = 'extinguished' from alert_events where id = :'f1'));
select pg_temp.mk(81) as f2 \gset
select pg_temp.as_user(:'adm');
select pg_temp.check('admin manual close from an unattended (active) incident; source = admin; admin recorded',
  (select incident_status = 'false_alarm' and resolution_source = 'admin' and resolved_by = :'adm'::uuid and acknowledged_by is null from transition_incident(:'f2', 'false_alarm', 'test fire drill')));
select pg_temp.check('closure timestamp is server time (not client supplied) and consistent', (select resolved_at <= now() and resolved_at > now() - interval '1 minute' from alert_events where id = :'f2'));
select pg_temp.check('CHECK constraint holds for every row now', (select count(*) = 0 from alert_events where (incident_status in ('resolved','false_alarm')) is distinct from (resolved_at is not null)));

-- ================= coexistence with the (gated) 5.1b open-incident index and raise_alert =================
reset role;
insert into alert_events(device_id, alert_tier, co_ppm, temp_celsius) values ('30000000-0000-0000-0000-000000000080', 2, 1, 1);
select pg_temp.check('the 5.1b unique index treats a transition_incident-closed incident as closed: a new open row for that device is accepted',
  (select count(*) = 1 from alert_events where device_id = '30000000-0000-0000-0000-000000000080' and resolved_at is null)
  and (select count(*) = 2 from alert_events where device_id = '30000000-0000-0000-0000-000000000080'));
select pg_temp.mk(90) as r1 \gset
set role authenticated; select pg_temp.as_user(:'resp');
update alert_events set incident_status = 'resolved' where id = :'r1';           -- legacy writer #7
reset role;
select alert_id as r2, created as rc from raise_alert('30000000-0000-0000-0000-000000000090', 2, 410, 85, null, null, false, null) \gset
select pg_temp.check('a new fire after a LEGACY responder resolve becomes a NEW incident (the guard closes it at write time)', :'rc' = 't' and :'r2' <> :'r1' and (select resolved_at is not null from alert_events where id = :'r1'));

-- ================= observation (pre-existing, not changed here) =================
select pg_temp.check('OBSERVATION: acknowledged_by has no ON DELETE action, so deleting a responder who acknowledged an incident is blocked (pre-existing)',
  (select confdeltype = 'a' from pg_constraint where conrelid = 'alert_events'::regclass and contype = 'f' and conkey = (select array[attnum] from pg_attribute where attrelid = 'alert_events'::regclass and attname = 'acknowledged_by')));
select pg_temp.check('...whereas the new resolved_by is ON DELETE SET NULL', (select confdeltype = 'n' from pg_constraint where conrelid = 'alert_events'::regclass and contype = 'f' and conkey = (select array[attnum] from pg_attribute where attrelid = 'alert_events'::regclass and attname = 'resolved_by')));

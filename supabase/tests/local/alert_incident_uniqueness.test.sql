-- Step 5.1b: one open incident per device, raise_alert(), and an audit of EVERY alert_events writer.
-- Each writer's SQL is the statement the app issues, executed as the role the app uses.
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$
begin raise notice '%: %', case when ok then 'PASS' else 'FAIL' end, name; end $$;
create or replace function pg_temp.fails_with(sql text, state text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlstate = state; end $$;
-- Applies a status change the way the app does. From 6.1 on that is transition_incident() (the UI's only
-- path; 6c revoked direct UPDATEs for authenticated), walking through "acknowledged" first like the UI does.
-- Before 6.1 it is the legacy direct UPDATE each screen used to issue. Run as the caller (set role first).
create or replace function pg_temp.app_transition(p_id uuid, p_to text) returns void language plpgsql as $$
declare v_cur text;
begin
  if to_regprocedure('public.transition_incident(uuid,text,text)') is not null then
    select incident_status into v_cur from alert_events where id = p_id;
    if v_cur = 'active' and p_to <> 'acknowledged' and get_auth_role() = 'bfp_responder' then
      perform transition_incident(p_id, 'acknowledged', null);
    end if;
    perform transition_incident(p_id, p_to, null);
  elsif p_to = 'acknowledged' then
    update alert_events set incident_status = 'acknowledged', acknowledged_by = auth.uid(), acknowledged_at = now() where id = p_id;
  elsif p_to = 'admin_resolve' then          -- legacy Alerts.handleResolveAlert: resolved_at only
    update alert_events set resolved_at = now() where id = p_id;
  else
    update alert_events set incident_status = p_to where id = p_id;
  end if;
end $$;
\set resp '00000000-0000-0000-0000-0000000000c1'
\set adm  '00000000-0000-0000-0000-0000000000a1'

insert into devices(id, device_code, label, location_desc) select
  ('20000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'W-' || n, 'Writer ' || n, 'loc'
from generate_series(1, 14) n;

-- ================= raise_alert behaviour =================
select alert_id as r1, created as rc1 from raise_alert('20000000-0000-0000-0000-000000000001', 1, 250, 30, null, null, false, null) \gset
select alert_id as r2, created as rc2, tier as rt2 from raise_alert('20000000-0000-0000-0000-000000000001', 1, 260, 31, null, null, false, null) \gset
select pg_temp.check('first call creates; an identical retry returns the SAME incident (created=false)', :'rc1' = 't' and :'rc2' = 'f' and :'r1' = :'r2');
select pg_temp.check('exactly one open incident after retries', (select count(*) = 1 from alert_events where device_id = '20000000-0000-0000-0000-000000000001' and resolved_at is null));
select tier as rt3 from raise_alert('20000000-0000-0000-0000-000000000001', 2, 400, 80, 14.8, 120.8, true, 'Addr') \gset
select pg_temp.check('escalation 1 -> 2 updates the same incident and returns tier 2', :'rt3' = '2');
select tier as rt4 from raise_alert('20000000-0000-0000-0000-000000000001', 1, 250, 30, null, null, false, null) \gset
select pg_temp.check('a late tier-1 retry never downgrades the tier', :'rt4' = '2');
select pg_temp.check('retry without coordinates/address keeps the earlier ones; latest readings win',
  (select latitude = 14.8 and address_resolved = 'Addr' and co_ppm = 250 from alert_events where id = :'r1'));
select pg_temp.check('triggered_at is returned and equals the stored value',
  (select triggered_at = (select a.triggered_at from alert_events a where a.id = :'r1') from raise_alert('20000000-0000-0000-0000-000000000001', 2, 1, 1, null, null, false, null)));
select pg_temp.check('invalid tier rejected (22023)', pg_temp.fails_with($q$select * from raise_alert('20000000-0000-0000-0000-000000000001', 3, 1, 1, null, null, false, null)$q$, '22023'));
select pg_temp.check('null tier rejected (22023)', pg_temp.fails_with($q$select * from raise_alert('20000000-0000-0000-0000-000000000001', null, 1, 1, null, null, false, null)$q$, '22023'));
select pg_temp.check('unknown device rejected by FK (23503)', pg_temp.fails_with($q$select * from raise_alert('20000000-0000-0000-0000-0000000000ee', 1, 1, 1, null, null, false, null)$q$, '23503'));
select pg_temp.check('the unique index rejects a second open row written by any other path (23505)',
  pg_temp.fails_with($q$insert into alert_events(device_id, alert_tier, co_ppm, temp_celsius) values ('20000000-0000-0000-0000-000000000001', 1, 1, 1)$q$, '23505'));
select pg_temp.check('index is partial on resolved_at IS NULL',
  (select indexdef like '%UNIQUE%(device_id)%WHERE (resolved_at IS NULL)%' from pg_indexes where indexname = 'alert_events_one_open_per_device'));
select pg_temp.check('anon/authenticated cannot execute raise_alert',
  not has_function_privilege('anon', 'public.raise_alert(uuid,integer,double precision,double precision,double precision,double precision,boolean,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.raise_alert(uuid,integer,double precision,double precision,double precision,double precision,boolean,text)', 'execute'));
select pg_temp.check('service_role can execute raise_alert', has_function_privilege('service_role', 'public.raise_alert(uuid,integer,double precision,double precision,double precision,double precision,boolean,text)', 'execute'));
select pg_temp.check('raise_alert pins search_path', (select prosecdef and proconfig::text like '%search_path=public, pg_temp%' from pg_proc where proname = 'raise_alert'));

-- The audit has two expected outcomes depending on whether the Step 6.1 lifecycle guard is installed.
select exists (select 1 from pg_trigger where tgname = 'alert_events_lifecycle_guard' and not tgisinternal) as lifecycle \gset
-- ================= WRITER AUDIT (guard installed: :lifecycle) =================
-- W-ack: responder acknowledge (ResponderDashboard.handleAcknowledge) - authenticated, column UPDATE grant
select alert_id as i2 from raise_alert('20000000-0000-0000-0000-000000000002', 2, 400, 80, null, null, false, null) \gset
set role authenticated; select set_config('request.jwt.claim.sub', :'resp', false);
select pg_temp.app_transition(:'i2', 'acknowledged');
reset role;
select alert_id as j2, created as c2 from raise_alert('20000000-0000-0000-0000-000000000002', 2, 410, 85, null, null, false, null) \gset
select pg_temp.check('[responder ack] same fire keeps the same incident, acknowledgement preserved',
  :'c2' = 'f' and :'j2' = :'i2' and (select incident_status = 'acknowledged' and acknowledged_by is not null from alert_events where id = :'i2'));

-- W-responding: responder status 'responding'
select alert_id as i3 from raise_alert('20000000-0000-0000-0000-000000000003', 2, 400, 80, null, null, false, null) \gset
set role authenticated; select set_config('request.jwt.claim.sub', :'resp', false);
select pg_temp.app_transition(:'i3', 'responding');
reset role;
select alert_id as j3, created as c3 from raise_alert('20000000-0000-0000-0000-000000000003', 2, 410, 85, null, null, false, null) \gset
select pg_temp.check('[responder responding] still the same open incident', :'c3' = 'f' and :'j3' = :'i3' and (select incident_status = 'responding' from alert_events where id = :'i3'));

-- W-resolve: responder resolves. Pre-6.1 the UI wrote incident_status ONLY (resolved_at stayed NULL) - THE DEFECT
select alert_id as i4 from raise_alert('20000000-0000-0000-0000-000000000004', 2, 400, 80, null, null, false, null) \gset
set role authenticated; select set_config('request.jwt.claim.sub', :'resp', false);
select pg_temp.app_transition(:'i4', 'resolved');
reset role;
select pg_temp.check(case when :'lifecycle' then '[6.1 guard] responder "resolve" now sets resolved_at at write time (defect fixed)' else '[DEFECT, confirmed] responder "resolve" leaves resolved_at NULL, so the row still counts as OPEN' end,
  (select (resolved_at is not null) = :'lifecycle'::boolean and incident_status = 'resolved' from alert_events where id = :'i4'));
select alert_id as j4, created as c4 from raise_alert('20000000-0000-0000-0000-000000000004', 2, 410, 85, null, null, false, null) \gset
select pg_temp.check('[responder resolve] STOPGAP: a new fire after a responder-resolved incident creates a NEW incident',
  :'c4' = 't' and :'j4' <> :'i4'
  and (select resolved_at is not null from alert_events where id = :'i4')
  and (select incident_status = 'active' and resolved_at is null from alert_events where id = :'j4')
  and (select count(*) = 1 from alert_events where device_id = '20000000-0000-0000-0000-000000000004' and resolved_at is null));

-- W-false-alarm
select alert_id as i5 from raise_alert('20000000-0000-0000-0000-000000000005', 1, 400, 20, null, null, false, null) \gset
set role authenticated; select set_config('request.jwt.claim.sub', :'resp', false);
select pg_temp.app_transition(:'i5', 'false_alarm');
reset role;
select alert_id as j5, created as c5 from raise_alert('20000000-0000-0000-0000-000000000005', 1, 410, 20, null, null, false, null) \gset
select pg_temp.check('[responder false alarm] a new fire creates a NEW incident', :'c5' = 't' and :'j5' <> :'i5' and (select resolved_at is not null from alert_events where id = :'i5'));

-- W-admin-resolve: admin resolves from the Alerts page (pre-6.1: wrote resolved_at only, status left as is)
select alert_id as i6 from raise_alert('20000000-0000-0000-0000-000000000006', 2, 400, 80, null, null, false, null) \gset
set role authenticated; select set_config('request.jwt.claim.sub', :'adm', false);
select pg_temp.app_transition(:'i6', case when to_regprocedure('public.transition_incident(uuid,text,text)') is not null then 'resolved' else 'admin_resolve' end);
reset role;
select alert_id as j6, created as c6 from raise_alert('20000000-0000-0000-0000-000000000006', 2, 410, 85, null, null, false, null) \gset
select pg_temp.check('[admin manual resolve] closed via resolved_at => a new fire creates a NEW incident', :'c6' = 't' and :'j6' <> :'i6');
select pg_temp.check(case when :'lifecycle' then '[6.1 guard] admin resolve now normalises incident_status to resolved' else '[admin manual resolve] known leftover: incident_status stays "active" on the closed row (fixed in Step 6)' end,
  (select incident_status = (case when :'lifecycle' then 'resolved' else 'active' end) from alert_events where id = :'i6'));

-- W-ingest: ingest-reading auto-resolve (service role): UPDATE ... SET resolved_at WHERE device_id AND resolved_at IS NULL
select alert_id as i7 from raise_alert('20000000-0000-0000-0000-000000000007', 2, 400, 80, null, null, false, null) \gset
set role service_role;
update alert_events set resolved_at = now() where device_id = '20000000-0000-0000-0000-000000000007' and resolved_at is null;
reset role;
select alert_id as j7, created as c7 from raise_alert('20000000-0000-0000-0000-000000000007', 2, 410, 85, null, null, false, null) \gset
select pg_temp.check('[ingest auto-resolve] closed via resolved_at => a new fire creates a NEW incident', :'c7' = 't' and :'j7' <> :'i7');

-- W-sms: confirm-sms-status (service role) updates delivery flags only
select alert_id as i8 from raise_alert('20000000-0000-0000-0000-000000000008', 2, 400, 80, null, null, false, null) \gset
set role service_role;
update alert_events set sms_sent_owner = true where id = :'i8' and device_id = '20000000-0000-0000-0000-000000000008';
reset role;
select alert_id as j8, created as c8 from raise_alert('20000000-0000-0000-0000-000000000008', 2, 410, 85, null, null, false, null) \gset
select pg_temp.check('[confirm-sms-status] SMS confirmation survives a later raise_alert; same incident', :'c8' = 'f' and :'j8' = :'i8' and (select sms_sent_owner from alert_events where id = :'i8'));

-- W-trigger-alert legacy update path (service role) keeps working next to raise_alert
select alert_id as i9 from raise_alert('20000000-0000-0000-0000-000000000009', 1, 250, 30, null, null, false, null) \gset
set role service_role;
update alert_events set alert_tier = 2, co_ppm = 500 where id = :'i9';
reset role;
select pg_temp.check('[legacy trigger-alert update] coexists: raise_alert returns the same incident',
  (select alert_id = :'i9'::uuid and not created from raise_alert('20000000-0000-0000-0000-000000000009', 1, 250, 30, null, null, false, null)));

-- ================= NEGATIVE CONTROL: the same scenario WITHOUT the stopgap =================
create function public.raise_alert_nostopgap_test(p_device_id uuid, p_tier integer) returns table (alert_id uuid, created boolean)
language sql as $$
  insert into alert_events as a (device_id, alert_tier, co_ppm, temp_celsius) values (p_device_id, p_tier, 1, 1)
  on conflict (device_id) where resolved_at is null do update set alert_tier = greatest(a.alert_tier, excluded.alert_tier)
  returning a.id, (xmax = 0) $$;
select alert_id as n1 from raise_alert('20000000-0000-0000-0000-000000000010', 2, 400, 80, null, null, false, null) \gset
set role authenticated; select set_config('request.jwt.claim.sub', :'resp', false);
select pg_temp.app_transition(:'n1', 'resolved');
reset role;
select alert_id as n2, created as nc2 from raise_alert_nostopgap_test('20000000-0000-0000-0000-000000000010', 2) \gset
select pg_temp.check(case when :'lifecycle' then '[negative control] even WITHOUT the stopgap, the 6.1 guard alone keeps a new fire from being absorbed (new incident)' else '[negative control] WITHOUT the stopgap the new fire is ABSORBED into the "resolved" incident and stays hidden (this is the hazard)' end,
  case when :'lifecycle' then (:'nc2' = 't' and :'n2' <> :'n1') else (:'nc2' = 'f' and :'n2' = :'n1' and (select incident_status = 'resolved' from alert_events where id = :'n1')) end);
drop function public.raise_alert_nostopgap_test(uuid, integer);

-- ================= stopgap still protects LEGACY rows written before the guard existed (not yet backfilled) =================
\if :lifecycle
select alert_id as l1 from raise_alert('20000000-0000-0000-0000-000000000011', 2, 400, 80, null, null, false, null) \gset
alter table alert_events disable trigger alert_events_lifecycle_guard;
alter table alert_events drop constraint alert_events_lifecycle_sync;
update alert_events set incident_status = 'resolved' where id = :'l1';       -- exactly what the legacy responder UI wrote
alter table alert_events enable trigger alert_events_lifecycle_guard;
alter table alert_events add constraint alert_events_lifecycle_sync check ((incident_status in ('resolved', 'false_alarm')) = (resolved_at is not null)) not valid;
select pg_temp.check('[pre-guard legacy row] status resolved but resolved_at NULL (what an un-backfilled production row looks like)', (select resolved_at is null and incident_status = 'resolved' from alert_events where id = :'l1'));
select alert_id as l2, created as lc2 from raise_alert('20000000-0000-0000-0000-000000000011', 2, 410, 85, null, null, false, null) \gset
select pg_temp.check('[pre-guard legacy row] raise_alert stopgap closes it and a new fire becomes a NEW incident',
  :'lc2' = 't' and :'l2' <> :'l1' and (select resolved_at is not null and incident_status = 'resolved' from alert_events where id = :'l1'));
\endif

-- ================= delete path / seed script compatibility =================
delete from alert_events where device_id = '20000000-0000-0000-0000-000000000009';
select pg_temp.check('deleting alert_events rows (as reset_and_seed_devices.sql does) is unaffected by the index',
  (select count(*) = 0 from alert_events where device_id = '20000000-0000-0000-0000-000000000009'));

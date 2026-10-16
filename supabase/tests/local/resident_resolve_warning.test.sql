-- resident_resolve_warning() (20261109000000). Local harness only.
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$
begin raise notice '%: %', case when ok then 'PASS' else 'FAIL' end, name; end $$;
create or replace function pg_temp.fails_with(sql text, state text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlstate = state; end $$;
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;
\set res1 '00000000-0000-0000-0000-0000000000b1'
\set res2 '00000000-0000-0000-0000-0000000000b2'
\set resp '00000000-0000-0000-0000-0000000000c1'
\set rej  '00000000-0000-0000-0000-0000000000d1'
\set dev1 '10000000-0000-0000-0000-000000000001'

-- an open Tier 1 warning on resident 1's device
insert into alert_events(device_id, alert_tier, co_ppm, temp_celsius) values (:'dev1', 1, 0, 60) returning id as w1 \gset

set role authenticated;
select pg_temp.as_user(:'res2');
select pg_temp.check('another household''s resident cannot resolve it (P0002)', pg_temp.fails_with(format('select resident_resolve_warning(%L)', :'w1'), 'P0002'));
select pg_temp.as_user(:'resp');
select pg_temp.check('a responder cannot use the resident path (42501)', pg_temp.fails_with(format('select resident_resolve_warning(%L)', :'w1'), '42501'));
select pg_temp.as_user(:'rej');
select pg_temp.check('a rejected resident cannot (42501)', pg_temp.fails_with(format('select resident_resolve_warning(%L)', :'w1'), '42501'));
select pg_temp.check('a direct UPDATE is still refused (42501)', pg_temp.fails_with(format('update alert_events set resolved_at = now() where id = %L', :'w1'), '42501'));

select pg_temp.as_user(:'res1');
select resident_resolve_warning(:'w1') is not null as ok \gset
reset role;
select pg_temp.check('owner resolves their Tier 1 warning: closed, attributed, source=resident',
  (select resolved_at is not null and incident_status = 'resolved' and resolved_by = :'res1'::uuid and resolution_source = 'resident'
     from alert_events where id = :'w1'));

set role authenticated; select pg_temp.as_user(:'res1');
select pg_temp.check('a second tap is a no-op, not an error', (select (resident_resolve_warning(:'w1')).id = :'w1'::uuid));
reset role;

-- a Tier 2 fire stays with responders
insert into alert_events(device_id, alert_tier, co_ppm, temp_celsius) values (:'dev1', 2, 400, 80) returning id as f1 \gset
set role authenticated; select pg_temp.as_user(:'res1');
select pg_temp.check('a resident cannot close a Tier 2 fire (55000)', pg_temp.fails_with(format('select resident_resolve_warning(%L)', :'f1'), '55000'));
reset role;
select pg_temp.check('the fire is still open', (select resolved_at is null from alert_events where id = :'f1'));
update alert_events set resolved_at = now() where id = :'f1';

-- a device-closed warning cannot be re-closed by the resident
insert into alert_events(device_id, alert_tier, co_ppm, temp_celsius) values (:'dev1', 1, 0, 60) returning id as w2 \gset
update alert_events set resolved_at = now(), resolution_source = 'device' where id = :'w2';
set role authenticated; select pg_temp.as_user(:'res1');
select pg_temp.check('an already auto-cleared warning is refused (55000)', pg_temp.fails_with(format('select resident_resolve_warning(%L)', :'w2'), '55000'));
reset role;
select pg_temp.check('its source stays device', (select resolution_source = 'device' from alert_events where id = :'w2'));

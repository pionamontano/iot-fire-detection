-- Defense-in-depth follow-up to 6c: the dormant "Admin full access on alert events" FOR ALL policy is
-- replaced with a SELECT-only one (issue #97 follow-up). Local harness only.
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$
begin raise notice '%: %', case when ok then 'PASS' else 'FAIL' end, name; end $$;
create or replace function pg_temp.fails_with(sql text, state text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlstate = state; end $$;
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); end $$;
\set adm '00000000-0000-0000-0000-0000000000a1'

insert into devices(id, device_code, label, location_desc) values
  ('30000000-0000-0000-0000-000000000901', 'L-901', 'Admin policy test', 'loc');
insert into alert_events(device_id, alert_tier, co_ppm, temp_celsius) values
  ('30000000-0000-0000-0000-000000000901', 2, 400, 80) returning id as aid \gset

-- ================= policy state =================
select pg_temp.check('"Admin full access on alert events" policy was dropped', (select count(*) = 0 from pg_policies where tablename = 'alert_events' and policyname = 'Admin full access on alert events'));
select pg_temp.check('"Admin can read alert events" policy exists', (select count(*) = 1 from pg_policies where tablename = 'alert_events' and policyname = 'Admin can read alert events' and cmd = 'SELECT'));

-- ================= admin keeps the capability it actually uses: reading alerts =================
set role authenticated; select pg_temp.as_user(:'adm');
select pg_temp.check('admin can still read alert_events', (select count(*) = 1 from alert_events where id = :'aid'));

-- ================= no RLS backstop left for writes, even for admin =================
select pg_temp.check('admin direct UPDATE is rejected on grants alone (42501)',
  pg_temp.fails_with(format('update alert_events set incident_status = ''acknowledged'' where id = %L', :'aid'), '42501'));
select pg_temp.check('admin direct DELETE is rejected on grants alone (42501)',
  pg_temp.fails_with(format('delete from alert_events where id = %L', :'aid'), '42501'));
reset role;

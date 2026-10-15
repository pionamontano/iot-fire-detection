-- get_incident_resident_contact (20261104000000): who may read the resident's number, and when.
-- Each check prints PASS/FAIL. Local harness only; everything is rolled back.
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$
begin raise notice '%: %', case when ok then 'PASS' else 'FAIL' end, name; end $$;

-- Runs the lookup as `uid`; returns 'ok:<name>:<number>' (or 'ok:none') or 'err:<sqlstate>'.
create or replace function pg_temp.lookup(uid text, alert uuid) returns text language plpgsql as $$
declare r record; out text := 'ok:none';
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  for r in select * from public.get_incident_resident_contact(alert) loop
    out := 'ok:' || r.full_name || ':' || r.contact_number;
  end loop;
  return out;
exception when others then return 'err:' || sqlstate;
end $$;
grant execute on function pg_temp.lookup(text, uuid) to authenticated;

begin;
  insert into alert_events(id, device_id, alert_tier, co_ppm, temp_celsius) values
    ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 2, 400, 80),  -- open fire, T-001
    ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 1, 300, 30);  -- open warning, T-002 (one open incident per device)
  insert into alert_events(id, device_id, alert_tier, co_ppm, temp_celsius, resolved_at) values
    ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 2, 400, 80, now()); -- closed fire
  insert into alert_events(id, device_id, alert_tier, co_ppm, temp_celsius, incident_status) values
    ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 2, 400, 80, 'false_alarm');

  set local role authenticated;
  do $$
  declare
    resp  text := '00000000-0000-0000-0000-0000000000c1';
    fire  uuid := '40000000-0000-0000-0000-000000000001';
  begin
    perform pg_temp.check('responder: open fire -> linked resident only',
      pg_temp.lookup(resp, fire) = 'ok:Resident One:09000000002');
    perform pg_temp.check('responder: open Tier 1 warning -> refused (55000)',
      pg_temp.lookup(resp, '40000000-0000-0000-0000-000000000002') = 'err:55000');
    perform pg_temp.check('responder: resolved fire -> refused (55000)',
      pg_temp.lookup(resp, '40000000-0000-0000-0000-000000000003') = 'err:55000');
    perform pg_temp.check('responder: false alarm -> refused (55000)',
      pg_temp.lookup(resp, '40000000-0000-0000-0000-000000000004') = 'err:55000');
    perform pg_temp.check('responder: unknown alert -> P0002',
      pg_temp.lookup(resp, gen_random_uuid()) = 'err:P0002');
    perform pg_temp.check('admin: open Tier 1 warning -> allowed',
      pg_temp.lookup('00000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-000000000002') = 'ok:Resident Two:09000000003');
    perform pg_temp.check('pending responder -> 42501',
      pg_temp.lookup('00000000-0000-0000-0000-0000000000c2', fire) = 'err:42501');
    perform pg_temp.check('resident (even of this device) -> 42501',
      pg_temp.lookup('00000000-0000-0000-0000-0000000000b1', fire) = 'err:42501');
  end $$;
  reset role;

  -- A deactivated responder, and a deactivated resident who must not be returned.
  update profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000c1';
  set local role authenticated;
  select pg_temp.check('deactivated responder -> 42501',
    pg_temp.lookup('00000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-000000000001') = 'err:42501');
  reset role;
  update profiles set is_active = true where id = '00000000-0000-0000-0000-0000000000c1';
  update profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000b1';
  set local role authenticated;
  select pg_temp.check('deactivated resident is not returned -> no contact',
    pg_temp.lookup('00000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-000000000001') = 'ok:none');
  reset role;

  select pg_temp.check('anon cannot execute',
    not has_function_privilege('anon', 'public.get_incident_resident_contact(uuid)', 'execute'));
rollback;

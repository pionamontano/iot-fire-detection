-- get_auth_role() is NULL for pending/rejected accounts, so role-gated RLS denies them.
-- Each check prints PASS/FAIL. Local harness only; changes are rolled back.
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$
begin raise notice '%: %', case when ok then 'PASS' else 'FAIL' end, name; end $$;

-- approved accounts keep their role
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.role','authenticated',true);
  select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',true);
  do $$ declare n int; begin
    perform pg_temp.check('approved responder: get_auth_role() = bfp_responder', get_auth_role() = 'bfp_responder');
    select count(*) into n from devices_safe where device_code like 'T-%';
    perform pg_temp.check('approved responder sees devices (got '||n||')', n=2);
  end $$;
rollback;

-- pending responder (fixture c2)
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.role','authenticated',true);
  select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c2',true);
  do $$ declare n int; begin
    perform pg_temp.check('pending responder: get_auth_role() is null', get_auth_role() is null);
    select count(*) into n from devices_safe where device_code like 'T-%';
    perform pg_temp.check('pending responder sees no devices (got '||n||')', n=0);
    select count(*) into n from alert_events;
    perform pg_temp.check('pending responder sees no alert events (got '||n||')', n=0);
    select count(*) into n from profiles;
    perform pg_temp.check('pending responder still reads own profile (got '||n||')', n=1);
  end $$;
rollback;

-- rejected resident (fixture d1), given a device to prove the resident policy now ignores them
begin;
  insert into devices(id,device_code,label,location_desc) values ('10000000-0000-0000-0000-000000000009','T-009','Unit 9','Loc 9');
  update profiles set device_id='10000000-0000-0000-0000-000000000009' where id='00000000-0000-0000-0000-0000000000d1';
  set local role authenticated;
  select set_config('request.jwt.claim.role','authenticated',true);
  select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',true);
  do $$ declare n int; begin
    perform pg_temp.check('rejected resident: get_auth_role() is null', get_auth_role() is null);
    select count(*) into n from devices_safe where device_code like 'T-%';
    perform pg_temp.check('rejected resident sees no devices (got '||n||')', n=0);
  end $$;
rollback;

-- a pending profile with the admin role gets no admin access
begin;
  update profiles set status='pending' where id='00000000-0000-0000-0000-0000000000a1';
  set local role authenticated;
  select set_config('request.jwt.claim.role','authenticated',true);
  select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
  do $$ declare n int; begin
    perform pg_temp.check('pending admin: get_auth_role() is null', get_auth_role() is null);
    select count(*) into n from registration_requests;
    perform pg_temp.check('pending admin reads no registration requests (got '||n||')', n=0);
    select count(*) into n from login_attempts;
    perform pg_temp.check('pending admin reads no login attempts (got '||n||')', n=0);
  end $$;
rollback;

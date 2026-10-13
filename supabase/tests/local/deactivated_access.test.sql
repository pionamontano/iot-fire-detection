-- Deactivated accounts (profiles.is_active = false) lose RLS access immediately, even with a
-- still-valid access token. Each check prints PASS/FAIL. Local harness only; changes are rolled back.
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$
begin raise notice '%: %', case when ok then 'PASS' else 'FAIL' end, name; end $$;

-- baseline: active accounts keep their access
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.role','authenticated',true);
  select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
  do $$ declare n int; begin
    select count(*) into n from profiles; perform pg_temp.check('active admin sees all profiles (got '||n||')', n=6);
    perform pg_temp.check('active admin: get_auth_role() = admin', get_auth_role() = 'admin');
  end $$;
rollback;

-- deactivated admin
begin;
  update profiles set is_active = false where id='00000000-0000-0000-0000-0000000000a1';
  set local role authenticated;
  select set_config('request.jwt.claim.role','authenticated',true);
  select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
  do $$ declare n int; begin
    select count(*) into n from profiles; perform pg_temp.check('deactivated admin sees only own profile (got '||n||')', n=1);
    perform pg_temp.check('deactivated admin: is_approved_admin() is false', not public.is_approved_admin());
    perform pg_temp.check('deactivated admin: get_auth_role() is null', get_auth_role() is null);
    select count(*) into n from profiles where id = auth.uid() and is_active = false;
    perform pg_temp.check('deactivated admin can still read own row (for the deactivated screen)', n=1);
  end $$;
rollback;

-- deactivated resident loses device access
begin;
  update profiles set is_active = false where id='00000000-0000-0000-0000-0000000000b1';
  set local role authenticated;
  select set_config('request.jwt.claim.role','authenticated',true);
  select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',true);
  do $$ declare n int; begin
    perform pg_temp.check('deactivated resident: get_auth_role() is null', get_auth_role() is null);
    select count(*) into n from devices_safe where device_code like 'T-%';
    perform pg_temp.check('deactivated resident sees no devices (got '||n||')', n=0);
  end $$;
rollback;

-- deactivated responder loses device access
begin;
  update profiles set is_active = false where id='00000000-0000-0000-0000-0000000000c1';
  set local role authenticated;
  select set_config('request.jwt.claim.role','authenticated',true);
  select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',true);
  do $$ declare n int; begin
    select count(*) into n from devices_safe where device_code like 'T-%';
    perform pg_temp.check('deactivated responder sees no devices (got '||n||')', n=0);
  end $$;
rollback;

-- DB-002: cross-user profile reads. Each check prints PASS/FAIL. Local harness only.
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); perform set_config('request.jwt.claim.role','authenticated',false); end $$;
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$
begin raise notice '%: %', case when ok then 'PASS' else 'FAIL' end, name; end $$;

set role authenticated;
do $$ declare n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  select count(*) into n from profiles;                       perform pg_temp.check('resident sees only own profile (got '||n||')', n=1);
  select count(*) into n from profiles where id <> auth.uid(); perform pg_temp.check('resident cannot read other profiles', n=0);

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  select count(*) into n from profiles;                       perform pg_temp.check('approved responder sees only own profile (got '||n||')', n=1);

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
  select count(*) into n from profiles;                       perform pg_temp.check('pending responder sees only own profile (got '||n||')', n=1);

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  select count(*) into n from profiles;                       perform pg_temp.check('rejected resident sees only own profile (got '||n||')', n=1);

  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
  select count(*) into n from profiles;                       perform pg_temp.check('approved admin sees all profiles (got '||n||')', n=6);
end $$;
-- dependent policies must still work for non-admins
do $$ declare n int; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
  select count(*) into n from devices_safe;                   perform pg_temp.check('resident still sees own device via devices_safe (got '||n||')', n=1);
  perform pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
  select count(*) into n from devices_safe;                   perform pg_temp.check('responder still sees devices via devices_safe (got '||n||')', n=2);
end $$;
-- unauthenticated / anon
reset role; set role anon;
do $$ declare n int; begin
  perform set_config('request.jwt.claim.sub','',false); perform set_config('request.jwt.claim.role','anon',false);
  begin select count(*) into n from profiles; perform pg_temp.check('anon reads no profiles (got '||n||')', n=0);
  exception when insufficient_privilege then perform pg_temp.check('anon denied on profiles', true); end;
end $$;
reset role;

-- helper privileges and its own authorization check
do $$ begin
  perform pg_temp.check('anon cannot execute is_approved_admin()', not has_function_privilege('anon','public.is_approved_admin()','execute'));
  perform pg_temp.check('authenticated can execute is_approved_admin()', has_function_privilege('authenticated','public.is_approved_admin()','execute'));
  perform pg_temp.check('helper pins search_path', (select proconfig::text like '%search_path=public, pg_temp%' from pg_proc where proname='is_approved_admin'));
end $$;
-- an admin whose account is not approved gets no elevated read access (rolled back afterwards)
begin;
  update profiles set status='pending' where id='00000000-0000-0000-0000-0000000000a1';
  set local role authenticated;
  select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
  do $$ declare n int; begin select count(*) into n from profiles;
    perform pg_temp.check('pending admin sees only own profile (got '||n||')', n=1); end $$;
rollback;

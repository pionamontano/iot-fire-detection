-- KI-25 (issue #110): get_dashboard_stats() must be admin-only, not PUBLIC-executable. Local harness only.
create or replace function pg_temp.check(name text, ok boolean) returns void language plpgsql as $$
begin raise notice '%: %', case when ok then 'PASS' else 'FAIL' end, name; end $$;
create or replace function pg_temp.fails_with(sql text, state text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlstate = state; end $$;
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); perform set_config('request.jwt.claim.role','authenticated',false); end $$;

select pg_temp.check('search_path is pinned', (select proconfig::text like '%search_path=public, pg_temp%' from pg_proc where proname = 'get_dashboard_stats'));
select pg_temp.check('anon has no execute privilege', not has_function_privilege('anon', 'public.get_dashboard_stats()', 'execute'));
select pg_temp.check('authenticated has table-grant execute (the internal check below is what actually restricts it)', has_function_privilege('authenticated', 'public.get_dashboard_stats()', 'execute'));

set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select pg_temp.check('an approved RESIDENT cannot call it (42501)', pg_temp.fails_with($q$select get_dashboard_stats()$q$, '42501'));
reset role;

set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.check('an approved RESPONDER cannot call it (42501)', pg_temp.fails_with($q$select get_dashboard_stats()$q$, '42501'));
reset role;

set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.check('a PENDING responder cannot call it (42501)', pg_temp.fails_with($q$select get_dashboard_stats()$q$, '42501'));
reset role;

reset role; set role anon;
select pg_temp.check('anon cannot call it (insufficient_privilege, blocked before the function body runs)',
  pg_temp.fails_with($q$select get_dashboard_stats()$q$, '42501'));
reset role;

set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select pg_temp.check('an approved ADMIN can call it and gets real counts',
  (select (get_dashboard_stats()->>'total_users')::int = (select count(*) from profiles)));
reset role;

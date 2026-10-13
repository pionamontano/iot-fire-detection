-- =============================================================
-- Deactivated accounts lose database access immediately.
--
-- manage-user deactivation sets profiles.is_active = false and bans
-- the auth user. The ban stops new sign-ins and token refreshes, but
-- an access token issued before it stays valid until it expires
-- (up to the JWT lifetime, 1 hour by default). Until now RLS never
-- looked at is_active, so for that window a deactivated user - an
-- admin included - kept every read/write their role allowed.
--
-- Both RLS role helpers now treat an inactive account as having no
-- role:
--   * get_auth_role()     -> NULL when is_active = false, so every
--     "get_auth_role() = '<role>'" / "is not null" policy and RPC
--     check denies them;
--   * is_approved_admin() -> false when is_active = false.
-- Own-row profile reads (id = auth.uid()) are unaffected, so the app
-- can still load the profile and show the "Account Deactivated" screen.
--
-- Not changed here: get_auth_role() still ignores profiles.status
-- (see 20261019000000_restrict_profile_reads.sql).
--
-- Rollback: re-run the previous definitions from
-- 20260717000000_init.sql (get_auth_role) and
-- 20261019000000_restrict_profile_reads.sql (is_approved_admin).
-- =============================================================

create or replace function public.get_auth_role()
returns text
language sql
stable
as $$
  select role from public.profiles where id = auth.uid() and is_active;
$$;

create or replace function public.is_approved_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.status = 'approved'
      and p.is_active
  );
$$;

revoke all on function public.is_approved_admin() from public, anon;
grant execute on function public.is_approved_admin() to authenticated;

-- STAGING ONLY. 20261019000000_restrict_profile_reads.sql. Run after the previous file, then run the checks in docs/STAGING_DRY_RUN_RUNBOOK.md.
-- GUARD: only runs where staging_setup.sql was applied (staging marker present).
do $g$ begin
  if to_regnamespace('_staging_marker') is null then
    raise exception 'REFUSING TO RUN: staging marker missing. Run staging_setup.sql on the NEW staging project first; never run this on production.';
  end if;
end $g$;

-- =============================================================
-- DB-002: restrict cross-user profile reads.
--
-- Before: "Approved users can read profiles" was
--     get_auth_role() IS NOT NULL OR id = auth.uid()
-- get_auth_role() (init.sql) returns profiles.role with NO check on
-- profiles.status, so it is non-NULL for every account that has a
-- profile row. Every authenticated account - residents, responders,
-- and even pending/rejected ones - could therefore read every
-- profile (name, phone, address, device_id, telegram_chat_id).
-- It also made the policy self-referential: the policy called
-- get_auth_role(), which SELECTs profiles, which re-enters the policy.
--
-- After: a user may read their own row (needed by AuthContext, and by
-- pending/rejected users to reach the pending/rejected screens);
-- only an APPROVED ADMIN may read other users' rows.
--
-- The admin check goes through a SECURITY DEFINER helper so that it
-- does not re-enter the profiles policy (no recursion). The helper:
--   * pins search_path (public, pg_temp), schema-qualifies its table;
--   * validates the caller itself: auth.uid() must map to a profile
--     with role = 'admin' AND status = 'approved', otherwise false
--     (an unauthenticated caller has auth.uid() = NULL -> false);
--   * returns only a boolean, never row data;
--   * is executable by authenticated only (revoked from PUBLIC/anon).
--
-- Dependent policies are unaffected: every other policy that reads
-- profiles does so for the caller's own row (id = auth.uid()), which
-- the new policy still allows. Non-admin clients never read other
-- profiles (see src/: only admin Users/Dashboard do).
--
-- Realtime: postgres_changes on public.profiles is subscribed only by
-- src/pages/admin/Dashboard.tsx. Realtime applies this SELECT policy
-- per subscriber, so approved admins keep receiving all profile
-- changes; any other subscriber would receive only their own row.
-- (Live Realtime behaviour is unverified - see the report.)
--
-- NOT changed here (out of scope, reported separately):
-- get_auth_role() still ignores profiles.status.
--
-- Rollback:
--   drop policy "Users read own profile, approved admins read all" on public.profiles;
--   create policy "Approved users can read profiles" on public.profiles
--     for select using (get_auth_role() is not null or id = auth.uid());
--   (the helper function may stay or be dropped; nothing else uses it)
-- =============================================================

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
  );
$$;

revoke all on function public.is_approved_admin() from public, anon;
grant execute on function public.is_approved_admin() to authenticated;

drop policy if exists "Approved users can read profiles" on public.profiles;

create policy "Users read own profile, approved admins read all"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_approved_admin());

-- =============================================================
-- Close two access gaps found by the black-box suite (tests/e2e).
--
-- 1. settings readable by every signed-in account.
--    20260917030000 meant to limit settings reads to approved users. It
--    dropped "Anyone authenticated can read settings", but init.sql had
--    named that policy "Authenticated users can read settings", so the
--    IF EXISTS drop did nothing. Permissive policies are ORed, so any
--    authenticated session (pending, rejected, deactivated) could still
--    read every settings row. "Approved users can read settings" and the
--    admin policy remain and cover every legitimate reader (useIdleTimeout
--    runs only for approved users; the admin Settings page).
--
-- 2. check_login_lockout callable by clients.
--    20260924080000 revoked EXECUTE from anon/authenticated so that only
--    the login Edge Function (service role) can call it, but functions are
--    executable by PUBLIC by default and that grant was left in place, so
--    any caller could still probe any email's lockout state. service_role
--    keeps its explicit grant (20261105000000).
--
-- Rollback:
--   create policy "Authenticated users can read settings" on public.settings
--     for select using (auth.role() = 'authenticated');
--   grant execute on function public.check_login_lockout(text) to public;
-- =============================================================

drop policy if exists "Authenticated users can read settings" on public.settings;

revoke execute on function public.check_login_lockout(text) from public;

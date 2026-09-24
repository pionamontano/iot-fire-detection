-- =============================================================
-- SW-2.6.2 fix: login lockout had no real enforcement. Login.tsx
-- now goes through the new `login` Edge Function (service role)
-- instead of calling signInWithPassword() and inserting into
-- login_attempts directly from the browser - see that function for
-- the full writeup of what was broken and confirmed live.
--
-- With the client no longer needing either of these directly, lock
-- them down the same way CRIT-03 (20260924000000, further back)
-- locked down sensor_readings/alert_events inserts once their real
-- write path moved server-side:
--
-- - login_attempts INSERT: previously WITH CHECK (true) for anyone,
--   which let a caller inject fake success rows (audit poisoning)
--   or fake failure rows against an arbitrary victim's email (a
--   trivial denial-of-service: lock someone else's account on
--   demand with a few unauthenticated POSTs). The `login` function
--   uses the service role, which bypasses this grant regardless.
-- - check_login_lockout EXECUTE: previously callable by anyone,
--   letting a caller enumerate whether an arbitrary email currently
--   has 3+ recent failures - a minor account-activity info leak.
--   Nothing in the browser calls this RPC directly anymore either;
--   the `login` function calls it via the service role, which
--   isn't affected by revoking the anon/authenticated grant.
-- =============================================================

revoke insert on public.login_attempts from anon, authenticated;

drop policy if exists "Allow inserting login attempts" on public.login_attempts;
create policy "Direct client inserts are blocked - use the login function"
  on public.login_attempts
  for insert
  to anon, authenticated
  with check (false);

revoke execute on function public.check_login_lockout(text) from anon, authenticated;

-- =============================================================
-- MED-03 fix: Login.tsx's lockout (3 failures -> 10s, 5 -> 30s, 7 ->
-- "locked") was React state only - it reset on every page refresh
-- and never persisted anywhere. login_attempts existed with RLS
-- ready for it but nothing in the app ever wrote to it.
--
-- Fix: a SECURITY DEFINER function the client can call to check
-- whether an email is currently rate-limited, based on real rows in
-- login_attempts, without needing SELECT access to the table itself
-- (which stays admin-only - this function only ever returns a
-- boolean and a wait time, never raw attempt history, so it can't be
-- used to enumerate whether an email has an account).
--
-- The client still inserts each attempt's outcome directly via the
-- existing "Allow inserting login attempts" policy (WITH CHECK true)
-- - see the accompanying Login.tsx change. This is a same-origin
-- advisory lockout (Supabase Auth's own sign-in itself isn't gated
-- by it, only this app's UI is) backed by real rather than
-- in-memory data, and a real audit trail for the admin Logs page.
-- =============================================================

create or replace function public.check_login_lockout(p_email text)
returns table(locked boolean, retry_after_seconds int)
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_failures int;
  lockout_seconds int := 0;
begin
  select count(*) into recent_failures
  from login_attempts
  where email = p_email
    and success = false
    and attempted_at > now() - interval '15 minutes';

  if recent_failures >= 7 then
    lockout_seconds := 900;
  elsif recent_failures >= 5 then
    lockout_seconds := 30;
  elsif recent_failures >= 3 then
    lockout_seconds := 10;
  end if;

  return query select (lockout_seconds > 0), lockout_seconds;
end;
$$;

grant execute on function public.check_login_lockout(text) to anon, authenticated;

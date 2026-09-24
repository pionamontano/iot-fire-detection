-- =============================================================
-- SW-2.6.2 gap: the spec's progressive lockout ("7 failures -> locked
-- account message requiring Administrator intervention") implies an
-- admin can manually clear a lockout. check_login_lockout()
-- (20260917060000) is purely time-window based (recent failures in
-- the last 15 minutes) with no way to end it early - it just expires
-- on its own.
--
-- Fix: a small overrides table an admin unlock writes a fresh
-- timestamp into, and check_login_lockout() only counts failures
-- after that timestamp (in addition to the normal 15-minute window).
-- This resets the lockout immediately without deleting login_attempts
-- rows, which stay intact as the audit trail the earlier migration's
-- comment describes.
-- =============================================================

create table if not exists public.login_lockout_overrides (
  email text primary key,
  unlocked_at timestamptz not null default now(),
  unlocked_by uuid references auth.users(id)
);

alter table public.login_lockout_overrides enable row level security;

create policy "Admin can manage lockout overrides"
  on public.login_lockout_overrides
  for all
  using (public.get_auth_role() = 'admin');

create or replace function public.admin_unlock_login(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.get_auth_role() <> 'admin' then
    raise exception 'Only an admin can unlock a login lockout';
  end if;

  insert into login_lockout_overrides (email, unlocked_at, unlocked_by)
  values (p_email, now(), auth.uid())
  on conflict (email) do update
    set unlocked_at = excluded.unlocked_at,
        unlocked_by = excluded.unlocked_by;
end;
$$;

grant execute on function public.admin_unlock_login(text) to authenticated;

create or replace function public.check_login_lockout(p_email text)
returns table(locked boolean, retry_after_seconds int)
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_failures int;
  lockout_seconds int := 0;
  v_window_start timestamptz;
  v_override_at timestamptz;
begin
  select unlocked_at into v_override_at
  from login_lockout_overrides
  where email = p_email;

  v_window_start := greatest(now() - interval '15 minutes', coalesce(v_override_at, now() - interval '15 minutes'));

  select count(*) into recent_failures
  from login_attempts
  where email = p_email
    and success = false
    and attempted_at > v_window_start;

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

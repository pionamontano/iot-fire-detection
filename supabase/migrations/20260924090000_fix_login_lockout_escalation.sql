-- =============================================================
-- SW-2.6.2 follow-up: the `login` Edge Function (20260924080000
-- and the function itself) fixed check_login_lockout being
-- skippable, but testing that fix live exposed a second, separate
-- bug underneath: check_login_lockout's tiers were never actually
-- reachable past the first one hit, even with perfect enforcement.
--
-- The function only ever asked "are there >= N failures in the
-- last 15 minutes", with no time decay - once recent_failures hits
-- 3, EVERY check for the next up-to-15-minutes returns locked=true
-- for the SAME flat 10s, forever, because nothing ever lets a new
-- attempt through to become failure #4. Confirmed live against the
-- newly-deployed login function: 7 real POSTs to it produced only
-- 3 recorded login_attempts rows - attempts 4-7 were all refused
-- before ever reaching GoTrue, identical to the pre-fix bug, just
-- now consistently enforced instead of skippable.
--
-- Fix: track time elapsed since the most recent failure. Once the
-- current tier's cooldown has actually elapsed, let exactly one
-- more real attempt through (locked=false) instead of refusing
-- forever. If that attempt also fails, the caller's next check
-- correctly sees one more failure, escalating to the next tier
-- (3->10s, 5->30s, 7->900s) exactly as SW-2.6.2 describes. This
-- also makes retry_after_seconds a real, decaying remaining-time
-- value instead of a flat number that never changes.
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
  v_window_start timestamptz;
  v_override_at timestamptz;
  v_last_failure_at timestamptz;
  v_elapsed_seconds numeric;
begin
  select unlocked_at into v_override_at
  from login_lockout_overrides
  where email = p_email;

  v_window_start := greatest(now() - interval '15 minutes', coalesce(v_override_at, now() - interval '15 minutes'));

  select count(*), max(attempted_at) into recent_failures, v_last_failure_at
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

  if lockout_seconds = 0 or v_last_failure_at is null then
    return query select false, 0;
    return;
  end if;

  v_elapsed_seconds := extract(epoch from (now() - v_last_failure_at));

  if v_elapsed_seconds >= lockout_seconds then
    -- This tier's cooldown has elapsed since the last failure: let
    -- exactly one more real attempt through. If it fails too, the
    -- next check will see recent_failures+1 and escalate correctly.
    return query select false, 0;
  else
    return query select true, ceil(lockout_seconds - v_elapsed_seconds)::int;
  end if;
end;
$$;

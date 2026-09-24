-- =============================================================
-- CRITICAL fix: admin_unlock_login and regenerate_device_api_key
-- both gated their admin-only logic with:
--
--   if public.get_auth_role() <> 'admin' then raise exception ...
--
-- get_auth_role() returns NULL for any unauthenticated, pending, or
-- rejected caller. In SQL, NULL <> 'admin' evaluates to NULL (not
-- TRUE), and PL/pgSQL's `IF NULL THEN` is treated as false - so the
-- exception never raised and both functions fell through as if the
-- caller *were* admin.
--
-- Confirmed live against production: an anonymous, unauthenticated
-- client could call admin_unlock_login for any email and
-- successfully clear that account's brute-force lockout override,
-- completely defeating check_login_lockout(). regenerate_device_api_key
-- has the identical bug, currently non-exploitable only by the
-- accident of a second, unrelated bug fixed below.
--
-- Fix: use `IS DISTINCT FROM` instead of `<>`, which treats NULL
-- correctly (NULL IS DISTINCT FROM 'admin' is TRUE, so the exception
-- now raises for any non-admin caller, NULL included).
--
-- Also fixes a second bug found alongside it while verifying the
-- above: regenerate_device_api_key declares `set search_path =
-- public`, which doesn't include the schema gen_random_bytes()
-- actually resolves in on this project - so even a genuine admin's
-- call failed with "function gen_random_bytes(integer) does not
-- exist" immediately after passing the (now-fixed) admin check.
-- devices.api_key's column DEFAULT isn't affected by this since it
-- runs with the calling session's own search_path, not a
-- function-local override.
-- =============================================================

create or replace function public.admin_unlock_login(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.get_auth_role() is distinct from 'admin' then
    raise exception 'Only an admin can unlock a login lockout';
  end if;

  insert into login_lockout_overrides (email, unlocked_at, unlocked_by)
  values (p_email, now(), auth.uid())
  on conflict (email) do update
    set unlocked_at = excluded.unlocked_at,
        unlocked_by = excluded.unlocked_by;
end;
$$;

create or replace function public.regenerate_device_api_key(p_device_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_new_key text;
begin
  if public.get_auth_role() is distinct from 'admin' then
    raise exception 'Only an admin can regenerate a device API key';
  end if;

  v_new_key := 'sk_' || encode(gen_random_bytes(24), 'hex');

  update devices
  set api_key = v_new_key
  where id = p_device_id;

  if not found then
    raise exception 'Device not found';
  end if;

  return v_new_key;
end;
$$;

-- Clean up the lockout override created by anonymous exploitation
-- during live testing (dbtest-valid@example.com is a throwaway test
-- address used to demonstrate the bug, not a real account).
delete from public.login_lockout_overrides where email = 'dbtest-valid@example.com';

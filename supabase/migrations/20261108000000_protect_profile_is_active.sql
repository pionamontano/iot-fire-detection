-- =============================================================
-- KI-10: a deactivated user could re-activate their own profile.
--
-- manage-user deactivation sets profiles.is_active = false and bans the
-- auth user. The ban stops new sign-ins and token refreshes, but an access
-- token issued before it stays valid until it expires (1 h by default).
-- protect_profile_fields() did not cover is_active, and the self-update
-- policy ("id = auth.uid()") lets any user update their own row, so during
-- that window the user could run
--   update profiles set is_active = true where id = auth.uid()
-- and get_auth_role() returned their role again. The change persisted: the
-- account went back into every alert fan-out and showed as active to admins.
--
-- Two changes:
--   * is_active joins role/status/device_id/telegram_chat_id as a column only
--     an admin (or the service role, i.e. manage-user) can change.
--   * The admin check uses is_approved_admin() instead of the bare role, so a
--     deactivated or unapproved admin is no longer exempt. Before this, a
--     deactivated admin could flip its own is_active (and status) back.
--
-- Unchanged on purpose:
--   * setup_complete stays user-writable: ResidentSetup.tsx sets it on the
--     user's own row when first-run setup is finished.
--   * Only Data API requests (role `authenticated`/`anon`) are guarded. The
--     service role and sessions that never switch role (SQL editor, migrations,
--     maintenance scripts) keep bypassing it, as before.
--
-- Rollback: re-run the function from 20261026000000_telegram_chat_id_uniqueness_and_guard.sql.
-- =============================================================

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Guard only Data API requests, which PostgREST runs as `authenticated` (or `anon`). The service
  -- role (manage-user, telegram-webhook) and sessions that never switch role (SQL editor, migrations,
  -- maintenance scripts) may change anything, as before.
  if coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon') then
    return new;
  end if;

  if not public.is_approved_admin() then
    new.role             = old.role;
    new.status           = old.status;
    new.device_id        = old.device_id;
    new.telegram_chat_id = old.telegram_chat_id;
    new.is_active        = old.is_active;
  end if;

  return new;
end;
$$;

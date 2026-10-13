-- =============================================================
-- Step 5.4/5.5 (issue #95): per-user Telegram — uniqueness and a closed write path.
--
-- D5.5 (refuse, don't move): a Telegram chat must link to exactly one profile. Without this constraint,
-- two accounts could end up sharing one chat_id and one of them would silently stop receiving alerts
-- (or receive someone else's). The webhook (Step 5.4 code change, not part of this migration) is
-- responsible for refusing a relink attempt gracefully; this unique index is the database-level
-- backstop if it doesn't.
--
-- Closed write path: profiles.telegram_chat_id was not covered by protect_profile_fields(), so any
-- authenticated user could set or clear their own (or, prior to 20261019000000's read restriction,
-- possibly another's) telegram_chat_id directly via PostgREST, bypassing the webhook's one-time-token
-- flow entirely (no proof of owning that Telegram chat). From here on it is set only by the service role
-- (telegram-webhook) or by an admin; the owning user can read it but not write it, matching role/status/
-- device_id.
--
-- Rollback: drop index telegram_chat_id_unique; restore protect_profile_fields() to the
-- 20260717000000 definition (role/status/device_id only).
--
-- Pre-existing duplicates: before this migration, telegram_chat_id had no uniqueness guard and
-- was writable by any authenticated user, so some environments ended up with two profiles sharing
-- one chat_id. The unique index can't be created over those rows, so we deduplicate first: the
-- most recently created profile keeps the link, and older duplicates are cleared (their owners
-- will need to re-link via the webhook's token flow).
-- =============================================================

WITH ranked AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY telegram_chat_id
      ORDER BY created_at DESC, id
    ) AS rn
  FROM public.profiles
  WHERE telegram_chat_id IS NOT NULL
)
UPDATE public.profiles
SET telegram_chat_id = NULL
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS telegram_chat_id_unique
  ON public.profiles (telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

CREATE OR REPLACE FUNCTION protect_profile_fields()
RETURNS trigger AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- Let superuser/service_role bypass
  IF current_setting('role') = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();

  -- If not an admin, prevent changing own role, status, device assignment, or Telegram link
  -- (telegram_chat_id is set only via the webhook's token-verified flow, service role above).
  IF v_role != 'admin' THEN
    NEW.role = OLD.role;
    NEW.status = OLD.status;
    NEW.device_id = OLD.device_id;
    NEW.telegram_chat_id = OLD.telegram_chat_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

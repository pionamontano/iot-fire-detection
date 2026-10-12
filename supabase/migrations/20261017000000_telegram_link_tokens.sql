-- One-time, short-lived tokens for linking a Telegram chat to a profile.
-- Replaces putting the raw profile id in the t.me deep link, which let anyone
-- who knew a user's id hijack that user's Telegram alerts.
CREATE TABLE IF NOT EXISTS public.telegram_link_tokens (
    token TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_link_tokens_user_id_idx
    ON public.telegram_link_tokens (user_id);

-- No policies: only the service role (telegram-webhook) and the RPC below touch it.
ALTER TABLE public.telegram_link_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_link_tokens FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_telegram_link_token()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Only one outstanding token per user; also sweep expired ones.
  DELETE FROM telegram_link_tokens
   WHERE user_id = auth.uid() OR expires_at < now();

  -- 64 hex chars (fits Telegram's 64-char /start payload limit)
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO telegram_link_tokens (token, user_id, expires_at)
  VALUES (v_token, auth.uid(), now() + interval '15 minutes');

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.create_telegram_link_token() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_telegram_link_token() TO authenticated;

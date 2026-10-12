-- =============================================================
-- Step 5.1a: persistent notification delivery ledger (INERT).
--
-- Adds a table plus claim/complete functions. Nothing in the app calls them yet (trigger-alert is
-- unchanged until Step 5.2), so applying this migration changes no runtime behaviour.
--
-- DELIVERY SEMANTICS: AT-LEAST-ONCE, NOT EXACTLY-ONCE.
--   Flow per (alert incident, tier, channel, recipient):
--       claim_notification()  ->  call the provider  ->  complete_notification()
--   The claim stops two CONCURRENT senders (or a replayed request) from both sending, which removes
--   most duplicates. It cannot make delivery exactly-once, because the provider call and the database
--   write are separate steps that can be interrupted between each other:
--     * provider ACCEPTED the message but the sender timed out/crashed before recording 'sent'
--       -> the row stays 'pending'; after the stale interval it can be reclaimed and the message sent
--          AGAIN. A recipient can therefore receive a duplicate. This is deliberate: for a fire alert a
--          duplicate is preferable to a lost message.
--     * provider REJECTED or never saw the message -> recorded 'failed', retried up to p_max_attempts.
--   Telegram sendMessage has no idempotency key. Web Push offers a `Topic` header that lets the push
--   service replace an undelivered message with the same topic (a partial mitigation for Step 5.2);
--   SMS from the SIM800L has no such mechanism. 'sent' therefore means "the provider accepted it",
--   never "a person read it".
--   See docs/ALERT_DELIVERY_AND_INCIDENT_INVARIANTS.md.
--
-- Access: service role only. RLS is enabled with NO policies and all client privileges are revoked.
-- (An admin read policy for a delivery-log screen is a later, separate change.)
--
-- Rollback: drop function complete_notification, claim_notification; drop table alert_notifications.
-- =============================================================

create table if not exists public.alert_notifications (
  id              uuid primary key default gen_random_uuid(),
  alert_event_id  uuid not null references public.alert_events(id) on delete cascade,
  tier            smallint not null check (tier in (1, 2)),
  channel         text not null check (channel in ('telegram_station', 'telegram_user', 'push')),
  recipient_key   text not null,   -- profile id for per-user channels, 'station' for the shared chat
  status          text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  retryable       boolean not null default true,   -- false for permanent provider errors (e.g. bot blocked)
  attempts        integer not null default 1,
  provider_status text,            -- HTTP status or provider code, as reported
  provider_ref    text,            -- provider message id when one is returned
  error           text,
  claimed_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (alert_event_id, tier, channel, recipient_key)
);

alter table public.alert_notifications enable row level security;
revoke all on public.alert_notifications from anon, authenticated;

-- Returns true ONLY to the caller that should perform the send now:
--   * first ever claim for the key, or
--   * a previous attempt FAILED and is retryable and attempts < p_max_attempts, or
--   * a previous claim is still 'pending' but older than p_stale (sender presumably crashed/timed out;
--     this is the window in which a duplicate can occur - see the header).
-- 'sent' and 'skipped' rows are terminal and are never claimed again.
create or replace function public.claim_notification(
  p_alert        uuid,
  p_tier         integer,
  p_channel      text,
  p_recipient    text,
  p_max_attempts integer  default 3,
  p_stale        interval default interval '2 minutes'
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into alert_notifications as n (alert_event_id, tier, channel, recipient_key)
  values (p_alert, p_tier, p_channel, p_recipient)
  on conflict (alert_event_id, tier, channel, recipient_key) do update
     set attempts = n.attempts + 1, status = 'pending', claimed_at = now(), updated_at = now()
   where n.attempts < p_max_attempts
     and ( (n.status = 'failed' and n.retryable)
        or (n.status = 'pending' and n.claimed_at < now() - p_stale) )
  returning n.id into v_id;

  return v_id is not null;
end;
$$;

-- Record the outcome of a send. p_status: 'sent' | 'failed' | 'skipped' (e.g. recipient has no endpoint).
create or replace function public.complete_notification(
  p_alert           uuid,
  p_tier            integer,
  p_channel         text,
  p_recipient       text,
  p_status          text,
  p_provider_status text    default null,
  p_provider_ref    text    default null,
  p_error           text    default null,
  p_retryable       boolean default true
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'invalid status %', p_status using errcode = '22023';
  end if;

  update alert_notifications
     set status = p_status,
         provider_status = p_provider_status,
         provider_ref = p_provider_ref,
         error = p_error,
         retryable = case when p_status = 'failed' then p_retryable else retryable end,
         updated_at = now()
   where alert_event_id = p_alert and tier = p_tier and channel = p_channel and recipient_key = p_recipient;
end;
$$;

revoke all on function public.claim_notification(uuid, integer, text, text, integer, interval) from public, anon, authenticated;
revoke all on function public.complete_notification(uuid, integer, text, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_notification(uuid, integer, text, text, integer, interval) to service_role;
grant execute on function public.complete_notification(uuid, integer, text, text, text, text, text, text, boolean) to service_role;

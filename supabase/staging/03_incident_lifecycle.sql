-- STAGING ONLY. 20261021000000_incident_lifecycle.sql. Run after the previous file, then run the checks in docs/STAGING_DRY_RUN_RUNBOOK.md.
-- GUARD: only runs where staging_setup.sql was applied (staging marker present).
do $g$ begin
  if to_regnamespace('_staging_marker') is null then
    raise exception 'REFUSING TO RUN: staging marker missing. Run staging_setup.sql on the NEW staging project first; never run this on production.';
  end if;
end $g$;

-- =============================================================
-- Step 6.1: incident lifecycle - one consistent definition of "closed", enforced by the database.
--
-- Problem (confirmed by test, see docs/ALERT_DELIVERY_AND_INCIDENT_INVARIANTS.md): alert_events carries
-- two independently written fields, incident_status and resolved_at, and the writers disagree:
--   * responder dashboard "Resolve"/"False Alarm" sets incident_status only (resolved_at stays NULL)
--   * admin "Resolve" and ingest-reading's auto-resolve set resolved_at only (status stays 'active')
-- Everything that reads "open" uses resolved_at IS NULL, so a responder-closed incident still looks open
-- (and, once the one-open-incident index from 5.1b is active, would swallow a new fire).
--
-- This migration (all additive; applies and works with today's UI and edge functions unchanged):
--   1. adds resolved_by / resolution_source for audit;
--   2. a BEFORE INSERT/UPDATE guard trigger that makes the two fields agree for EVERY writer
--      (legacy UI, edge functions, manual SQL) and forbids reopening or re-closing a closed incident;
--   3. a CHECK constraint, added NOT VALID: enforced for every new write, existing rows are NOT scanned
--      (validation is a separate step after an approved backfill: supabase/maintenance/);
--   4. transition_incident(): the single server-side way to move an incident through its lifecycle,
--      with validated transitions and server-set actor and timestamps.
--
-- NOT in this migration (deliberately): device_cleared_at / device_readings_clear (auto-resolution
-- behaviour - owner decision D6.1 pending, Step 6.3), the UI change (6.2), revoking direct UPDATE (6c),
-- the data backfill (needs approval; supabase/maintenance/incident_lifecycle_backfill.sql), any change to
-- raise_alert (5.1b is gated; this migration does not depend on it).
--
-- Semantics:
--   closed  <=>  incident_status IN ('resolved','false_alarm')  <=>  resolved_at IS NOT NULL
--   transitions through transition_incident():
--       active -> acknowledged
--       acknowledged -> responding | resolved | false_alarm
--       responding -> resolved | false_alarm
--       admin only: any open state -> resolved | false_alarm   (manual close fallback, SW-2.1.6)
--       same status again = no-op (idempotent); a closed incident can never be reopened or re-closed
--
-- Rollback: drop function transition_incident; drop trigger alert_events_lifecycle_guard on alert_events;
--   drop function alert_events_lifecycle_guard; alter table alert_events drop constraint
--   alert_events_lifecycle_sync; (the two new columns may stay or be dropped). No data is changed here.
-- =============================================================

alter table public.alert_events
  add column if not exists resolved_by uuid references public.profiles(id) on delete set null,
  add column if not exists resolution_source text
    check (resolution_source in ('device', 'responder', 'admin', 'legacy'));

-- ---- guard: keeps status and resolved_at in agreement for every writer ----
create or replace function public.alert_events_lifecycle_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old_closed boolean := false;
begin
  if tg_op = 'UPDATE' then
    -- "Properly closed" = closed by BOTH measures. A legacy row that is closed by only one measure is
    -- allowed to be repaired (normalised below) by any write that touches it.
    v_old_closed := old.resolved_at is not null and old.incident_status in ('resolved', 'false_alarm');

    if old.resolved_at is not null and new.resolved_at is null then
      raise exception 'a closed incident cannot be reopened' using errcode = '55000';
    end if;
    if v_old_closed and (new.resolved_at is distinct from old.resolved_at
                         or new.incident_status is distinct from old.incident_status) then
      raise exception 'a closed incident (%) cannot be modified or re-closed', old.incident_status using errcode = '55000';
    end if;
  end if;

  -- Normalise whichever side a legacy writer forgot. Actor and source are filled only if not provided.
  if new.incident_status in ('resolved', 'false_alarm') and new.resolved_at is null then
    new.resolved_at := now();
  elsif new.resolved_at is not null and new.incident_status in ('active', 'acknowledged', 'responding') then
    new.incident_status := 'resolved';
  end if;

  if new.resolved_at is not null then
    new.resolution_source := coalesce(new.resolution_source, 'legacy');
    -- Attribute the closure to the caller ONLY in the statement that actually takes the incident from open to
    -- closed. A later write that merely touches a row that was already closed - an admin editing notes, a late
    -- SMS confirmation, or a repair of a legacy row whose status had been closed earlier - must not take credit.
    if tg_op = 'INSERT'
       or (old.resolved_at is null and old.incident_status in ('active', 'acknowledged', 'responding')) then
      new.resolved_by := coalesce(new.resolved_by, auth.uid());
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists alert_events_lifecycle_guard on public.alert_events;
create trigger alert_events_lifecycle_guard
  before insert or update on public.alert_events
  for each row execute function public.alert_events_lifecycle_guard();

-- NOT VALID: enforced on every new/updated row (the guard normalises first, so legacy rows that are touched
-- become consistent); existing untouched rows are not checked until VALIDATE CONSTRAINT after the backfill.
alter table public.alert_events drop constraint if exists alert_events_lifecycle_sync;
alter table public.alert_events
  add constraint alert_events_lifecycle_sync
  check ((incident_status in ('resolved', 'false_alarm')) = (resolved_at is not null)) not valid;

-- ---- the single server-side way to move an incident through its lifecycle ----
create or replace function public.transition_incident(
  p_alert_id uuid,
  p_to       text,
  p_notes    text default null
) returns public.alert_events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
  v_row  public.alert_events;
begin
  -- Authorization is checked here (RLS is bypassed by SECURITY DEFINER): approved AND active admin/responder only.
  select role into v_role
    from profiles
   where id = v_uid and status = 'approved' and is_active = true;
  if v_role is null or v_role not in ('admin', 'bfp_responder') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_to is null or p_to not in ('acknowledged', 'responding', 'resolved', 'false_alarm') then
    raise exception 'invalid target status' using errcode = '22023';
  end if;
  if p_notes is not null and char_length(p_notes) > 2000 then
    raise exception 'notes too long (max 2000 characters)' using errcode = '22001';
  end if;

  select * into v_row from alert_events where id = p_alert_id for update;
  if not found then
    raise exception 'incident not found' using errcode = 'P0002';
  end if;

  if v_row.incident_status = p_to then
    return v_row;                       -- idempotent: repeating a transition changes nothing
  end if;

  if v_row.incident_status in ('resolved', 'false_alarm') then
    raise exception 'incident is already closed (%)', v_row.incident_status using errcode = '55000';
  end if;

  if not (
       (v_row.incident_status = 'active'       and p_to = 'acknowledged')
    or (v_row.incident_status = 'acknowledged' and p_to in ('responding', 'resolved', 'false_alarm'))
    or (v_row.incident_status = 'responding'   and p_to in ('resolved', 'false_alarm'))
    or (v_role = 'admin'                       and p_to in ('resolved', 'false_alarm'))
  ) then
    raise exception 'transition % -> % is not allowed', v_row.incident_status, p_to using errcode = '55000';
  end if;

  update alert_events
     set incident_status   = p_to,
         acknowledged_by   = case when p_to = 'acknowledged' then v_uid else acknowledged_by end,
         acknowledged_at   = case when p_to = 'acknowledged' then now() else acknowledged_at end,
         outcome_notes     = coalesce(p_notes, outcome_notes),
         resolved_at       = case when p_to in ('resolved', 'false_alarm') then now() else resolved_at end,
         resolved_by       = case when p_to in ('resolved', 'false_alarm') then v_uid else resolved_by end,
         resolution_source = case when p_to in ('resolved', 'false_alarm')
                                  then (case v_role when 'admin' then 'admin' else 'responder' end)
                                  else resolution_source end
   where id = p_alert_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.transition_incident(uuid, text, text) from public, anon;
grant execute on function public.transition_incident(uuid, text, text) to authenticated;

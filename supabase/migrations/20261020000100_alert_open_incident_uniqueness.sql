-- =============================================================
-- Step 5.1b: at most ONE open incident per device, plus the atomic raise_alert() function.
--
-- *** ACTIVATION GATE - do not apply to a shared or production database until the checklist in
-- *** docs/ALERT_DELIVERY_AND_INCIDENT_INVARIANTS.md is complete. ***
--
-- Definition used throughout: an incident is OPEN when alert_events.resolved_at IS NULL.
-- The unique index is only as good as that definition: if any writer can close an incident WITHOUT
-- setting resolved_at, the "closed" row stays open and a NEW fire is merged into it. The writers
-- were audited (see the doc). One real defect was found: the responder dashboard's resolve /
-- false-alarm handler sets incident_status only and leaves resolved_at NULL. Step 6 fixes the writer
-- and adds a database guard. Until then raise_alert() protects itself (see the STOPGAP below).
--
-- Nothing calls raise_alert() yet (trigger-alert is unchanged until Step 5.2). The only effect of
-- this migration on today's code is the unique index: if two trigger-alert calls ever race and both try
-- to INSERT an open incident for the same device, the second now fails (SQLSTATE 23505) instead of
-- silently creating a duplicate.
--
-- Safety: the migration ABORTS (changing nothing) if duplicate open incidents already exist. It never
-- deletes or auto-resolves data; resolve duplicates deliberately, then re-run. Creating the index takes a
-- brief write lock on alert_events (a small table).
--
-- Rollback: drop function raise_alert(...); drop index alert_events_one_open_per_device;
-- =============================================================

do $$
declare
  v_dupes text;
begin
  select string_agg(device_id::text || ' (' || n || ' open)', ', ')
    into v_dupes
    from (select device_id, count(*) as n
            from public.alert_events
           where resolved_at is null
           group by device_id
          having count(*) > 1) d;

  if v_dupes is not null then
    raise exception 'Cannot create one-open-incident-per-device index: duplicate open incidents exist for: %. Review and close the extras deliberately, then re-run.', v_dupes
      using errcode = '23505';
  end if;
end;
$$;

create unique index if not exists alert_events_one_open_per_device
  on public.alert_events (device_id)
  where resolved_at is null;

-- Atomically creates the open incident for a device, or updates the existing one.
--   * Idempotent: a retried/replayed call returns the SAME incident with created = false.
--   * Tier never downgrades (a late tier-1 retry on a tier-2 incident keeps tier 2).
--   * A retry that omits coordinates / address keeps the earlier values; the latest readings win.
--   * Does NOT touch incident_status, acknowledgement or SMS flags: an acknowledged/responding
--     incident stays so, and sms_sent_* confirmations are preserved.
--   * Returns the stored tier so notifications are keyed by the tier actually in force.
-- created uses xmax = 0 (true only for a freshly inserted row in INSERT .. ON CONFLICT DO UPDATE).
create or replace function public.raise_alert(
  p_device_id uuid,
  p_tier      integer,
  p_co        double precision,
  p_temp      double precision,
  p_lat       double precision,
  p_lng       double precision,
  p_gps_valid boolean,
  p_address   text
) returns table (alert_id uuid, created boolean, tier integer, triggered_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_tier is null or p_tier not in (1, 2) then
    raise exception 'tier must be 1 or 2' using errcode = '22023';
  end if;

  -- STOPGAP (made redundant by the Step 6 lifecycle guard): an incident that a responder marked
  -- resolved/false_alarm through the legacy status-only write still has resolved_at NULL, i.e. looks
  -- open. Close it properly first so a new fire becomes a NEW incident instead of vanishing into a
  -- closed one. resolved_at = now() is "when the system noticed", not when the responder acted
  -- (the legacy write recorded no time).
  update alert_events
     set resolved_at = now()
   where device_id = p_device_id
     and resolved_at is null
     and incident_status in ('resolved', 'false_alarm');

  return query
  insert into alert_events as a
         (device_id, alert_tier, co_ppm, temp_celsius, latitude, longitude, gps_valid, address_resolved)
  values (p_device_id, p_tier, p_co, p_temp, p_lat, p_lng, coalesce(p_gps_valid, false), p_address)
  on conflict (device_id) where resolved_at is null do update set
         alert_tier       = greatest(a.alert_tier, excluded.alert_tier),
         co_ppm           = excluded.co_ppm,
         temp_celsius     = excluded.temp_celsius,
         latitude         = coalesce(excluded.latitude,  a.latitude),
         longitude        = coalesce(excluded.longitude, a.longitude),
         gps_valid        = excluded.gps_valid,
         address_resolved = coalesce(excluded.address_resolved, a.address_resolved)
  returning a.id, (xmax = 0), a.alert_tier::integer, a.triggered_at;
end;
$$;

revoke all on function public.raise_alert(uuid, integer, double precision, double precision, double precision, double precision, boolean, text) from public, anon, authenticated;
grant execute on function public.raise_alert(uuid, integer, double precision, double precision, double precision, double precision, boolean, text) to service_role;

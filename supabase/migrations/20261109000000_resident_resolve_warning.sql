-- =============================================================
-- Let a resident close their own Tier 1 warning.
--
-- Problem: a Tier 1 warning has no SMS and never reaches BFP (trigger-alert notifies admins only). Responders never
-- see it (ResponderDashboard filters alert_tier = 2), so the "Waiting for a responder" state shown to the
-- resident could never change; the only ways a warning closed were the device's auto-resolve (two safe
-- readings in a row) or an admin. A resident who has already checked the room had no way to say "handled".
--
-- Change:
--   1. resolution_source gains 'resident' (who closed it, for history/audit);
--   2. resident_resolve_warning(): an approved, active resident may close the OPEN TIER 1 alert of the device
--      linked to their own profile. Tier 2 (fire) stays with responders/admin via transition_incident().
--
-- Safety: the row is locked (FOR UPDATE) and re-checked, so a warning that raise_alert() escalated to Tier 2
-- in the meantime is refused, not closed. Closing a warning does not mute later alerts: if the readings stay
-- high and escalate, raise_alert() opens a NEW incident because none is open any more.
--
-- Rollback: drop function resident_resolve_warning(uuid); restore the resolution_source check without
--   'resident' (only after no row uses it).
-- =============================================================

alter table public.alert_events drop constraint if exists alert_events_resolution_source_check;
alter table public.alert_events
  add constraint alert_events_resolution_source_check
  check (resolution_source in ('device', 'responder', 'admin', 'legacy', 'resident'));

create or replace function public.resident_resolve_warning(p_alert_id uuid)
returns public.alert_events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_device uuid;
  v_row    public.alert_events;
begin
  select device_id into v_device
    from profiles
   where id = v_uid and role = 'resident' and status = 'approved' and is_active = true;
  if v_device is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_row from alert_events where id = p_alert_id for update;
  -- Another device's alert is reported as "not found" so its existence is not disclosed.
  if not found or v_row.device_id is distinct from v_device then
    raise exception 'incident not found' using errcode = 'P0002';
  end if;

  if v_row.resolved_at is not null then
    if v_row.resolution_source = 'resident' and v_row.resolved_by = v_uid then
      return v_row;                     -- idempotent: a double tap changes nothing
    end if;
    raise exception 'incident is already closed (%)', v_row.incident_status using errcode = '55000';
  end if;

  if v_row.alert_tier <> 1 then
    raise exception 'only a Tier 1 warning can be resolved by a resident' using errcode = '55000';
  end if;

  update alert_events
     set incident_status   = 'resolved',
         resolved_at       = now(),
         resolved_by       = v_uid,
         resolution_source = 'resident'
   where id = p_alert_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.resident_resolve_warning(uuid) from public, anon;
grant execute on function public.resident_resolve_warning(uuid) to authenticated;

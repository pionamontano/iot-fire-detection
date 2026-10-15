-- =============================================================
-- get_incident_resident_contact(alert): the resident to call about an OPEN FIRE.
--
-- BFP responders cannot read other users' profiles (20261019000000), so the responder dashboard had no way
-- to call the household when a device reports a fire. This function returns the name and mobile number of
-- the resident(s) linked to the alert's device, and nothing else, only while the incident needs it:
--   * caller: approved AND active bfp_responder or admin (42501 otherwise);
--   * alert: must exist (P0002) and be an open fire: Tier 2, not resolved / false alarm (55000 otherwise).
--     Admins, who can already read every profile, may also look up an open Tier 1 warning.
--   * residents: approved and active accounts linked to that device only.
-- Once the incident is closed the number is no longer available to responders.
-- =============================================================

create or replace function public.get_incident_resident_contact(p_alert_id uuid)
returns table (full_name text, contact_number text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role  text;
  v_alert public.alert_events;
begin
  -- RLS is bypassed by SECURITY DEFINER, so authorization is checked here.
  select p.role into v_role
    from profiles p
   where p.id = auth.uid() and p.status = 'approved' and p.is_active = true;
  if v_role is null or v_role not in ('admin', 'bfp_responder') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_alert from alert_events where id = p_alert_id;
  if not found then
    raise exception 'incident not found' using errcode = 'P0002';
  end if;

  if v_alert.resolved_at is not null
     or v_alert.incident_status in ('resolved', 'false_alarm')
     or (v_role = 'bfp_responder' and v_alert.alert_tier < 2) then
    raise exception 'contact is only available for an open fire alert' using errcode = '55000';
  end if;

  return query
    select r.full_name, r.contact_number
      from profiles r
     where r.device_id = v_alert.device_id
       and r.role = 'resident'
       and r.status = 'approved'
       and r.is_active = true
     order by r.created_at;
end;
$$;

revoke all on function public.get_incident_resident_contact(uuid) from public, anon;
grant execute on function public.get_incident_resident_contact(uuid) to authenticated;

-- =============================================================
-- FIX: Allow residents to update their device's registered address
-- when approving a location discrepancy. Residents do not have
-- UPDATE permissions on the devices table.
-- =============================================================

create or replace function public.resolve_address_discrepancy(
  p_discrepancy_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_discrepancy record;
begin
  if p_status not in ('approved', 'rejected') then
    raise exception 'Invalid status';
  end if;

  select * into v_discrepancy
  from address_discrepancies
  where id = p_discrepancy_id and resident_id = auth.uid();

  if not found then
    raise exception 'Discrepancy not found or access denied';
  end if;

  update address_discrepancies
  set status = p_status,
      resolved_at = now()
  where id = p_discrepancy_id;

  if p_status = 'approved' then
    update devices
    set location_desc = v_discrepancy.gps_derived_address,
        latitude = v_discrepancy.latitude,
        longitude = v_discrepancy.longitude
    where id = v_discrepancy.device_id;
  end if;
end;
$$;

grant execute on function public.resolve_address_discrepancy(uuid, text) to authenticated;

ALTER TABLE devices ADD COLUMN IF NOT EXISTS local_ip TEXT;

create or replace view public.devices_safe
with (security_invoker = off) as
select
  id,
  device_code,
  label,
  location_desc,
  case when public.get_auth_role() = 'admin' then api_key else null end as api_key,
  co_threshold,
  temp_threshold,
  bfp_contact,
  is_active,
  created_at,
  last_seen_at,
  latitude,
  longitude,
  local_ip
from public.devices
where
  public.get_auth_role() in ('admin', 'bfp_responder')
  or (
    public.get_auth_role() = 'resident'
    and id = (select device_id from public.profiles where profiles.id = auth.uid())
  );

grant select on public.devices_safe to authenticated;

-- =============================================================
-- BUGFIX: Infinite recursion on devices_safe for residents.
--
-- The previous definition of devices_safe relied on get_auth_role(),
-- which triggered the Row Level Security (RLS) policy on the profiles
-- table. The RLS policy for profiles itself called get_auth_role(),
-- causing an infinite recursion loop when a resident queried the view,
-- ultimately resulting in 0 rows and throwing a 406 Not Acceptable.
--
-- Fix: Use a direct LEFT JOIN against public.profiles using auth.uid()
-- to eliminate the need for get_auth_role() in the WHERE clause, breaking
-- the recursion loop and correctly returning the device for the resident.
-- =============================================================

create or replace view public.devices_safe
with (security_invoker = off) as
select
  d.id,
  d.device_code,
  d.label,
  d.location_desc,
  case when p.role = 'admin' then d.api_key else null end as api_key,
  d.co_threshold,
  d.temp_threshold,
  d.bfp_contact,
  d.is_active,
  d.created_at,
  d.last_seen_at,
  d.latitude,
  d.longitude,
  d.local_ip
from public.devices d
left join public.profiles p on p.id = auth.uid()
where
  p.role in ('admin', 'bfp_responder')
  or (
    p.role = 'resident'
    and d.id = p.device_id
  );

grant select on public.devices_safe to authenticated;

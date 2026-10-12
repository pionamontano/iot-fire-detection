-- READ-ONLY report (NOT-005 follow-up). Lists push subscriptions that belong to accounts that are
-- not approved + active, so the owner can review them BEFORE any cleanup. This file deletes nothing.
-- Output is minimised on purpose: user id, role, status, and only the push service HOST of each endpoint
-- (never the full endpoint URL or the p256dh/auth keys).

select
  p.id                                         as user_id,
  p.role,
  p.status,
  p.is_active,
  count(s.id)                                  as subscriptions,
  array_agg(distinct split_part(s.endpoint, '/', 3)) as push_service_hosts,
  min(s.created_at)                            as oldest_subscription,
  max(s.updated_at)                            as latest_update
from public.push_subscriptions s
join public.profiles p on p.id = s.user_id
where p.status <> 'approved' or p.is_active is not true
group by p.id, p.role, p.status, p.is_active
order by p.status, p.role;

-- Proposed cleanup - DO NOT RUN without explicit owner approval, and only after reviewing the report above.
-- (Reversible in practice: a user simply re-subscribes after being approved.)
--
--   delete from public.push_subscriptions s
--   using public.profiles p
--   where p.id = s.user_id and (p.status <> 'approved' or p.is_active is not true);

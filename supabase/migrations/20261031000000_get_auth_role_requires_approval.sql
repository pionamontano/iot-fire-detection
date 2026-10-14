-- =============================================================
-- get_auth_role() returns a role only for APPROVED, active accounts.
--
-- Before: it returned profiles.role for any account with a profile
-- row (20260717000000_init.sql), ignoring profiles.status. Several
-- later migrations were written as if it already meant "approved"
-- (e.g. 20260917030000_require_approval_for_profile_settings_reads.sql:
-- "get_auth_role() returns NULL for any non-approved user"), so their
-- "get_auth_role() = '<role>'" / "is not null" checks let a signed-in
-- PENDING or REJECTED account through: a pending responder could read
-- devices, sensor_readings and alert_events, a pending resident their
-- requested device, and a pending/rejected "admin" profile every
-- admin-only table.
--
-- After: NULL unless status = 'approved' (and, from
-- 20261030000000_deactivated_users_lose_access.sql, is_active), so
-- every role-gated policy and RPC denies non-approved accounts.
--
-- Unaffected: own-row profile reads (id = auth.uid()), which the
-- pending/rejected screens rely on; sign-in and registration, which
-- go through edge functions with the service role.
--
-- Rollback: re-run get_auth_role() from
-- 20261030000000_deactivated_users_lose_access.sql.
-- =============================================================

create or replace function public.get_auth_role()
returns text
language sql
stable
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and status = 'approved'
    and is_active;
$$;

-- =============================================================
-- KI-25 (issue #110): get_dashboard_stats() exposes system-wide counts to any authenticated caller.
--
-- get_dashboard_stats() is SECURITY DEFINER with no SET search_path and no internal caller-role check.
-- Postgres grants EXECUTE to PUBLIC by default on new functions, and no prior migration revoked it or
-- added a role check - unlike every other sensitive function added from 20261017000000 onward
-- (create_telegram_link_token, resolve_address_discrepancy, is_approved_admin, claim_/complete_notification,
-- raise_alert, transition_incident), which all get an explicit REVOKE ALL ... FROM PUBLIC/anon/authenticated
-- in the same migration that defines them. This is a pre-convention oversight, not an intentionally public RPC:
-- any authenticated (or anon, before the REVOKE below) caller could run `rpc/get_dashboard_stats` directly and
-- get system-wide device/alert/user counts, bypassing every RLS policy that otherwise hides this from
-- non-admin roles.
--
-- Fix (defense in depth, matching the is_approved_admin() pattern from 20261019000000):
--   1. Pin search_path (the function already schema-qualifies nothing, so this alone does not change its
--      behaviour today, but closes the same class of search_path hijack every other SECURITY DEFINER
--      function in this repo is already guarded against).
--   2. Raise an exception unless the caller is an approved admin (is_approved_admin()), so even a future
--      re-grant to a broader role cannot silently restore access without also passing this check.
--   3. REVOKE EXECUTE from PUBLIC/anon/authenticated and GRANT only to authenticated, since admins connect
--      as `authenticated` like everyone else - the internal check above is what actually restricts them.
--
-- Rollback: revoke/grant as before this migration (GRANT EXECUTE ON FUNCTION public.get_dashboard_stats() TO
-- PUBLIC), and restore the function body to the 20260717000000 definition (no search_path, no role check).
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  total_devices INT;
  active_alerts INT;
  resolved_alerts INT;
  total_users INT;
BEGIN
  IF NOT public.is_approved_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO total_devices FROM devices;
  SELECT count(*) INTO active_alerts FROM alert_events WHERE resolved_at IS NULL;
  SELECT count(*) INTO resolved_alerts FROM alert_events WHERE resolved_at IS NOT NULL;
  SELECT count(*) INTO total_users FROM profiles;

  RETURN json_build_object(
    'total_devices', total_devices,
    'active_alerts', active_alerts,
    'resolved_alerts', resolved_alerts,
    'total_users', total_users
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats() TO authenticated;

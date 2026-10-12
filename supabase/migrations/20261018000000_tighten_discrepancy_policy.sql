-- Residents could UPDATE any column of their own address_discrepancies rows
-- (e.g. status, resident_id, coordinates). Resolution now goes exclusively
-- through the resolve_address_discrepancy() RPC, so drop the direct UPDATE policy.
DROP POLICY IF EXISTS "Resident can update own discrepancies" ON address_discrepancies;

-- Harden the SECURITY DEFINER function: pin search_path (pg_temp last) and
-- restrict execution to authenticated users only.
ALTER FUNCTION public.resolve_address_discrepancy(uuid, text)
  SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.resolve_address_discrepancy(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_address_discrepancy(uuid, text) TO authenticated;

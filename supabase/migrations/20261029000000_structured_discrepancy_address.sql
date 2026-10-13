-- =============================================================
-- The resident's address-discrepancy approval form must be pre-filled
-- with the Philippine address hierarchy (House/Unit No., Street,
-- Subdivision, Barangay, City/Municipality, Province) and let the
-- resident edit any field before approving, not just show one flat
-- "gps_derived_address" string with an Approve/Reject choice.
--
-- address_discrepancies now also carries the structured parts the
-- ingest-reading function extracted from Nominatim, purely to pre-fill
-- that form - resolve_address_discrepancy() recomposes the final
-- devices.location_desc from whatever the resident actually submits,
-- not from these raw gps_* columns.
-- =============================================================

ALTER TABLE address_discrepancies
  ADD COLUMN IF NOT EXISTS gps_house_no TEXT,
  ADD COLUMN IF NOT EXISTS gps_street TEXT,
  ADD COLUMN IF NOT EXISTS gps_subdivision TEXT,
  ADD COLUMN IF NOT EXISTS gps_barangay TEXT,
  ADD COLUMN IF NOT EXISTS gps_city_municipality TEXT,
  ADD COLUMN IF NOT EXISTS gps_province TEXT;

-- Replaced by the version below with the 6 structured address params.
DROP FUNCTION IF EXISTS public.resolve_address_discrepancy(uuid, text);

create or replace function public.resolve_address_discrepancy(
  p_discrepancy_id uuid,
  p_status text,
  p_house_no text default null,
  p_street text default null,
  p_subdivision text default null,
  p_barangay text default null,
  p_city_municipality text default null,
  p_province text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_discrepancy record;
  v_house_street text;
  v_parts text[];
  v_desc text;
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
    -- Smallest unit to largest: House/Unit No. + Street share one segment,
    -- then Subdivision, Barangay, City/Municipality, Province each their own.
    v_house_street := nullif(trim(coalesce(p_house_no, '') || ' ' || coalesce(p_street, '')), '');
    v_parts := array_remove(array[
      v_house_street,
      nullif(trim(p_subdivision), ''),
      nullif(trim(p_barangay), ''),
      nullif(trim(p_city_municipality), ''),
      nullif(trim(p_province), '')
    ], null);

    v_desc := array_to_string(v_parts, ', ');

    if v_desc is null or v_desc = '' then
      raise exception 'Address cannot be empty';
    end if;
    if length(v_desc) > 200 then
      raise exception 'Address must be 200 characters or fewer';
    end if;

    update devices
    set location_desc = v_desc,
        latitude = v_discrepancy.latitude,
        longitude = v_discrepancy.longitude
    where id = v_discrepancy.device_id;
  end if;
end;
$$;

REVOKE ALL ON FUNCTION public.resolve_address_discrepancy(uuid, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_address_discrepancy(uuid, text, text, text, text, text, text, text) TO authenticated;

// Reverse geocoding via OpenStreetMap Nominatim, shared by trigger-alert (alert address) and
// ingest-reading (GPS drift / address discrepancies).

// Philippine address hierarchy, smallest unit to largest. Subdivision and barangay
// both commonly land under Nominatim's suburb/village/neighbourhood/quarter tags with
// no reliable way to tell them apart, so neighbourhood/residential is read as the
// subdivision and suburb/village/quarter as the barangay - an admin/resident can
// correct either in the pre-filled form before saving.
export interface PhAddressParts {
  houseNo: string | null;
  street: string | null;
  subdivision: string | null;
  barangay: string | null;
  cityMunicipality: string | null;
  province: string | null;
}

export interface GeocodeResult {
  address: string | null;
  parts: PhAddressParts;
}

interface GeocodeCacheEntry {
  address: string;
  parts: PhAddressParts;
  timestamp: number;
}

// Per-isolate cache keyed on a 4-decimal (~11 m) grid.
const GEOCODE_CACHE = new Map<string, GeocodeCacheEntry>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24-hour cache
const GEOCODE_TIMEOUT_MS = 3000;

export const EMPTY_PARTS: PhAddressParts = {
  houseNo: null, street: null, subdivision: null, barangay: null, cityMunicipality: null, province: null,
};

function extractAddressParts(address: Record<string, string> | undefined): PhAddressParts {
  return {
    houseNo: address?.house_number || null,
    street: address?.road || null,
    subdivision: address?.neighbourhood || address?.residential || null,
    barangay: address?.suburb || address?.village || address?.quarter || null,
    cityMunicipality: address?.city || address?.municipality || address?.town || address?.county || null,
    province: address?.state || address?.region || null,
  };
}

// Builds a street → barangay/suburb → municipality/city string from
// Nominatim's structured `address` fields (spec HW-1.2.3 / SW-2.3.2),
// instead of relying on the single, inconsistently-granular display_name
// (which might be street-level, might be just a country name, with no
// way to tell which tier you got). Nominatim has no dedicated "barangay"
// tag — for Philippine addresses it typically lands under suburb/village/
// neighbourhood, so all three are checked.
function buildTieredAddress(address: Record<string, string> | undefined): string | null {
  if (!address) return null;

  const street = [address.house_number, address.road].filter(Boolean).join(' ') || null;
  const barangay = address.suburb || address.village || address.neighbourhood || address.quarter || null;
  const municipality = address.city || address.municipality || address.town || address.county || null;

  const parts = [street, barangay, municipality].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

// Never throws: a timeout, HTTP error or unusable response yields { address: null, parts: EMPTY_PARTS }
// so a slow or dead upstream can never block the caller.
export async function reverseGeocode(lat: number, lon: number): Promise<GeocodeResult> {
  if (!lat || !lon) return { address: null, parts: EMPTY_PARTS };

  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = GEOCODE_CACHE.get(key);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return { address: cached.address, parts: cached.parts };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);

    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
      {
        headers: {
          // Compliant User-Agent per Nominatim Usage Policy
          'User-Agent': 'AgapSense-Capstone/1.0 (contact@agapsense.local)'
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);

    if (!res.ok) return { address: null, parts: EMPTY_PARTS };
    const data = await res.json();
    // Tiered street/barangay/municipality string when the structured
    // fields support it; fall back to Nominatim's own display_name
    // (still better than nothing) before giving up entirely.
    const address = buildTieredAddress(data?.address) || data?.display_name || null;
    const parts = extractAddressParts(data?.address);

    if (address) {
      GEOCODE_CACHE.set(key, { address, parts, timestamp: Date.now() });
    }

    return { address, parts };
  } catch (e) {
    console.error('Geocoding error/timeout:', e);
    return { address: null, parts: EMPTY_PARTS };
  }
}

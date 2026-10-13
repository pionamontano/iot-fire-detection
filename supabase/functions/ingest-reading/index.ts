// @ts-nocheck
// deno-lint-ignore-file

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-device-key',
};

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

interface GeocodeCacheEntry {
  address: string;
  parts: PhAddressParts;
  timestamp: number;
}

const GEOCODE_CACHE = new Map<string, GeocodeCacheEntry>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24-hour cache

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

function buildTieredAddress(address: Record<string, string> | undefined): string | null {
  if (!address) return null;

  const street = [address.house_number, address.road].filter(Boolean).join(' ') || null;
  const barangay = address.suburb || address.village || address.neighbourhood || address.quarter || null;
  const municipality = address.city || address.municipality || address.town || address.county || null;

  const parts = [street, barangay, municipality].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

const EMPTY_PARTS: PhAddressParts = {
  houseNo: null, street: null, subdivision: null, barangay: null, cityMunicipality: null, province: null,
};

async function reverseGeocode(lat: number, lon: number): Promise<{ address: string | null; parts: PhAddressParts }> {
  if (!lat || !lon) return { address: null, parts: EMPTY_PARTS };

  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = GEOCODE_CACHE.get(key);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return { address: cached.address, parts: cached.parts };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
      {
        headers: {
          // Explicitly document the mandatory User-Agent header per Nominatim Usage Policy
          'User-Agent': 'AgapSense-Capstone/1.0 (contact@agapsense.local)'
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);

    if (!res.ok) return { address: null, parts: EMPTY_PARTS };
    const data = await res.json();
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

// Haversine distance in meters
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // metres
  const φ1 = lat1 * Math.PI/180; // φ, λ in radians
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

const IP_RE = /^[0-9a-fA-F:.]{3,45}$/;

// Client IP as seen by the platform proxy. x-forwarded-for may be a client-supplied,
// comma-separated list; the last hop is the one our own proxy appended.
function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  const candidate = (xff ? xff.split(',').pop() : req.headers.get('x-real-ip'))?.trim() ?? '';
  return IP_RE.test(candidate) ? candidate : null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const deviceKey = req.headers.get('x-device-key');
    if (!deviceKey) {
      return new Response(JSON.stringify({ error: 'Missing x-device-key' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Authenticate device
    const { data: device, error: deviceError } = await supabaseAdmin
      .from('devices')
      .select('id, location_desc, latitude, longitude, is_active, co_threshold, temp_threshold')
      .eq('api_key', deviceKey)
      .maybeSingle();

    if (deviceError || !device || !device.is_active) {
      return new Response(JSON.stringify({ error: 'Unauthorized or inactive device' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Parse payload safely
    const body = await req.json().catch(() => null);
    if (!body) {
      return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const {
      co_ppm,
      temp_celsius,
      latitude,
      longitude,
      gps_valid = false,
      on_battery = false,
      sensor_ready = true,
      firmware_version = null,
    } = body;

    // 3. Validate required numeric fields before any DB writes
    const isValidNumber = (val: unknown): boolean =>
      typeof val === 'number' && Number.isFinite(val);

    if (!isValidNumber(co_ppm) || !isValidNumber(temp_celsius)) {
      return new Response(
        JSON.stringify({ error: 'Invalid payload: co_ppm and temp_celsius must be finite numbers' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const nowIso = new Date().toISOString();

    // (0, 0) is the firmware's "no fix ever acquired" sentinel (gps.cpp lastFix
    // init), not a real cached location — treat it the same as missing coords.
    const hasCachedCoords =
      isValidNumber(latitude) && isValidNumber(longitude) && !(latitude === 0 && longitude === 0);

    // Owner decision D6.1: auto-resolve requires 2 consecutive below-threshold readings (matching the
    // firmware's own CLEAR debounce) and never closes an incident a responder already has in hand.
    // Fetch the prior reading before inserting the current one so the comparison is "last two readings".
    const coThreshold   = device.co_threshold   ?? Infinity;
    const tempThreshold = device.temp_threshold  ?? Infinity;
    const isBelowThresholds = (co: number, temp: number) => co < coThreshold && temp < tempThreshold;

    const { data: previousReading } = await supabaseAdmin
      .from('sensor_readings')
      .select('co_ppm, temp_celsius, sensor_ready')
      .eq('device_id', device.id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const canAutoResolve =
      sensor_ready && isBelowThresholds(co_ppm, temp_celsius) &&
      !!previousReading?.sensor_ready &&
      isBelowThresholds(previousReading.co_ppm, previousReading.temp_celsius);

    // 4. Batch async database writes
    const writePromises: Promise<any>[] = [
      // Insert sensor reading — coordinates are stored whenever a real fix (live or
      // cached) is present, even when gps_valid is false; gps_valid marks them as
      // an estimate rather than a live reading.
      supabaseAdmin.from('sensor_readings').insert({
        device_id: device.id,
        co_ppm,
        temp_celsius,
        latitude:  hasCachedCoords ? latitude  : null,
        longitude: hasCachedCoords ? longitude : null,
        gps_valid,
        on_battery,
        sensor_ready,
      }),
      // Touch last_seen_at. firmware_version_reported is only overwritten
      // when the device actually sent one — older firmware builds predating
      // this field must not blank out a previously reported version.
      supabaseAdmin.from('devices').update({
        last_seen_at: nowIso,
        local_ip: clientIp(req),
        ...(typeof firmware_version === 'string' && firmware_version
          ? { firmware_version_reported: firmware_version }
          : {}),
      }).eq('id', device.id),
    ];

    // 5. Auto-resolution check: only an 'active' (unacknowledged) incident may be auto-closed. Once a
    // responder has acknowledged or is responding, only a person can close it via transition_incident().
    if (canAutoResolve) {
      writePromises.push(
        supabaseAdmin
          .from('alert_events')
          // Set both sides of the lifecycle explicitly; the lifecycle guard trigger also normalises them.
          .update({ resolved_at: nowIso, incident_status: 'resolved', resolution_source: 'device' })
          .eq('device_id', device.id)
          .eq('incident_status', 'active')
          .is('resolved_at', null)
      );
    }

    // Address Discrepancy Detection
    if (hasCachedCoords && device.latitude && device.longitude && gps_valid) {
      const distance = getDistance(latitude, longitude, device.latitude, device.longitude);
      // If distance > 100 meters, check for discrepancy
      if (distance > 100) {
        // Find resident
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('id, address')
          .eq('device_id', device.id)
          .eq('role', 'resident')
          .maybeSingle();

        if (profile) {
          // Prevent repeated notification if user already dismissed/resolved for a location near this one
          // We look for any discrepancy for this device that is pending, OR one that was dismissed/approved
          // within 50 meters of the current coordinates.
          const { data: recentDiscrepancies } = await supabaseAdmin
            .from('address_discrepancies')
            .select('id, status, latitude, longitude')
            .eq('device_id', device.id);

          let shouldNotify = true;
          if (recentDiscrepancies && recentDiscrepancies.length > 0) {
            for (const d of recentDiscrepancies) {
              if (d.status === 'pending') {
                shouldNotify = false;
                break;
              }
              // If previously rejected/approved, but we are still roughly in the same spot, don't spam.
              if (getDistance(latitude, longitude, d.latitude, d.longitude) < 50) {
                shouldNotify = false;
                break;
              }
            }
          }

          if (shouldNotify) {
            let geocodedAddress: string | null = null;
            let geocodedParts: PhAddressParts = EMPTY_PARTS;

            // Device-State Caching: Check if device hasn't drifted beyond 100 meters from its registered location
            if (device.latitude && device.longitude && getDistance(latitude, longitude, device.latitude, device.longitude) <= 100) {
              geocodedAddress = device.location_desc;
            } else {
              const geocoded = await reverseGeocode(latitude, longitude);
              geocodedAddress = geocoded.address;
              geocodedParts = geocoded.parts;
            }

             // Verify that reverse geocoding returned a specific enough address (not just a single word / country)
             if (geocodedAddress && geocodedAddress.includes(',')) {
               writePromises.push(
                 supabaseAdmin.from('address_discrepancies').insert({
                   device_id: device.id,
                   resident_id: profile.id,
                   gps_derived_address: geocodedAddress,
                   registered_address: device.location_desc || 'Unknown',
                   latitude,
                   longitude,
                   // Structured parts so the resident's approval form can be pre-filled field
                   // by field (House/Unit No. -> Street -> Subdivision -> Barangay ->
                   // City/Municipality -> Province) instead of just showing the flat string.
                   gps_house_no: geocodedParts.houseNo,
                   gps_street: geocodedParts.street,
                   gps_subdivision: geocodedParts.subdivision,
                   gps_barangay: geocodedParts.barangay,
                   gps_city_municipality: geocodedParts.cityMunicipality,
                   gps_province: geocodedParts.province,
                 })
               );
             }
          }
        }
      }
    }

    const results = await Promise.all(writePromises);
    const insertResult = results[0];

    if (insertResult.error) throw insertResult.error;

    // Secondary writes must not fail the reading, but they must not vanish silently either.
    results.slice(1).forEach((r, i) => {
      if (r?.error) console.error(`ingest-reading secondary write #${i + 1} failed:`, r.error);
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err) {
    const error = err as Error;
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
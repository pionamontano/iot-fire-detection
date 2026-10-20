// @ts-nocheck
// deno-lint-ignore-file

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-device-key',
};

interface GeocodeCacheEntry {
  address: string;
  timestamp: number;
}

const GEOCODE_CACHE = new Map<string, GeocodeCacheEntry>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24-hour cache

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

async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  if (!lat || !lon) return null;

  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = GEOCODE_CACHE.get(key);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return cached.address;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
      {
        headers: {
          // [FIX #7] Compliant User-Agent per Nominatim Usage Policy
          'User-Agent': 'AgapSense-Capstone/1.0 (contact@agapsense.local)'
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const data = await res.json();
    // Tiered street/barangay/municipality string when the structured
    // fields support it; fall back to Nominatim's own display_name
    // (still better than nothing) before giving up entirely.
    const address = buildTieredAddress(data?.address) || data?.display_name || null;

    if (address) {
      GEOCODE_CACHE.set(key, { address, timestamp: Date.now() });
    }

    return address;
  } catch (e) {
    console.error('Geocoding error/timeout:', e);
    return null;
  }
}

// =============================================================
// Delivery (Step 5.2).
//
// Order of operations - PERSIST FIRST, THEN NOTIFY:
//   1. raise_alert() atomically creates / updates the single open incident for the device (idempotent: a retried
//      or replayed request returns the same incident). The incident is recorded BEFORE any provider is called, so a
//      slow or failing Telegram/push service can never delay or lose the alert record.
//   2. Each notification is claimed in the alert_notifications ledger before it is sent
//      (claim_notification), so a replay/retry does not send the same (incident, tier, channel, recipient) again.
//   3. Every external call has a timeout and the whole dispatch has a budget, so the response (which carries the
//      SMS contacts the firmware needs) is never held hostage by a provider.
//
// DELIVERY IS AT-LEAST-ONCE, NOT EXACTLY-ONCE. If a provider accepts a message but this function dies or times out
// before recording "sent", the claim goes stale and a later request can send again => a recipient may rarely get a
// duplicate. That is deliberate (a duplicate fire alert beats a lost one). See
// docs/ALERT_DELIVERY_AND_INCIDENT_INVARIANTS.md.
//
// Emergency-first failure policy ("fail open"): if the ledger is unavailable the notification is sent anyway; if
// the incident cannot be recorded at all the station Telegram/push are still attempted (best effort, de-duplicated
// in memory) before the function reports a 500 so the device retries.
// Rolling out before the 5.1 migrations exist degrades to the previous select-then-insert persistence (the
// response says persistence:"legacy"); set ALERT_STRICT_DB=1 to refuse that and fail with 500 instead.
// =============================================================

const DISPATCH_BUDGET_MS = Number(Deno.env.get('ALERT_DISPATCH_BUDGET_MS')) || 4000;
const PROVIDER_TIMEOUT_MS = Number(Deno.env.get('ALERT_PROVIDER_TIMEOUT_MS')) || 3500;
// Push goes through a second edge function (send-push-notification), which on a cold start must boot and load
// web-push before it can call the browser push services. That regularly takes longer than PROVIDER_TIMEOUT_MS, and
// Tier 1 warnings are rare enough that the function is almost always cold, so push gets its own, longer timeout.
const PUSH_TIMEOUT_MS = Number(Deno.env.get('ALERT_PUSH_TIMEOUT_MS')) || 15000;
const STRICT_DB = Deno.env.get('ALERT_STRICT_DB') === '1';

interface SendResult {
  ok: boolean;
  status: string;
  ref?: string;
  error?: string;
  retryable: boolean;
}

async function sendTelegram(token: string, chatId: string, text: string): Promise<SendResult> {
  if (!token || !chatId) {
    return { ok: false, status: 'not_configured', error: 'Telegram is not configured', retryable: false };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (res.ok) {
      let ref: string | undefined;
      try {
        const j = await res.json();
        if (j?.result?.message_id != null) ref = String(j.result.message_id);
      } catch { /* the body is informational only */ }
      return { ok: true, status: String(res.status), ref, retryable: true };
    }
    // 400/401/403/404: wrong chat, blocked bot, bad token - retrying cannot help. 429/5xx are transient.
    return { ok: false, status: String(res.status), error: `Telegram HTTP ${res.status}`, retryable: res.status === 429 || res.status >= 500 };
  } catch (e) {
    const err = e as Error;
    console.error('Telegram error:', err?.name);
    return { ok: false, status: 'network', error: err?.name === 'TimeoutError' ? 'timeout' : 'network error', retryable: true };
  }
}

const isMissingFunction = (e: { code?: string; message?: string } | null | undefined): boolean =>
  !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message ?? ''));

// Fail-open claim: only an explicit "false" from the ledger suppresses a send.
async function claim(admin: any, alertId: string | null, tier: number, channel: string, recipient: string): Promise<boolean> {
  if (!alertId) return true;   // unrecorded mode: no incident id, so no ledger
  try {
    const { data, error } = await admin.rpc('claim_notification', { p_alert: alertId, p_tier: tier, p_channel: channel, p_recipient: recipient });
    if (error) {
      console.error('claim_notification unavailable, sending anyway:', error.code);
      return true;
    }
    return data !== false;
  } catch (e) {
    console.error('claim_notification failed, sending anyway:', (e as Error)?.name);
    return true;
  }
}

async function complete(
  admin: any, alertId: string | null, tier: number, channel: string, recipient: string,
  status: 'sent' | 'failed' | 'skipped', providerStatus: string | null, providerRef: string | null,
  error: string | null, retryable = true,
): Promise<void> {
  if (!alertId) return;
  try {
    await admin.rpc('complete_notification', {
      p_alert: alertId, p_tier: tier, p_channel: channel, p_recipient: recipient,
      p_status: status, p_provider_status: providerStatus, p_provider_ref: providerRef, p_error: error, p_retryable: retryable,
    });
  } catch (e) {
    console.error('complete_notification failed:', (e as Error)?.name);
  }
}

// Best-effort in-memory de-duplication used ONLY when the incident could not be recorded (no ledger available).
const recentUnrecorded = new Map<string, number>();
const UNRECORDED_WINDOW_MS = 5 * 60 * 1000;

// No GPS from the device: fall back to the registered install pin (devices.latitude/longitude).
// A pin the resident placed that no admin has confirmed yet (location_verified, 20261102000000)
// is still sent, because it is better than nothing, but labelled so responders know it is unchecked.
function registeredPinString(device: { latitude?: unknown; longitude?: unknown; location_verified?: unknown }): string {
  const { latitude: lat, longitude: lng } = device;
  const valid = typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  if (!valid) return `GPS: Unavailable\n\n`;
  const status = device.location_verified === true
    ? 'confirmed by admin'
    : 'UNVERIFIED — set by resident, not yet confirmed by an admin';
  return `GPS: Unavailable\nRegistered pin: ${lat}, ${lng} (${status})\nNavigate: https://maps.google.com/?q=${lat},${lng}\n\n`;
}

// Push notification text. A notification shows about three short lines, so the reading that crossed its limit comes
// first, then the other reading, then where. Fault sentinels are never shown as readings: a disconnected DS18B20 reports
// -127 °C (firmware TEMP_FAULT_C), and a saturated MQ-7 reports the top of its range (2000 ppm; 10000 before 2.2.x).
const MQ7_RANGE_TOP_PPM = 2000;
const TEMP_FAULT_C = -127;

function pushText(p: {
  tier: number; co: number; temp: number; coLimit: number | null; tempLimit: number | null; deviceCode: string; location: string;
}): { title: string; body: string } {
  const coHigh = p.coLimit != null && p.co >= p.coLimit;
  const tempHigh = p.tempLimit != null && p.temp >= p.tempLimit;
  const coText = p.co >= MQ7_RANGE_TOP_PPM ? `CO ≥${MQ7_RANGE_TOP_PPM} ppm` : `CO ${Math.round(p.co)} ppm`;
  const tempText = p.temp <= TEMP_FAULT_C ? 'Temp sensor offline' : `Temp ${Math.round(p.temp * 10) / 10} °C`;
  const withLimit = (text: string, limit: number | null, unit: string) => (limit != null ? `${text} (limit ${limit}${unit})` : text);

  let title: string;
  let readings: string;
  if (p.tier >= 2) {
    title = 'FIRE ALERT – High CO and temperature';
    readings = `${coText} · ${tempText}`;
  } else if (tempHigh && !coHigh) {
    title = 'WARNING – High temperature';
    readings = `${withLimit(tempText, p.tempLimit, ' °C')} · ${coText}`;
  } else {
    title = 'WARNING – High CO level';
    readings = `${withLimit(coText, p.coLimit, ' ppm')} · ${tempText}`;
  }
  return { title, body: `${readings}\n${p.deviceCode} · ${p.location}` };
}

async function dispatchNotifications(p: {
  admin: any; alertId: string | null; tier: number; device: any; tgText: string;
  push: { title: string; body: string };
}): Promise<void> {
  const { admin, alertId, tier, device, tgText } = p;

  // The shared station chat (TELEGRAM_CHAT_ID) is the fire station's, so it gets fires (Tier 2) only, like the
  // BFP responders. Tier 1 warnings reach admins and the resident through push and their own linked Telegram (below).
  const telegram = (async () => {
    const token = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';
    const chatId = Deno.env.get('TELEGRAM_CHAT_ID') || '';
    if (tier < 2 || !token || !chatId) return;
    if (!(await claim(admin, alertId, tier, 'telegram_station', 'station'))) return;
    const r = await sendTelegram(token, chatId, tgText);
    await complete(admin, alertId, tier, 'telegram_station', 'station', r.ok ? 'sent' : 'failed', r.status, r.ref ?? null, r.error ?? null, r.retryable);
    if (r.ok && alertId) {
      await admin.from('alert_events').update({ telegram_sent: true }).eq('id', alertId);
    }
  })();

  // Recipients (owner decision OQ-06): admins and the device's resident on every tier; BFP responders on Tier 2
  // (fire) only. A Tier 1 warning is one sensor over its threshold, which the household checks first (and can
  // resolve itself), so it is not dispatched to the fire station. Every recipient must be an APPROVED, ACTIVE
  // account. Shared by push and per-user Telegram (D5.4/#95).
  const residentRole = `and(device_id.eq.${device.id},role.eq.resident)`;
  const recipientRoles = tier === 2
    ? `role.eq.admin,role.eq.bfp_responder,${residentRole}`
    : `role.eq.admin,${residentRole}`;

  // Per-user Telegram (owner decision D5.4, issue #95): any approved+active recipient who has linked their
  // own Telegram chat (profiles.telegram_chat_id) gets the same alert text the station chat receives, on the
  // same bot. This is additive to the station chat, not a replacement for it.
  const telegramUsers = (async () => {
    const token = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';
    if (!token) return;
    const { data: linked } = await admin
      .from('profiles')
      .select('id, telegram_chat_id')
      .eq('status', 'approved')
      .eq('is_active', true)
      .not('telegram_chat_id', 'is', null)
      .or(recipientRoles);
    const recipients: Array<{ id: string; telegram_chat_id: string }> = linked ?? [];
    if (recipients.length === 0) return;

    await Promise.all(recipients.map(async ({ id, telegram_chat_id }) => {
      if (!(await claim(admin, alertId, tier, 'telegram_user', id))) return;
      const r = await sendTelegram(token, telegram_chat_id, tgText);
      await complete(admin, alertId, tier, 'telegram_user', id, r.ok ? 'sent' : 'failed', r.status, r.ref ?? null, r.error ?? null, r.retryable);
    }));
  })();

  const push = (async () => {
    const { data: usersToNotify } = await admin
      .from('profiles')
      .select('id')
      .eq('status', 'approved')
      .eq('is_active', true)
      .or(recipientRoles);
    const userIds: string[] = (usersToNotify ?? []).map((u: { id: string }) => u.id);
    if (userIds.length === 0) return;

    const claimed: string[] = [];
    await Promise.all(userIds.map(async (id) => { if (await claim(admin, alertId, tier, 'push', id)) claimed.push(id); }));
    if (claimed.length === 0) return;

    let results: Array<{ userId: string; status: 'sent' | 'failed' | 'skipped'; provider_status?: string; error?: string; retryable?: boolean }> | null = null;
    let reached = false;
    let failStatus = 'network';
    let failError = 'push service unreachable';
    try {
      const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
        body: JSON.stringify({
          userIds: claimed,
          title: p.push.title,
          body: p.push.body,
          // Tapping the notification opens the page where the recipient's role handles this alert (src/components/AlertLink.tsx).
          url: alertId ? `/alert/${alertId}?device=${device.id}` : undefined,
          // Lets a push service replace an undelivered duplicate of the same alert+tier (partial duplicate mitigation).
          topic: alertId ? `a${alertId.replace(/-/g, '').slice(0, 24)}t${tier}` : undefined,
          // Opens the alert in the app: /alert sends each role to its own page for it (src/lib/alertLink.ts).
          url: `/alert?device=${encodeURIComponent(device.id)}`,
        }),
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      });
      if (res.ok) {
        reached = true;
        const j = await res.json().catch(() => null);
        results = Array.isArray(j?.results) ? j.results : null;
      } else {
        failStatus = String(res.status);
        failError = `send-push-notification HTTP ${res.status}`;
      }
    } catch (e) {
      failError = (e as Error)?.name === 'TimeoutError' ? 'timeout' : 'network error';
    }

    for (const id of claimed) {
      if (!reached) {
        await complete(admin, alertId, tier, 'push', id, 'failed', failStatus, null, failError, true);
      } else if (results) {
        const r = results.find((x) => x.userId === id);
        if (r) await complete(admin, alertId, tier, 'push', id, r.status, r.provider_status ?? null, null, r.error ?? null, r.retryable !== false);
        else await complete(admin, alertId, tier, 'push', id, 'failed', null, null, 'no result returned for recipient', true);
      } else {
        // older send-push-notification without per-recipient results: the call succeeded, individual outcomes unknown
        await complete(admin, alertId, tier, 'push', id, 'sent', 'unknown', null, null, true);
      }
    }
  })();

  await Promise.allSettled([telegram, telegramUsers, push]);
}

const fmtTime = (d: Date): string => d.toISOString().replace('T', ' ').substring(0, 19);

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const reply = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    // 1. Authenticate device
    const deviceKey = req.headers.get('x-device-key');
    if (!deviceKey) {
      return reply(401, { error: 'Missing x-device-key' });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: device, error: deviceError } = await supabaseAdmin
      .from('devices')
      .select('id, device_code, location_desc, latitude, longitude, location_verified, is_active, co_threshold, temp_threshold, bfp_contact')
      .eq('api_key', deviceKey)
      .maybeSingle();

    // A database FAULT is not an authentication failure: report it as a (retryable) 500, not a 401.
    if (deviceError) {
      console.error('device lookup failed:', deviceError.code);
      return reply(500, { error: 'Temporary server error', code: 'device_lookup_failed' });
    }
    if (!device || !device.is_active) {
      return reply(401, { error: 'Unauthorized or inactive device' });
    }

    // 2. Parse body safely
    let body;
    try {
      body = await req.json();
    } catch {
      return reply(400, { error: 'Invalid JSON payload', code: 'invalid_payload' });
    }

    // Fallback destructuring for legacy vs fixed firmware field names
    const temp_celsius = body.temp_celsius ?? body.temperature_c;
    const latitude = body.latitude ?? body.lat;
    const longitude = body.longitude ?? body.lng;
    const co_ppm = body.co_ppm;
    const gps_valid = body.gps_valid ?? false;

    // 3. Input validation before database touches
    const isValidNumber = (val: unknown): boolean => typeof val === 'number' && Number.isFinite(val);

    if (!isValidNumber(co_ppm) || !isValidNumber(temp_celsius)) {
      return reply(400, { error: 'Invalid payload: co_ppm and temp_celsius must be finite numbers', code: 'invalid_payload' });
    }

    // 3.5 Recalculate tier from server-side thresholds: the backend is authoritative (unchanged rules).
    const coThreshold = device.co_threshold ?? Infinity;
    const tempThreshold = device.temp_threshold ?? Infinity;

    const coExceeded = co_ppm >= coThreshold;
    const tempExceeded = temp_celsius >= tempThreshold;

    let tier: number;
    if (coExceeded && tempExceeded) {
      tier = 2;
    } else if (coExceeded || tempExceeded) {
      tier = 1;
    } else {
      return reply(400, { error: 'Sensor readings do not exceed thresholds; alert rejected.', code: 'below_threshold' });
    }

    if (gps_valid && (!isValidNumber(latitude) || !isValidNumber(longitude))) {
      return reply(400, { error: 'Invalid payload: latitude and longitude must be finite numbers when gps_valid is true', code: 'invalid_payload' });
    }

    // (0, 0) is the firmware's "no fix ever acquired" sentinel, not a real cached location.
    const hasCachedCoords =
      isValidNumber(latitude) && isValidNumber(longitude) && !(latitude === 0 && longitude === 0);

    // 4. Concurrent preparation (no alert_events read any more: raise_alert() does the deduplication atomically)
    const updateLastSeenPromise = supabaseAdmin
      .from('devices')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', device.id);

    const geocodePromise = hasCachedCoords
      ? reverseGeocode(latitude, longitude)
      : Promise.resolve(null);

    const ownerContactPromise = (tier === 2)
      ? supabaseAdmin
          .from('profiles')
          .select('contact_number')
          .eq('device_id', device.id)
          .eq('role', 'resident')
          // Only an approved, active resident may be the SMS recipient.
          .eq('status', 'approved')
          .eq('is_active', true)
          .maybeSingle()
      : Promise.resolve({ data: null });

    const [_, address_resolved, profileResult] = await Promise.all([
      updateLastSeenPromise,
      geocodePromise,
      ownerContactPromise,
    ]);

    const ownerContact = profileResult?.data?.contact_number || '';
    const now = new Date();

    // 5. PERSIST the incident first (idempotent, atomic).
    let incident: { alert_id: string; created: boolean; tier: number; triggered_at: string } | null = null;
    let persistence: 'raise_alert' | 'legacy' = 'raise_alert';
    let persistFailure: string | null = null;

    const { data: raised, error: raiseError } = await supabaseAdmin.rpc('raise_alert', {
      p_device_id: device.id,
      p_tier: tier,
      p_co: co_ppm,
      p_temp: temp_celsius,
      p_lat: hasCachedCoords ? latitude : null,
      p_lng: hasCachedCoords ? longitude : null,
      p_gps_valid: gps_valid === true,
      p_address: address_resolved || null,
    });

    if (!raiseError && Array.isArray(raised) && raised[0]) {
      incident = raised[0];
    } else if (raiseError && isMissingFunction(raiseError) && !STRICT_DB) {
      // Rolled out before migration 20261020000100: use the previous select-then-insert persistence.
      console.error('raise_alert missing - using legacy persistence');
      persistence = 'legacy';
      incident = await legacyPersist(supabaseAdmin, device, tier, co_ppm, temp_celsius, hasCachedCoords, latitude, longitude, gps_valid === true, address_resolved);
      if (!incident) persistFailure = 'legacy persistence failed';
    } else {
      persistFailure = raiseError ? `raise_alert failed (${raiseError.code ?? 'error'})` : 'raise_alert returned no incident';
    }

    // The effective tier is the tier now in force for the incident (never lower than an earlier, higher tier).
    const effectiveTier = incident?.tier ?? tier;
    const locationString = address_resolved || device.location_desc || 'Location not set';
    const timeString = fmtTime(now);

    let tgText = '';
    if (effectiveTier === 1) {
      tgText = `WARNING — Tier 1\n\nDevice: ${device.device_code}\nLocation: ${locationString}\nTime: ${timeString}\n\nElevated reading detected:\n- CO: ${co_ppm} ppm (threshold: ${device.co_threshold} ppm)\n- Temp: ${temp_celsius}°C (threshold: ${device.temp_threshold}°C)\n\nMonitor the area. No SMS dispatched at this level.`;
    } else {
      const gpsString = hasCachedCoords
        ? `GPS: ${latitude}, ${longitude}${gps_valid ? '' : ' (estimated — last known)'}\nNavigate: https://maps.google.com/?q=${latitude},${longitude}\n\n`
        : registeredPinString(device);

      // No line about SMS: the device texts only when it could not deliver this alert online (firmware 2.4.0+), which
      // this function cannot tell from the request.
      tgText = `FIRE ALERT — Tier 2\n\nDevice: ${device.device_code}\nLocation: ${locationString}\nTime: ${timeString}\n\nSensor readings:\n- CO: ${co_ppm} ppm (threshold: ${device.co_threshold} ppm)\n- Temp: ${temp_celsius}°C (threshold: ${device.temp_threshold}°C)\n\n${gpsString}`.trimEnd();
    }

    // 6. NOTIFY, bounded. If the incident could not be recorded, still make a best-effort station notification.
    let skipDispatch = false;
    if (!incident) {
      const key = `${device.id}:${effectiveTier}`;
      const last = recentUnrecorded.get(key) ?? 0;
      if (Date.now() - last < UNRECORDED_WINDOW_MS) skipDispatch = true;
      else recentUnrecorded.set(key, Date.now());
    }
    if (!skipDispatch) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const budget = new Promise<void>((resolve) => { timer = setTimeout(resolve, DISPATCH_BUDGET_MS); });
      const dispatch = dispatchNotifications({
        admin: supabaseAdmin, alertId: incident?.alert_id ?? null, tier: effectiveTier,
        device, tgText,
        push: pushText({
          tier: effectiveTier, co: co_ppm, temp: temp_celsius,
          coLimit: device.co_threshold ?? null, tempLimit: device.temp_threshold ?? null,
          deviceCode: device.device_code, location: locationString,
        }),
      }).catch((e) => console.error('dispatch failed:', (e as Error)?.name));
      // The budget only bounds how long the RESPONSE waits. Without waitUntil the runtime may shut the worker down
      // once the response is sent, killing whatever is still in flight (in practice push, the slowest channel),
      // which left its ledger claim 'pending' and the push never sent while Telegram had already gone out.
      (globalThis as any).EdgeRuntime?.waitUntil?.(dispatch);
      await Promise.race([dispatch, budget]);
      clearTimeout(timer);
    }

    if (!incident) {
      console.error('alert NOT recorded:', persistFailure);
      return reply(500, { error: 'Failed to record the alert; please retry', code: 'persist_failed' });
    }

    // 7. Response. Existing fields are unchanged (the firmware parses them); `created`, `tier` and `persistence` are additive.
    // address_resolved and triggered_at are threaded back so the SMS bodies can include them (spec SW-2.2.2).
    return reply(200, {
      success: true,
      alert_event_id: incident.alert_id,
      owner_contact: ownerContact,
      bfp_contact: device.bfp_contact || '',
      address_resolved: address_resolved || '',
      triggered_at: fmtTime(new Date(incident.triggered_at)),
      created: incident.created,
      tier: effectiveTier,
      persistence,
    });
  } catch (err) {
    console.error('trigger-alert internal error:', (err as Error)?.name, (err as Error)?.message);
    return reply(500, { error: 'Internal error', code: 'internal' });
  }
});

// Previous persistence (select-then-insert). Used ONLY while migration 20261020000100 is not applied.
async function legacyPersist(
  admin: any, device: any, tier: number, co_ppm: number, temp_celsius: number, hasCachedCoords: boolean,
  latitude: number, longitude: number, gps_valid: boolean, address_resolved: string | null,
): Promise<{ alert_id: string; created: boolean; tier: number; triggered_at: string } | null> {
  const { data: existing } = await admin
    .from('alert_events')
    .select('id, alert_tier, triggered_at')
    .eq('device_id', device.id)
    .is('resolved_at', null)
    .order('triggered_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const newTier = Math.max(existing.alert_tier, tier);
    const { error } = await admin
      .from('alert_events')
      .update({
        alert_tier: newTier,
        co_ppm,
        temp_celsius,
        latitude: hasCachedCoords ? latitude : undefined,
        longitude: hasCachedCoords ? longitude : undefined,
        gps_valid,
        address_resolved: address_resolved || undefined,
      })
      .eq('id', existing.id);
    if (error) return null;
    return { alert_id: existing.id, created: false, tier: newTier, triggered_at: existing.triggered_at ?? new Date().toISOString() };
  }

  const { data: inserted, error } = await admin
    .from('alert_events')
    .insert({
      device_id: device.id,
      alert_tier: tier,
      co_ppm,
      temp_celsius,
      latitude: hasCachedCoords ? latitude : null,
      longitude: hasCachedCoords ? longitude : null,
      gps_valid,
      address_resolved,
      telegram_sent: false,
      sms_sent_owner: false,
      sms_sent_bfp: false,
    })
    .select('id, triggered_at')
    .single();
  if (error || !inserted) return null;
  return { alert_id: inserted.id, created: true, tier, triggered_at: inserted.triggered_at ?? new Date().toISOString() };
}

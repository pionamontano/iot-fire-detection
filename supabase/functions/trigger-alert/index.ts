// @ts-nocheck
// deno-lint-ignore-file

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-device-key',
};

async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  if (!lat || !lon) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
      {
        headers: {
          // [FIX #7] Compliant User-Agent per Nominatim Usage Policy
          'User-Agent': 'AgapSense-FireAlertSystem/1.0 (trixyannbernades@gmail.com)'
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const data = await res.json();
    return data?.display_name || null;
  } catch (e) {
    console.error('Geocoding error/timeout:', e);
    return null;
  }
}

async function sendTelegram(token: string, chatId: string, text: string): Promise<boolean> {
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
      }),
    });
    return res.ok;
  } catch (e) {
    console.error('Telegram error:', e);
    return false;
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Authenticate device
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

    const { data: device, error: deviceError } = await supabaseAdmin
      .from('devices')
      .select('id, device_code, location_desc, is_active, co_threshold, temp_threshold, bfp_contact')
      .eq('api_key', deviceKey)
      .single();

    if (deviceError || !device || !device.is_active) {
      return new Response(JSON.stringify({ error: 'Unauthorized or inactive device' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Parse body safely
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // [FIX #2] Fallback destructuring for legacy vs fixed firmware field names
    const tier = body.tier ?? body.alert_tier;
    const temp_celsius = body.temp_celsius ?? body.temperature_c;
    const latitude = body.latitude ?? body.lat;
    const longitude = body.longitude ?? body.lng;
    const co_ppm = body.co_ppm;
    const gps_valid = body.gps_valid ?? false;

    // 3. [FIX #3] Input validation before database touches
    if (tier !== 1 && tier !== 2) {
      return new Response(JSON.stringify({ error: 'Invalid or missing tier (must be 1 or 2)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isValidNumber = (val: unknown): boolean => typeof val === 'number' && Number.isFinite(val);

    if (!isValidNumber(co_ppm) || !isValidNumber(temp_celsius)) {
      return new Response(
        JSON.stringify({ error: 'Invalid payload: co_ppm and temp_celsius must be finite numbers' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (gps_valid && (!isValidNumber(latitude) || !isValidNumber(longitude))) {
      return new Response(
        JSON.stringify({ error: 'Invalid payload: latitude and longitude must be finite numbers when gps_valid is true' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // 4. Run concurrent background operations
    const updateLastSeenPromise = supabaseAdmin
      .from('devices')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', device.id);

    const geocodePromise = (gps_valid && isValidNumber(latitude) && isValidNumber(longitude))
      ? reverseGeocode(latitude, longitude)
      : Promise.resolve(null);

    const ownerContactPromise = (tier === 2)
      ? supabaseAdmin
          .from('profiles')
          .select('contact_number')
          .eq('device_id', device.id)
          .eq('role', 'resident')
          .maybeSingle()
      : Promise.resolve({ data: null });

    // [FIX #6] Query for open alert to perform deduplication
    const openAlertPromise = supabaseAdmin
      .from('alert_events')
      .select('id, alert_tier')
      .eq('device_id', device.id)
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const [_, address_resolved, profileResult, openAlertResult] = await Promise.all([
      updateLastSeenPromise,
      geocodePromise,
      ownerContactPromise,
      openAlertPromise,
    ]);

    const ownerContact = profileResult?.data?.contact_number || '';
    const locationString = address_resolved || device.location_desc || 'Unknown Location';
    const timeString = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const existingOpenAlert = openAlertResult?.data;

    // 5. Send Telegram Notification
    const tgToken = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';
    const tgChatId = Deno.env.get('TELEGRAM_CHAT_ID') || '';

    let tgText = '';
    if (tier === 1) {
      tgText = `WARNING — Tier 1\n\nDevice: ${device.device_code}\nLocation: ${locationString}\nTime: ${timeString}\n\nElevated reading detected:\n- CO: ${co_ppm} ppm (threshold: ${device.co_threshold} ppm)\n- Temp: ${temp_celsius}°C (threshold: ${device.temp_threshold}°C)\n\nMonitor the area. No SMS dispatched at this level.`;
    } else {
      const gpsString = (gps_valid && latitude && longitude)
        ? `GPS: ${latitude}, ${longitude}\nNavigate: https://maps.google.com/?q=${latitude},${longitude}\n\n`
        : `GPS: Unavailable\n\n`;
      
      tgText = `FIRE ALERT — Tier 2\n\nDevice: ${device.device_code}\nLocation: ${locationString}\nTime: ${timeString}\n\nSensor readings:\n- CO: ${co_ppm} ppm (threshold: ${device.co_threshold} ppm)\n- Temp: ${temp_celsius}°C (threshold: ${device.temp_threshold}°C)\n\n${gpsString}SMS alerts have been dispatched.`;
    }

    const telegramSent = await sendTelegram(tgToken, tgChatId, tgText);

    let alertEventId: string;

    // 6. [FIX #6] Deduplication & Escalation Logic
    if (existingOpenAlert) {
      alertEventId = existingOpenAlert.id;
      const newTier = Math.max(existingOpenAlert.alert_tier, tier);

      const { error: updateError } = await supabaseAdmin
        .from('alert_events')
        .update({
          alert_tier: newTier,
          co_ppm,
          temp_celsius,
          latitude: gps_valid ? latitude : undefined,
          longitude: gps_valid ? longitude : undefined,
          gps_valid: gps_valid ?? false,
          address_resolved: address_resolved || undefined,
          ...(telegramSent && { telegram_sent: true }),
        })
        .eq('id', alertEventId);

      if (updateError) {
        throw new Error(`Failed to update open alert event: ${updateError.message}`);
      }
    } else {
      // [FIX #1] Only insert into alert_events (sensor_readings insert omitted)
      // [FIX #4] sms_sent_owner/bfp pre-set to false
      const { data: newAlert, error: insertError } = await supabaseAdmin
        .from('alert_events')
        .insert({
          device_id: device.id,
          alert_tier: tier,
          co_ppm,
          temp_celsius,
          latitude: gps_valid ? latitude : null,
          longitude: gps_valid ? longitude : null,
          gps_valid: gps_valid ?? false,
          address_resolved,
          telegram_sent: telegramSent,
          sms_sent_owner: false,
          sms_sent_bfp: false,
        })
        .select('id')
        .single();

      if (insertError || !newAlert) {
        throw new Error(`Failed to insert alert event: ${insertError?.message}`);
      }

      alertEventId = newAlert.id;
    }

    // 7. [FIX #5] Return response containing alert_event_id
    return new Response(
      JSON.stringify({
        success: true,
        alert_event_id: alertEventId,
        owner_contact: ownerContact,
        bfp_contact: device.bfp_contact || '',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (err) {
    const error = err as Error;
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
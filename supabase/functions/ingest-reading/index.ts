// @ts-nocheck
// deno-lint-ignore-file

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-device-key',
};

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
      .select('id, is_active, co_threshold, temp_threshold')
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

    // 4. Batch async database writes
    const writePromises: Promise<any>[] = [
      // Insert sensor reading — null out coordinates when GPS fix is not valid
      supabaseAdmin.from('sensor_readings').insert({
        device_id: device.id,
        co_ppm,
        temp_celsius,
        latitude:  gps_valid ? latitude  : null,
        longitude: gps_valid ? longitude : null,
        gps_valid,
        on_battery,
        sensor_ready,
      }),
      // Touch last_seen_at
      supabaseAdmin.from('devices').update({ last_seen_at: nowIso }).eq('id', device.id),
    ];

    // 5. Auto-resolution check (strictly below threshold to avoid boundary flapping)
    const coThreshold   = device.co_threshold   ?? Infinity;
    const tempThreshold = device.temp_threshold  ?? Infinity;

    const isStrictlyBelowThresholds =
      co_ppm   < coThreshold &&
      temp_celsius < tempThreshold;

    if (sensor_ready && isStrictlyBelowThresholds) {
      writePromises.push(
        supabaseAdmin
          .from('alert_events')
          .update({ resolved_at: nowIso })
          .eq('device_id', device.id)
          .is('resolved_at', null)
      );
    }

    const results = await Promise.all(writePromises);
    const insertResult = results[0];

    if (insertResult.error) throw insertResult.error;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err) {
    const error = err as Error;
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
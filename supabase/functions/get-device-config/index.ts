// @ts-nocheck
// deno-lint-ignore-file

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// =============================================================
// get-device-config — Remote threshold/contact fetch for firmware.
// Called by connectivity.cpp:fetchRemoteConfig() every
// CONFIG_FETCH_INTERVAL_MS (10 min) and once at boot. Lets an admin
// change a device's co_threshold/temp_threshold/bfp_contact from the
// dashboard and have the field pick it up without a re-flash.
// Device auth is identical to ingest-reading/trigger-alert: the
// x-device-key header is matched against devices.api_key. The
// ?device_id= query param the firmware also sends is informational
// only (it's actually the human-readable DEVICE_ID string, not the
// UUID) - it is not used for authentication.
// =============================================================

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

    const { data: device, error: deviceError } = await supabaseAdmin
      .from('devices')
      .select('id, co_threshold, temp_threshold, bfp_contact, is_active')
      .eq('api_key', deviceKey)
      .maybeSingle();

    if (deviceError || !device || !device.is_active) {
      return new Response(JSON.stringify({ error: 'Unauthorized or inactive device' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: ownerProfile } = await supabaseAdmin
      .from('profiles')
      .select('contact_number')
      .eq('device_id', device.id)
      .eq('role', 'resident')
      .maybeSingle();

    return new Response(
      JSON.stringify({
        co_alert_ppm: device.co_threshold,
        temp_alert_c: device.temp_threshold,
        owner_number: ownerProfile?.contact_number || '',
        bfp_number: device.bfp_contact || '',
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

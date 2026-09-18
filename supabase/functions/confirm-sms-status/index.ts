// @ts-nocheck
// deno-lint-ignore-file

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// =============================================================
// confirm-sms-status — SMS delivery confirmation from firmware.
// Called by connectivity.cpp:postSmsStatus(), once per SMS, after
// the GSM task's gsmSendSms() returns a real +CMGS outcome. Updates
// alert_events.sms_sent_owner/sms_sent_bfp so the dashboard reflects
// actual delivery instead of the hardcoded `false` trigger-alert
// inserts at alert-creation time.
// Device auth matches ingest-reading/trigger-alert/get-device-config:
// x-device-key checked against devices.api_key. The update is scoped
// to that device's own alert_events rows so one device can't mark
// another device's alert as delivered.
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
      .select('id, is_active')
      .eq('api_key', deviceKey)
      .maybeSingle();

    if (deviceError || !device || !device.is_active) {
      return new Response(JSON.stringify({ error: 'Unauthorized or inactive device' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { alert_event_id, role, success } = body;

    if (!alert_event_id || typeof alert_event_id !== 'string') {
      return new Response(JSON.stringify({ error: 'alert_event_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (role !== 'owner' && role !== 'bfp') {
      return new Response(JSON.stringify({ error: "role must be 'owner' or 'bfp'" }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (typeof success !== 'boolean') {
      return new Response(JSON.stringify({ error: 'success must be a boolean' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const updateColumn = role === 'owner' ? 'sms_sent_owner' : 'sms_sent_bfp';

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('alert_events')
      .update({ [updateColumn]: success })
      .eq('id', alert_event_id)
      .eq('device_id', device.id)
      .select('id')
      .maybeSingle();

    if (updateError) throw updateError;

    if (!updated) {
      return new Response(JSON.stringify({ error: 'alert_event_id not found for this device' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

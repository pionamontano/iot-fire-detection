// @ts-nocheck
// deno-lint-ignore-file

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Verify calling user is an authenticated Resident
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user } } = await supabaseClient.auth.getUser()

    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('role, device_id')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile || profile.role !== 'resident') {
      return new Response(JSON.stringify({ error: 'Forbidden. Resident access required.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 403,
      })
    }

    // 2. Parse and validate request body
    let body
    try {
      body = await req.json()
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    const { device_code } = body

    if (!device_code || typeof device_code !== 'string' || device_code.trim().length === 0) {
      return new Response(JSON.stringify({ error: 'Device code is required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    // 3. Look up device using service role key (bypasses RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: device, error: deviceError } = await supabaseAdmin
      .from('devices')
      .select('id, is_active')
      .eq('device_code', device_code.trim())
      .maybeSingle()

    if (deviceError || !device) {
      return new Response(JSON.stringify({ error: 'Device not found. Please check the code and try again.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      })
    }

    if (!device.is_active) {
      return new Response(JSON.stringify({ error: 'This device is inactive or has been retired.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 403,
      })
    }

    // 4. Prevent silent replacement of an existing device assignment
    if (profile.device_id && profile.device_id !== device.id) {
      return new Response(JSON.stringify({ error: 'You already have a device linked. Unlink it before registering a new one.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 409,
      })
    }

    // 5. Check if device is already assigned to a different resident
    const { data: existingProfiles, error: pError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('device_id', device.id)
      .eq('role', 'resident')
      .limit(1)

    if (pError) throw pError

    if (existingProfiles && existingProfiles.length > 0 && existingProfiles[0].id !== user.id) {
      return new Response(JSON.stringify({ error: 'This device is already registered to another account.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 409,
      })
    }

    // 6. Link device to resident profile
    const { data: updatedProfile, error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ device_id: device.id })
      .eq('id', user.id)
      .select('id, device_id, setup_complete')
      .single()

    if (updateError) throw updateError

    return new Response(JSON.stringify({ success: true, profile: updatedProfile }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (err) {
    const error = err as Error
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
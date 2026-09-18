// @ts-nocheck
// deno-lint-ignore-file

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// =============================================================
// Public Registration Edge Function
// Deploy with: supabase functions deploy register --no-verify-jwt
// This function accepts unauthenticated requests.
// =============================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const {
      full_name, email, password, contact_number,
      requested_role, address, device_code,
      organization, position, verification_info
    } = await req.json()

    // --- Validate required fields ---
    if (!full_name || !email || !password || !requested_role) {
      return new Response(JSON.stringify({ error: 'Missing required fields: full name, email, password, and role are required.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    if (!['resident', 'bfp_responder'].includes(requested_role)) {
      return new Response(JSON.stringify({ error: 'Invalid role. Must be resident or bfp_responder.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    // Validate phone format (Philippine mobile)
    if (contact_number && !/^09\d{9}$/.test(contact_number)) {
      return new Response(JSON.stringify({ error: 'Invalid phone number format. Use 09XXXXXXXXX.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    // Validate password length
    if (password.length < 6) {
      return new Response(JSON.stringify({ error: 'Password must be at least 6 characters.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email address.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    // Role-specific validation
    if (requested_role === 'resident' && !address) {
      return new Response(JSON.stringify({ error: 'Address is required for resident registration.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    if (requested_role === 'bfp_responder' && !organization) {
      return new Response(JSON.stringify({ error: 'Organization / Fire Station is required for responder registration.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    // --- Create auth user (service role) ---
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (createError) {
      if (createError.message?.includes('already been registered') || createError.message?.includes('already registered')) {
        return new Response(JSON.stringify({ error: 'An account with this email already exists.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 409,
        })
      }
      throw createError
    }

    // --- Create profile with pending status ---
    const { error: profileError } = await supabaseAdmin.from('profiles').insert({
      id: newUser.user.id,
      full_name,
      role: requested_role,
      contact_number: contact_number || null,
      address: address || null,
      status: 'pending',
      setup_complete: false,
    })

    if (profileError) {
      // Rollback: delete auth user
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id)
      throw profileError
    }

    // --- Create registration request entry (extra metadata for admin review) ---
    const { error: reqError } = await supabaseAdmin.from('registration_requests').insert({
      user_id: newUser.user.id,
      email,
      requested_role,
      device_code: device_code || null,
      organization: organization || null,
      position: position || null,
      verification_info: verification_info || null,
    })

    if (reqError) {
      // Rollback: delete profile and auth user
      await supabaseAdmin.from('profiles').delete().eq('id', newUser.user.id)
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id)
      throw reqError
    }

    // --- Soft, non-blocking check: does this device_code exist? ---
    // device_code is free text on registration_requests, never validated
    // against the real devices table - a resident may legitimately
    // register before their device is provisioned, so an unrecognized
    // code doesn't block registration, it's just surfaced back to the
    // caller so the UI can show a heads-up and the admin reviewing the
    // request knows to double check it.
    let device_code_recognized: boolean | null = null
    if (device_code) {
      const { data: matchedDevice } = await supabaseAdmin
        .from('devices')
        .select('id')
        .eq('device_code', device_code)
        .maybeSingle()
      device_code_recognized = !!matchedDevice
    }

    return new Response(JSON.stringify({ success: true, device_code_recognized }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (err) {
    const error = err as Error;
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})

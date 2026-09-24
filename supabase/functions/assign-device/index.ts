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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    // 1. Verify calling user is Admin
    const {
      data: { user },
    } = await supabaseClient.auth.getUser()

    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    // Check role in profiles
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('role, status')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== 'admin' || profile.status !== 'approved') {
      return new Response(JSON.stringify({ error: 'Forbidden. Approved admin access required.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 403,
      })
    }

    // 2. Parse request body
    const { profile_id, device_id } = await req.json()

    if (!profile_id) {
      return new Response(JSON.stringify({ error: 'profile_id is required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    // 3. Update the user using service role key (bypassing RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Prevent assigning a device that's already claimed by a different
    // resident (link-device already guards this for the self-service
    // path; this path had no equivalent check).
    if (device_id) {
      const { data: existingProfiles, error: pError } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('device_id', device_id)
        .eq('role', 'resident')
        .neq('id', profile_id)
        .limit(1)

      if (pError) throw pError

      if (existingProfiles && existingProfiles.length > 0) {
        return new Response(JSON.stringify({ error: 'This device is already assigned to another resident.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 409,
        })
      }
    }

    const { data: updatedProfile, error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ device_id: device_id || null })
      .eq('id', profile_id)
      .select()
      .single()

    if (updateError) throw updateError

    return new Response(JSON.stringify({ success: true, profile: updatedProfile }), {
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

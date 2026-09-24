// @ts-nocheck
// deno-lint-ignore-file

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// =============================================================
// Server-side login gate — fixes SW-2.6.2's lockout having no real
// enforcement.
//
// Before this function existed, Login.tsx called
// supabase.auth.signInWithPassword() directly from the browser,
// after first asking check_login_lockout() for permission. Nothing
// stopped a script from skipping that RPC and hitting Supabase
// Auth's own /auth/v1/token endpoint directly with the public anon
// key - confirmed live: 10 straight direct calls against an
// already-"locked" account were all evaluated normally, with zero
// throttling. Worse, even through the real UI, once locked the
// client's own pre-check intercepted every resubmission before a
// new failure could ever be recorded, so tiers above the first
// (30s/900s) were unreachable - confirmed live: 7 real form
// submissions against a locked account produced only 3 real
// login_attempts rows.
//
// This function is the only thing anon key holders should call to
// sign in now (Login.tsx calls this instead of
// signInWithPassword()). It does the check-then-record atomically,
// server-side, with the service role:
//   1. check_login_lockout - refuse before ever touching GoTrue if
//      already locked, exactly like before, but now authoritative
//      for every caller of this function rather than optional.
//   2. Only if not locked, forward the real credential check to
//      GoTrue itself (still Supabase's own password verification -
//      this function never sees or stores a raw comparison).
//   3. Record the outcome in login_attempts unconditionally, so a
//      caller can no longer dodge having a failure counted.
//   4. On success, hand back GoTrue's real session tokens so the
//      browser's supabase-js client can adopt them via
//      setSession() exactly as if signInWithPassword() had
//      returned them.
//
// This still cannot stop a scripted attacker who calls Supabase
// Auth's /auth/v1/token endpoint directly instead of this function
// - the anon key is public by design, and GoTrue is a separate
// service this project's Postgres policies have no reach into.
// That gap is closed at the platform level, via Supabase's own
// Auth rate-limiting (Dashboard -> Authentication -> Rate Limits),
// not from application code. What this function does close: our
// own app's login page can no longer be tricked (accidentally or
// deliberately) into skipping the lockout, and the lockout tiers
// actually escalate the way SW-2.6.2 describes.
//
// Deploy with: supabase functions deploy login --no-verify-jwt
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
    const { email, password } = await req.json()

    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'Email and password are required.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const supabaseAdmin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

    // --- 1. Refuse before ever touching GoTrue if already locked ---
    const { data: lockoutData, error: lockoutError } = await supabaseAdmin.rpc('check_login_lockout', { p_email: email })
    if (lockoutError) throw lockoutError
    const lockoutStatus = lockoutData?.[0]

    if (lockoutStatus?.locked) {
      return new Response(JSON.stringify({
        error: 'Too many failed attempts. Please wait before trying again.',
        locked: true,
        retry_after_seconds: lockoutStatus.retry_after_seconds,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 429,
      })
    }

    // --- 2. Forward the real credential check to GoTrue itself ---
    const authResp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const authData = await authResp.json()
    const success = authResp.ok

    // --- 3. Record the outcome unconditionally, server-side ---
    const { error: insertError } = await supabaseAdmin.from('login_attempts').insert({ email, success })
    if (insertError) throw insertError

    if (!success) {
      // Re-check immediately so the client gets the fresh tier this
      // very failure may have just crossed into.
      const { data: newLockoutData } = await supabaseAdmin.rpc('check_login_lockout', { p_email: email })
      const newLockoutStatus = newLockoutData?.[0]
      return new Response(JSON.stringify({
        error: authData.error_description || authData.msg || 'Invalid login credentials',
        locked: newLockoutStatus?.locked ?? false,
        retry_after_seconds: newLockoutStatus?.retry_after_seconds ?? 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    // --- 4. Success: hand back the real session for the client to adopt ---
    return new Response(JSON.stringify({
      access_token: authData.access_token,
      refresh_token: authData.refresh_token,
    }), {
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

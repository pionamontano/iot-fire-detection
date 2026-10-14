// @ts-nocheck
// deno-lint-ignore-file

// Admin-only account management for the Users page:
//   list        -> login email + last sign-in for every account (profiles has no email column)
//   update      -> name, contact number, address, role, login email, temporary password
//   set_active  -> deactivate / reactivate an account
//
// There is deliberately no hard delete: profiles is referenced by registration and
// support history (ON DELETE CASCADE) and by alert_events.acknowledged_by (no cascade),
// so deleting would either erase history or fail. Deactivation is the "delete":
// is_active=false already drops the user from every alert fan-out (trigger-alert,
// incident RPCs), and the auth ban stops new sign-ins and token refreshes.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ROLES = ['resident', 'bfp_responder', 'admin']
// ~100 years: Supabase has no "permanent" ban, only a duration.
const BAN_FOREVER = '876000h'

const respond = (body, status = 200) => new Response(JSON.stringify(body), {
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  status,
})

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

    // 1. Verify calling user is an approved, active Admin
    const {
      data: { user },
    } = await supabaseClient.auth.getUser()

    if (!user) return respond({ error: 'Unauthorized' }, 401)

    const { data: caller } = await supabaseClient
      .from('profiles')
      .select('role, status, is_active')
      .eq('id', user.id)
      .single()

    if (!caller || caller.role !== 'admin' || caller.status !== 'approved' || caller.is_active === false) {
      return respond({ error: 'Forbidden. Approved admin access required.' }, 403)
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body = await req.json()
    const { action } = body

    // 2. list: auth-side details the profiles table does not carry
    if (action === 'list') {
      const users = []
      for (let page = 1; ; page++) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })
        if (error) throw error
        users.push(...data.users)
        if (data.users.length < 1000) break
      }
      return respond({
        users: users.map((u) => ({ id: u.id, email: u.email ?? null, last_sign_in_at: u.last_sign_in_at ?? null })),
      })
    }

    const { user_id } = body
    if (!user_id) return respond({ error: 'user_id is required' }, 400)

    const { data: target } = await supabaseAdmin
      .from('profiles')
      .select('id, role, device_id, is_active')
      .eq('id', user_id)
      .maybeSingle()

    if (!target) return respond({ error: 'User not found' }, 404)

    const isSelf = user_id === user.id

    // 3. update
    if (action === 'update') {
      const { full_name, contact_number, address, role, email, password } = body
      const patch = {}

      if (full_name !== undefined) {
        const name = String(full_name).trim()
        if (!name) return respond({ error: 'Full name is required' }, 400)
        if (name.length > 120) return respond({ error: 'Full name is too long' }, 400)
        patch.full_name = name
      }

      if (contact_number !== undefined) {
        const phone = String(contact_number ?? '').trim()
        if (phone && !/^09\d{9}$/.test(phone)) {
          return respond({ error: 'Invalid phone format. Must be 11 digits starting with 09' }, 400)
        }
        patch.contact_number = phone || null
      }

      if (address !== undefined) {
        const addr = String(address ?? '').trim()
        if (addr.length > 300) return respond({ error: 'Address is too long' }, 400)
        patch.address = addr || null
      }

      if (role !== undefined && role !== target.role) {
        if (!ROLES.includes(role)) return respond({ error: 'Invalid role' }, 400)
        // Also guarantees an admin always remains: the caller is an admin and
        // can only change other people's roles.
        if (isSelf) return respond({ error: 'You cannot change your own role.' }, 400)
        patch.role = role
        // Devices belong to residents only (trigger-alert looks up the SMS
        // recipient by device_id + role=resident), so a role change frees it.
        if (role !== 'resident' && target.device_id) patch.device_id = null
      }

      const authPatch = {}
      if (email !== undefined && email !== null && String(email).trim()) {
        const addr = String(email).trim().toLowerCase()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return respond({ error: 'Invalid email address' }, 400)
        authPatch.email = addr
        authPatch.email_confirm = true
      }
      if (password) {
        if (String(password).length < 6) return respond({ error: 'Password must be at least 6 characters' }, 400)
        authPatch.password = String(password)
      }

      // Auth first: a duplicate email is the likeliest failure, and it should
      // stop the request before any profile field changes.
      if (Object.keys(authPatch).length > 0) {
        const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(user_id, authPatch)
        if (authError) throw authError
      }

      let profile = null
      if (Object.keys(patch).length > 0) {
        const { data, error: updateError } = await supabaseAdmin
          .from('profiles')
          .update(patch)
          .eq('id', user_id)
          .select()
          .single()
        if (updateError) throw updateError
        profile = data
      }

      return respond({ success: true, profile, device_released: patch.device_id === null })
    }

    // 4. set_active
    if (action === 'set_active') {
      const active = body.active === true
      if (!active && isSelf) return respond({ error: 'You cannot deactivate your own account.' }, 400)

      const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
        ban_duration: active ? 'none' : BAN_FOREVER,
      })
      if (banError) throw banError

      const { data: profile, error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({ is_active: active })
        .eq('id', user_id)
        .select()
        .single()
      if (updateError) throw updateError

      return respond({ success: true, profile })
    }

    return respond({ error: 'Unknown action' }, 400)
  } catch (err) {
    const error = err as Error;
    return respond({ error: error.message }, 400)
  }
})

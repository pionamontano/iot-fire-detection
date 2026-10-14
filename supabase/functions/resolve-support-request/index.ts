// @ts-nocheck
// deno-lint-ignore-file

// Admin-only: resolve or reopen a support request, and tell the requester.
//   { request_id, status: 'resolved', admin_notes? } -> marks it resolved, then
//       messages the requester on their linked Telegram chat and by browser push
//   { request_id, status: 'open' }                   -> reopens it (no message)
//
// The notes are shown to the requester (in-app and in the message), so they
// are a reply, not an internal comment. Notification is best effort: the
// resolution is saved first and a failed or unconfigured Telegram/push never
// undoes it; the response says what was delivered.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const NOTIFY_TIMEOUT_MS = 3500
const MAX_NOTES = 1000

const respond = (body, status = 200) => new Response(JSON.stringify(body), {
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  status,
})

async function sendTelegram(chatId, text) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN') || ''
  if (!token) return 'not_configured'
  if (!chatId) return 'not_linked'
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    })
    return res.ok ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}

async function sendPush(userId, title, body) {
  try {
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
      body: JSON.stringify({ userIds: [userId], title, body }),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    })
    if (res.status === 503) return 'not_configured'
    if (!res.ok) return 'failed'
    const data = await res.json().catch(() => null)
    const outcome = data?.results?.find((r) => r.userId === userId)?.status
    return outcome ?? (data?.sentCount > 0 ? 'sent' : 'skipped')
  } catch {
    return 'failed'
  }
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

    const { data: { user } } = await supabaseClient.auth.getUser()
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

    const { request_id, status, admin_notes } = await req.json()
    if (!request_id) return respond({ error: 'request_id is required' }, 400)
    if (status !== 'resolved' && status !== 'open') return respond({ error: "status must be 'resolved' or 'open'" }, 400)

    const notes = String(admin_notes ?? '').trim()
    if (notes.length > MAX_NOTES) return respond({ error: `Notes must be at most ${MAX_NOTES} characters` }, 400)

    const { data: request } = await supabaseAdmin
      .from('support_requests')
      .select('id, user_id, category')
      .eq('id', request_id)
      .maybeSingle()
    if (!request) return respond({ error: 'Support request not found' }, 404)

    if (status === 'open') {
      const { error } = await supabaseAdmin
        .from('support_requests')
        .update({ status: 'open', reviewed_by: null, reviewed_at: null })
        .eq('id', request_id)
      if (error) throw error
      return respond({ success: true })
    }

    // Only notify on the open -> resolved transition, so a double click, two
    // admins at once, or a re-save never messages the requester twice. The
    // status filter makes the transition atomic: only one call matches.
    const resolvedFields = { status: 'resolved', admin_notes: notes || null, reviewed_by: user.id, reviewed_at: new Date().toISOString() }
    const { data: transitioned, error: updateError } = await supabaseAdmin
      .from('support_requests')
      .update(resolvedFields)
      .eq('id', request_id)
      .eq('status', 'open')
      .select('id')
    if (updateError) throw updateError

    if (!transitioned?.length) {
      // Already resolved: just save the edited notes.
      const { error } = await supabaseAdmin
        .from('support_requests')
        .update({ admin_notes: notes || null })
        .eq('id', request_id)
      if (error) throw error
      return respond({ success: true, notified: { telegram: 'skipped', push: 'skipped' } })
    }

    // Same eligibility rule as alert delivery: approved, active accounts only.
    const { data: requester } = await supabaseAdmin
      .from('profiles')
      .select('id, status, is_active, telegram_chat_id')
      .eq('id', request.user_id)
      .maybeSingle()
    if (!requester || requester.status !== 'approved' || requester.is_active === false) {
      return respond({ success: true, notified: { telegram: 'skipped', push: 'skipped' } })
    }

    const title = 'Support request resolved'
    const body = `Your "${request.category}" request was resolved by the administrator.${notes ? `\nNote: ${notes}` : ''}`
    const [telegram, push] = await Promise.all([
      sendTelegram(requester.telegram_chat_id, `AgapSense: ${body}`),
      sendPush(requester.id, title, body),
    ])

    return respond({ success: true, notified: { telegram, push } })
  } catch (err) {
    const error = err as Error
    return respond({ error: error.message }, 400)
  }
})

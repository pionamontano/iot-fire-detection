import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Configure Web Push with VAPID keys
// In production, these should be securely stored in Supabase Vault or Edge Function Secrets
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY');
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY');

const vapidConfigured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (vapidConfigured) {
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@agapsense.com',
    VAPID_PUBLIC_KEY!,
    VAPID_PRIVATE_KEY!
  );
} else {
  console.error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set; push delivery disabled.');
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!vapidConfigured) {
    return new Response(JSON.stringify({ error: 'Push not configured' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Callers: the service role (trigger-alert) may notify anyone; an
    // authenticated user may only notify themselves, except admins.
    const authHeader = req.headers.get('Authorization') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const isServiceRole = serviceRoleKey !== '' && timingSafeEqual(authHeader, `Bearer ${serviceRoleKey}`);

    const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        serviceRoleKey
    );

    let callerId: string | null = null;
    let callerIsAdmin = false;
    if (!isServiceRole) {
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
      if (userError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      callerId = user.id;
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('role, status, is_active')
        .eq('id', user.id)
        .maybeSingle();
      callerIsAdmin = profile?.role === 'admin' && profile?.status === 'approved' && profile?.is_active !== false;
    }

    const { userIds, title, body, icon, topic } = await req.json();

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing or invalid userIds array' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!isServiceRole && !callerIsAdmin && !userIds.every((id: unknown) => id === callerId)) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Independently of the caller (including the service role), only deliver
    // to approved, active accounts. This is a second line of defence behind
    // trigger-alert's own recipient selection and register-push's gate.
    const requestedIds = userIds.filter((id: unknown): id is string => typeof id === 'string');
    const { data: eligibleProfiles, error: eligibleError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .in('id', requestedIds)
      .eq('status', 'approved')
      .eq('is_active', true);

    if (eligibleError) {
      throw eligibleError;
    }

    const eligibleIds = (eligibleProfiles ?? []).map((p: { id: string }) => p.id);

    // One result per REQUESTED recipient, so the caller (trigger-alert's delivery ledger) can record what really happened
    // instead of assuming success. status: 'sent' (at least one endpoint accepted), 'failed', or 'skipped' (nothing to send to).
    type Outcome = { userId: string; status: 'sent' | 'failed' | 'skipped'; provider_status?: string; error?: string; retryable?: boolean };
    const results: Outcome[] = [];
    for (const id of requestedIds) {
      if (!eligibleIds.includes(id)) results.push({ userId: id, status: 'skipped', error: 'recipient not eligible', retryable: false });
    }

    if (eligibleIds.length === 0) {
      return new Response(JSON.stringify({ success: true, sentCount: 0, attempted: 0, results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch subscriptions for the eligible user IDs
    const { data: subscriptions, error: subError } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*')
      .in('user_id', eligibleIds);

    if (subError) {
      throw subError;
    }

    const payload = JSON.stringify({ title, body, icon });
    // A timeout stops one slow push service from holding the whole alert; `topic` (<= 32 URL-safe chars) lets the push
    // service replace an undelivered duplicate of the same alert. Expired endpoints are REPORTED, never deleted here.
    const sendOptions: Record<string, unknown> = { timeout: 3000 };
    if (typeof topic === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(topic)) sendOptions.topic = topic;

    const outcomes = await Promise.all(subscriptions.map(async (sub: any) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };
      try {
        const res = await webpush.sendNotification(pushSubscription, payload, sendOptions);
        return { userId: sub.user_id as string, ok: true, statusCode: res?.statusCode as number | undefined };
      } catch (err: any) {
        // log the push service HOST and status only: the endpoint URL itself is a bearer-like secret
        let host = 'unknown';
        try { host = new URL(sub.endpoint).host; } catch { /* keep 'unknown' */ }
        console.error(`Failed to send push via ${host}: status ${err?.statusCode ?? 'n/a'}`);
        return { userId: sub.user_id as string, ok: false, statusCode: err?.statusCode as number | undefined };
      }
    }));

    for (const id of eligibleIds) {
      const mine = outcomes.filter((o) => o.userId === id);
      if (mine.length === 0) {
        results.push({ userId: id, status: 'skipped', error: 'no push subscription', retryable: false });
      } else if (mine.some((o) => o.ok)) {
        results.push({ userId: id, status: 'sent', provider_status: String(mine.find((o) => o.ok)?.statusCode ?? 'ok') });
      } else {
        const allExpired = mine.every((o) => o.statusCode === 404 || o.statusCode === 410);
        results.push({
          userId: id, status: 'failed', provider_status: String(mine[mine.length - 1].statusCode ?? 'error'),
          error: allExpired ? 'all endpoints expired' : 'push service rejected or unreachable', retryable: !allExpired,
        });
      }
    }

    const sentUsers = results.filter((r) => r.status === 'sent').length;
    return new Response(JSON.stringify({ success: true, sentCount: sentUsers, attempted: subscriptions.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

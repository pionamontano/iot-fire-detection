import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NOTIFY_TIMEOUT_MS = 3500;
const ROLE_LABEL: Record<string, string> = { admin: 'Administrator', bfp_responder: 'BFP Responder', resident: 'Resident' };

// Tells every approved, active admin about a new request: browser push (opens
// the request) and their linked Telegram chat. Best effort: the request is
// already saved, and a failed or unconfigured channel is only logged.
async function notifyAdmins(
  supabaseAdmin: any,
  request: { id: string; category: string; message: string },
  requester: { full_name: string; role: string },
) {
  const { data: admins, error } = await supabaseAdmin
    .from('profiles')
    .select('id, telegram_chat_id')
    .eq('role', 'admin')
    .eq('status', 'approved')
    .eq('is_active', true);
  if (error || !admins?.length) return;

  const path = `/admin/support?request=${request.id}`;
  const who = `${requester.full_name || 'A user'} (${ROLE_LABEL[requester.role] ?? requester.role ?? 'unknown role'})`;
  const preview = request.message.length > 200 ? request.message.slice(0, 197) + '...' : request.message;
  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '');

  const push = fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
    body: JSON.stringify({
      userIds: admins.map((a: { id: string }) => a.id),
      title: `Support request: ${request.category}`,
      body: `${who}: ${preview}`,
      url: path,
    }),
    signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
  });

  const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
  const text = `AgapSense: new support request\n${request.category} from ${who}\n\n${preview}${appUrl ? `\n\nOpen: ${appUrl}${path}` : ''}`;
  const telegram = token ? admins
    .filter((a: { telegram_chat_id: string | null }) => a.telegram_chat_id)
    .map((a: { telegram_chat_id: string }) => fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: a.telegram_chat_id, text }),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    })) : [];

  const results = await Promise.allSettled([push, ...telegram]);
  results.forEach((r) => {
    if (r.status === 'rejected') console.error('Support request notification failed:', (r.reason as Error)?.name);
    else if (!r.value.ok) console.error('Support request notification HTTP', r.value.status);
  });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const { category, message } = await req.json();

    if (!category || !message) {
      return new Response(JSON.stringify({ error: 'Category and message are required.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('full_name, contact_number, role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: 'Failed to fetch user profile' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('support_requests')
      .insert({
        user_id: user.id,
        category,
        message,
        contact_email: user.email ?? null,
        contact_phone: user.phone || user.user_metadata?.phone || profile.contact_number || null,
        role_at_request: profile.role,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('Support request insert error:', insertError);
      return new Response(JSON.stringify({ error: insertError.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    // The request is saved: a notification problem must never turn this into an
    // error, or the user would resubmit and create a duplicate.
    await notifyAdmins(supabaseAdmin, { id: inserted.id, category: String(category), message: String(message) }, profile)
      .catch((e) => console.error('Support request notification error:', (e as Error)?.message));

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (err) {
    const error = err as Error;
    console.error('Edge function error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});

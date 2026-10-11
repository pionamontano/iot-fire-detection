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

webpush.setVapidDetails(
  'mailto:admin@agapsense.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Only allow service role to call this function (from another Edge Function like trigger-alert)
    // Or allow authenticated users to send test notifications.
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // Verify user is authenticated
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

    // If not called by authenticated user, verify it's the service role
    if (userError || !user) {
        const authHeader = req.headers.get('Authorization');
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (authHeader !== `Bearer ${serviceRoleKey}`) {
             return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
    }

    const { userIds, title, body, icon } = await req.json();

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing or invalid userIds array' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch subscriptions for the given user IDs
    const { data: subscriptions, error: subError } = await supabaseAdmin
      .from('push_subscriptions')
      .select('*')
      .in('user_id', userIds);

    if (subError) {
      throw subError;
    }

    const payload = JSON.stringify({ title, body, icon });
    const sendPromises = subscriptions.map(sub => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };
      return webpush.sendNotification(pushSubscription, payload).catch(err => {
          console.error(`Failed to send push to endpoint ${sub.endpoint}:`, err);
          // Optional: Remove stale subscriptions if err.statusCode === 410 or 404
      });
    });

    await Promise.all(sendPromises);

    return new Response(JSON.stringify({ success: true, sentCount: subscriptions.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

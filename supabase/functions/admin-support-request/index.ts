import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
      .select('full_name, contact_number, role, email')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: 'Failed to fetch user profile' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      return new Response(JSON.stringify({ error: 'Email service configuration missing' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const userRole = profile?.role;
    const userEmail = user?.email || 'No email registered';
    const userPhone = user?.phone || user?.user_metadata?.phone || 'No phone registered';

    const emailPayload: Record<string, unknown> = {
      from: 'AgapSense Support <onboarding@resend.dev>',
      to: ['agapsense@gmail.com'],
      subject: `[Admin Support] ${category} - ${user?.id}`,
      html: `
        <h3>BFP Support Request</h3>
        <p><strong>Category:</strong> ${category}</p>
        <p><strong>User ID:</strong> ${user?.id}</p>
        <p><strong>Role:</strong> ${userRole || 'BFP Responder'}</p>
        <p><strong>Contact Email:</strong> ${userEmail}</p>
        <p><strong>Contact Phone:</strong> ${userPhone}</p>
        <p><strong>Message:</strong></p>
        <p>${message}</p>
      `,
    };

    if (user?.email) {
      emailPayload.reply_to = user.email;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`
      },
      body: JSON.stringify(emailPayload)
    });

    const resData = await res.json();

    if (!res.ok) {
      console.error('Resend API error:', resData);
      return new Response(JSON.stringify({ error: resData }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    return new Response(JSON.stringify({ success: true, data: resData }), {
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

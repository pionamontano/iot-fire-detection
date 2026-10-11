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

    const subject = `[Admin Support] [${profile.role}] - User ID: ${user.id} - ${category}`;

    // We construct HTML for the email
    const htmlBody = `
      <h2>Admin Support Request</h2>
      <p><strong>User ID:</strong> ${user.id}</p>
      <p><strong>Name:</strong> ${profile.full_name || 'N/A'}</p>
      <p><strong>Role:</strong> ${profile.role}</p>
      <p><strong>Email:</strong> ${profile.email || user.email || 'N/A'}</p>
      <p><strong>Contact Number:</strong> ${profile.contact_number || 'N/A'}</p>
      <p><strong>Category:</strong> ${category}</p>
      <hr />
      <h3>Message:</h3>
      <p>${message.replace(/\n/g, '<br />')}</p>
    `;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`
      },
      body: JSON.stringify({
        from: 'onboarding@resend.dev',
        to: 'agapsense@gmail.com',
        subject: subject,
        html: htmlBody
      })
    });

    const resData = await res.json();

    if (!res.ok) {
      console.error('Resend API error:', resData);
      return new Response(JSON.stringify({ error: 'Failed to send email' }), {
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

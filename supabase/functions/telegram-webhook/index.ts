import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const update = await req.json();

    if (update.message && update.message.text && update.message.text.startsWith('/start')) {
      const chatId = update.message.chat.id;
      const textParts = update.message.text.split(' ');

      const userId = textParts.length > 1 ? textParts[1] : null;

      if (userId) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

        if (!supabaseUrl || !supabaseKey) {
            console.error("Missing Supabase environment variables.");
            return new Response("Internal Server Error", { status: 500 });
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

        const { error } = await supabaseAdmin
          .from('profiles')
          .update({ telegram_chat_id: chatId.toString() })
          .eq('id', userId);

        if (error) {
           console.error("Error updating profile:", error);
           return new Response("Database Error", { status: 500 });
        }

        const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
        if (botToken) {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: '✅ Your Telegram account is now successfully linked to AgapSense! You will receive fire alerts here.'
              })
            });
        }
      }
    }
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("Webhook processing error:", err);
    return new Response("Bad Request", { status: 400 });
  }
});

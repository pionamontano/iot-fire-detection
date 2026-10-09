import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const update = await req.json();

    // Ensure it's a message from a user starting with "/start"
    if (update.message && update.message.text && update.message.text.startsWith('/start')) {
      const chatId = update.message.chat.id;
      const textParts = update.message.text.split(' ');

      // The user ID should be the second part of the command (e.g., "/start <uuid>")
      const userId = textParts.length > 1 ? textParts[1] : null;

      if (userId) {
        // Initialize Supabase Admin Client
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

        if (!supabaseUrl || !supabaseKey) {
            console.error("Missing Supabase environment variables.");
            return new Response("Internal Server Error", { status: 500 });
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

        // Update the user's profile with their Telegram chat ID
        const { error } = await supabaseAdmin
          .from('profiles')
          .update({ telegram_chat_id: chatId.toString() })
          .eq('id', userId);

        if (error) {
           console.error("Error updating profile:", error);
           return new Response("Database Error", { status: 500 });
        }

        // Send a success message back to the user via Telegram
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
        } else {
             console.error("Missing TELEGRAM_BOT_TOKEN in environment.");
        }
      }
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("Webhook processing error:", err);
    return new Response("Bad Request", { status: 400 });
  }
});

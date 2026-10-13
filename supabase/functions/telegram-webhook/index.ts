import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TOKEN_RE = /^[0-9a-f]{64}$/;

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

serve(async (req) => {
  // verify_jwt is off (Telegram can't send one), so authenticate the caller via
  // the secret_token registered with setWebhook. Fail closed if it isn't configured.
  const expectedSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
  if (!expectedSecret) {
    console.error("Missing TELEGRAM_WEBHOOK_SECRET.");
    return new Response("Internal Server Error", { status: 500 });
  }
  const providedSecret = req.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
  if (!timingSafeEqual(providedSecret, expectedSecret)) {
    console.error("Rejected update: X-Telegram-Bot-Api-Secret-Token missing or does not match TELEGRAM_WEBHOOK_SECRET (re-run setWebhook with the same secret_token).");
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const update = await req.json();

    if (update.message && update.message.text && update.message.text.startsWith('/start')) {
      const chatId = update.message.chat.id;
      const textParts = update.message.text.split(' ');

      const token = textParts.length > 1 ? textParts[1] : null;

      if (token && TOKEN_RE.test(token)) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

        if (!supabaseUrl || !supabaseKey) {
            console.error("Missing Supabase environment variables.");
            return new Response("Internal Server Error", { status: 500 });
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

        // Consume the one-time token atomically: delete-and-return so it can't be replayed.
        const { data: consumed, error: tokenError } = await supabaseAdmin
          .from('telegram_link_tokens')
          .delete()
          .eq('token', token)
          .gt('expires_at', new Date().toISOString())
          .select('user_id')
          .maybeSingle();

        if (tokenError) {
           console.error("Error consuming link token:", tokenError);
           return new Response("Database Error", { status: 500 });
        }

        const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
        const reply = async (text: string) => {
          if (!botToken) {
            console.error("Missing TELEGRAM_BOT_TOKEN; cannot send reply.");
            return;
          }
          try {
            const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text })
            });
            if (!res.ok) {
              console.error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
            }
          } catch (err) {
            console.error("Telegram sendMessage error:", err);
          }
        };

        if (!consumed) {
          await reply('⚠️ This link is invalid or has expired. Please generate a new one from AgapSense settings.');
          return new Response("OK", { status: 200 });
        }

        const chatIdStr = chatId.toString();

        // D5.5 (issue #95): refuse, don't move, a chat already linked to a DIFFERENT account —
        // moving it silently would redirect that other account's fire alerts without their knowledge.
        const { data: existingOwner } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('telegram_chat_id', chatIdStr)
          .neq('id', consumed.user_id)
          .maybeSingle();

        if (existingOwner) {
          await reply('⚠️ This Telegram chat is already linked to a different AgapSense account. Unlink it there first, then try again.');
          return new Response("OK", { status: 200 });
        }

        const { error } = await supabaseAdmin
          .from('profiles')
          .update({ telegram_chat_id: chatIdStr })
          .eq('id', consumed.user_id);

        if (error) {
           // 23505: the unique index caught a race (two concurrent links to the same chat) that the
           // check above missed — same refusal, not a server error.
           if (error.code === '23505') {
             await reply('⚠️ This Telegram chat is already linked to a different AgapSense account. Unlink it there first, then try again.');
             return new Response("OK", { status: 200 });
           }
           console.error("Error updating profile:", error);
           return new Response("Database Error", { status: 500 });
        }

        await reply('✅ Your Telegram account is now successfully linked to AgapSense! You will receive fire alerts here.');
      }
    }
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("Webhook processing error:", err);
    return new Response("Bad Request", { status: 400 });
  }
});

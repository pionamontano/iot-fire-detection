import { supabase } from './supabase';

const BOT_USERNAME = 'AgapSenseAlertBot';

/**
 * Opens the Telegram deep link with a one-time token. Returns a user-facing
 * error message on failure, or null on success.
 */
export const startTelegramLink = async (): Promise<string | null> => {
  // Open the window synchronously so popup blockers allow it, then point it
  // at the deep link once the one-time token arrives.
  const win = window.open('', '_blank');
  const { data: token, error } = await supabase.rpc('create_telegram_link_token');
  if (error || !token) {
    win?.close();
    console.error(error);
    const status = (error as { status?: number } | null)?.status;
    if (status === 404 || error?.code === 'PGRST202') {
      return 'Telegram linking is not available yet. Please contact your administrator.';
    }
    return 'Could not start Telegram linking. Please try again in a moment.';
  }
  const telegramUrl = `https://t.me/${BOT_USERNAME}?start=${token}`;
  if (win) win.location.href = telegramUrl;
  else window.location.href = telegramUrl;
  return null;
};

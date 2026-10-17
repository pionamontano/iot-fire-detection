import { supabase } from './supabase';

const urlB64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

/** True when running in Brave, which blocks Google's push service by default. */
export const isBraveBrowser = async (): Promise<boolean> => {
  try {
    const brave = (navigator as unknown as { brave?: { isBrave: () => Promise<boolean> } }).brave;
    return !!(brave && (await brave.isBrave()));
  } catch {
    return false;
  }
};

/**
 * True on an iPhone or iPad when AgapSense is open in the browser rather than from
 * the Home Screen. iOS only allows web push for sites added to the Home Screen
 * (iOS 16.4+), so there the way to turn push on is to install the app first.
 */
export const needsHomeScreenInstall = (): boolean => {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPadOS reports itself as a Mac
  if (!isIos) return false;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return !standalone;
};

export const HOME_SCREEN_HINT =
  'On iPhone or iPad: tap Share, then "Add to Home Screen", and open AgapSense from that icon to turn on notifications.';

/** Turns a push subscription failure into a message a user can act on. */
export const describePushError = (e: unknown, isBrave = false): string => {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'AbortError') {
    if (isBrave) {
      return 'Brave blocks push notifications by default. Enable "Use Google services for push messaging" in brave://settings/privacy, then try again.';
    }
    return "Your browser's push service is unavailable. Try Chrome or Edge, check your connection, and make sure browser push services are enabled.";
  }
  if (name === 'NotAllowedError') {
    return 'Notifications are blocked. Allow them in your browser site settings and try again.';
  }
  if (name === 'NotSupportedError') {
    return 'Push notifications are not supported by this browser.';
  }
  return 'Could not enable push notifications. Please try again later.';
};

export const registerServiceWorker = async () => {
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('Service Worker registered with scope:', registration.scope);
      return registration;
    } catch (error) {
      console.error('Service Worker registration failed:', error);
      return null;
    }
  }
  return null;
};

const registerPushUrl = () => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/register-push`;

/**
 * The VAPID public key the server signs pushes with. Fetched from the server so a
 * subscription always matches it: one made with any other key is rejected by the
 * push service (403) on every send. VITE_VAPID_PUBLIC_KEY is only a fallback for a
 * server that can't be reached; there is no built-in key, since a stale one is
 * exactly what made pushes fail silently.
 */
const getVapidPublicKey = async (): Promise<string> => {
  try {
    const res = await fetch(registerPushUrl(), { method: 'GET' });
    if (res.ok) {
      const { publicKey } = await res.json();
      if (typeof publicKey === 'string' && publicKey) return publicKey;
    }
  } catch {
    // fall through to the build-time key
  }
  const fallback = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (fallback) return fallback;
  throw new Error('Push notifications are not configured on the server.');
};

const toBase64Url = (buf: ArrayBuffer | null): string =>
  buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '';

const saveSubscription = async (action: 'subscribe' | 'unsubscribe', subscription: PushSubscription) => {
  const { data: session } = await supabase.auth.getSession();
  if (!session?.session?.access_token) {
    throw new Error('Not signed in.');
  }
  return fetch(registerPushUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.session.access_token}`,
    },
    body: JSON.stringify({ action, subscription: subscription.toJSON() }),
  });
};

export const subscribeUserToPush = async () => {
  if (!('serviceWorker' in navigator && 'PushManager' in window)) {
    throw new Error('Push notifications are not supported by this browser.');
  }

  const registration = await navigator.serviceWorker.ready;
  const publicKey = await getVapidPublicKey();

  // A browser keeps one subscription per site and refuses a new one with a different
  // key, so a subscription made with an old key is dropped (here and on the server) first.
  const existing = await registration.pushManager.getSubscription();
  if (existing && toBase64Url(existing.options.applicationServerKey) !== publicKey) {
    await saveSubscription('unsubscribe', existing).catch(() => {});
    await existing.unsubscribe().catch(() => {});
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8Array(publicKey),
  });

  // Send subscription to backend. The browser-side subscription above can
  // succeed even when this fails, which would otherwise leave the UI
  // reporting "Enabled" for a subscription the backend never saved (and so
  // could never actually deliver to).
  const res = await saveSubscription('subscribe', subscription);
  if (!res.ok) {
    await subscription.unsubscribe().catch(() => {});
    throw new Error('Failed to save push subscription on the server.');
  }

  return subscription;
};

/**
 * Re-subscribes this browser if it is subscribed with a key other than the server's
 * (e.g. after the VAPID keys were changed), so it keeps receiving pushes without the
 * user having to turn notifications off and on. Does nothing when not subscribed,
 * not signed in, or the server key can't be fetched.
 */
export const refreshPushSubscription = async () => {
  try {
    if (!('serviceWorker' in navigator && 'PushManager' in window)) return;
    if (Notification.permission !== 'granted') return;
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session) return;
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (!existing) return;
    const res = await fetch(registerPushUrl(), { method: 'GET' });
    if (!res.ok) return;
    const { publicKey } = await res.json();
    if (typeof publicKey !== 'string' || !publicKey) return;
    if (toBase64Url(existing.options.applicationServerKey) === publicKey) return;
    await subscribeUserToPush();
  } catch (error) {
    console.error('Push subscription refresh failed:', error);
  }
};

export const unsubscribeUserFromPush = async () => {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    await subscription.unsubscribe();

    const { data: session } = await supabase.auth.getSession();
    if (session?.session?.access_token) {
      const res = await saveSubscription('unsubscribe', subscription);
      if (!res.ok) {
        throw new Error('Unsubscribed locally, but the server failed to remove the saved subscription.');
      }
    }
  }
};

export const getPushSubscription = async () => {
  if (!('serviceWorker' in navigator && 'PushManager' in window)) return null;
  const registration = await navigator.serviceWorker.ready;
  return await registration.pushManager.getSubscription();
};

export type PushState = 'on' | 'off' | 'unavailable';

/**
 * Whether this browser is subscribed to push. navigator.serviceWorker.ready never
 * settles when no worker is registered, so give up after a few seconds instead of
 * leaving a "Checking..." label forever.
 */
export const getPushState = async (timeoutMs = 4000): Promise<PushState> => {
  if (!('serviceWorker' in navigator && 'PushManager' in window)) return 'unavailable';
  const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs));
  try {
    const sub = await Promise.race([getPushSubscription(), timeout]);
    if (sub === 'timeout') return 'unavailable';
    return sub ? 'on' : 'off';
  } catch {
    return 'unavailable';
  }
};

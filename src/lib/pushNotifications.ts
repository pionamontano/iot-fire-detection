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

/** Turns a push subscription failure into a message a user can act on. */
export const describePushError = (e: unknown): string => {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'AbortError') {
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

export const subscribeUserToPush = async () => {
  if (!('serviceWorker' in navigator && 'PushManager' in window)) {
    throw new Error('Push notifications are not supported by this browser.');
  }

  const registration = await navigator.serviceWorker.ready;
  const applicationServerKey = urlB64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY || 'BMwN03JKencLsiNuzyH1k2_ZJ09p26jv1CHaUCLQ6e6RYOIO5PmWnKQr4oLN-Puaynwj5iimdLRmREevitKphEc');

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  });

  // Send subscription to backend
  const { data: session } = await supabase.auth.getSession();
  if (session?.session?.access_token) {
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/register-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.session.access_token}`,
      },
      body: JSON.stringify({
        action: 'subscribe',
        subscription: subscription.toJSON(),
      }),
    });
  }

  return subscription;
};

export const unsubscribeUserFromPush = async () => {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    await subscription.unsubscribe();

    const { data: session } = await supabase.auth.getSession();
    if (session?.session?.access_token) {
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/register-push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.session.access_token}`,
        },
        body: JSON.stringify({
          action: 'unsubscribe',
          subscription: subscription.toJSON(),
        }),
      });
    }
  }
};

export const getPushSubscription = async () => {
  if (!('serviceWorker' in navigator && 'PushManager' in window)) return null;
  const registration = await navigator.serviceWorker.ready;
  return await registration.pushManager.getSubscription();
};

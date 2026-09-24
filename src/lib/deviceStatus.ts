// Shared device connectivity status logic (spec SW-2.4.3).
//
// Previously each page (Dashboard, Alerts, ResponderDevices, InteractiveMap)
// computed "is this device online" independently, each with its own flat
// 5-minute cutoff that matched neither spec boundary — and each missing the
// spec's "Reconnecting" middle state entirely. This is the single source of
// truth for all of them.

export type ConnectivityStatus = 'online' | 'reconnecting' | 'offline';

export const ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // < 2 min: Online
export const RECONNECTING_THRESHOLD_MS = 15 * 60 * 1000; // 2–15 min: Reconnecting, >15 min or never: Offline

export const getConnectivityStatus = (
  lastSeenAt: string | null | undefined,
  now: number = Date.now()
): ConnectivityStatus => {
  if (!lastSeenAt) return 'offline';
  const elapsedMs = now - new Date(lastSeenAt).getTime();
  if (elapsedMs < ONLINE_THRESHOLD_MS) return 'online';
  if (elapsedMs < RECONNECTING_THRESHOLD_MS) return 'reconnecting';
  return 'offline';
};

export const formatLastSeen = (
  lastSeenAt: string | null | undefined,
  now: number = Date.now()
): string => {
  if (!lastSeenAt) return 'Never seen';
  const minutes = Math.max(0, Math.round((now - new Date(lastSeenAt).getTime()) / 60000));
  if (minutes < 1) return 'Last seen just now';
  return `Last seen ${minutes} min ago`;
};

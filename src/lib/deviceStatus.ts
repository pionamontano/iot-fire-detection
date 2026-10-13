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

// ─── The one device status vocabulary used everywhere (dashboard, map,
// System Overview, responder map). Tier 2 = dual-sensor confirmed fire;
// Tier 1 = single-sensor warning (spec SW-2.3.1). Connectivity follows the
// 2 / 15 minute thresholds above (spec SW-2.4.3 / FR-ALERT-005). A device an
// admin switched off is Offline, with a "Disabled by admin" note rather than
// a status of its own. Each color means one thing: red fire, amber warning,
// green online, blue connection trouble, grey not reporting.
export type DeviceStatus = 'fire' | 'warning' | 'online' | 'reconnecting' | 'offline';

export const DEVICE_STATUS_ORDER: readonly DeviceStatus[] = ['fire', 'warning', 'online', 'reconnecting', 'offline'];

export const DEVICE_STATUS: Record<DeviceStatus, {
  label: string;
  /** Legend / filter label, with the alert tier where it applies. */
  longLabel: string;
  description: string;
  color: string;
  badgeBg: string;
  badgeText: string;
}> = {
  fire: {
    label: 'Fire', longLabel: 'Fire (Tier 2)', color: '#DC2626',
    description: 'CO and temperature thresholds both exceeded. Immediate response required.',
    badgeBg: 'bg-[#FEE2E2]', badgeText: 'text-[#B91C1C]',
  },
  warning: {
    label: 'Warning', longLabel: 'Warning (Tier 1)', color: '#F59E0B',
    description: 'CO or temperature threshold exceeded. Check the site.',
    badgeBg: 'bg-[#FEF3C7]', badgeText: 'text-[#B45309]',
  },
  online: {
    label: 'Online', longLabel: 'Online', color: '#10B981',
    description: 'Reported in the last 2 minutes. No active alert.',
    badgeBg: 'bg-[#D1FAE5]', badgeText: 'text-[#047857]',
  },
  reconnecting: {
    label: 'Reconnecting', longLabel: 'Reconnecting', color: '#3B82F6',
    description: 'Last report 2–15 minutes ago. Connection may be recovering.',
    badgeBg: 'bg-[#DBEAFE]', badgeText: 'text-[#1D4ED8]',
  },
  offline: {
    label: 'Offline', longLabel: 'Offline', color: '#71717A',
    description: 'No report for over 15 minutes, never connected, or disabled by an admin.',
    badgeBg: 'bg-[#EBE7E7]', badgeText: 'text-[#52525B]',
  },
};

export const getDeviceStatus = (
  device: { id: string; is_active: boolean; last_seen_at: string | null },
  activeAlerts: ReadonlyArray<{ device_id: string; alert_tier: 1 | 2; resolved_at?: string | null }>,
  now: number = Date.now()
): DeviceStatus => {
  const deviceAlerts = activeAlerts.filter(a => a.device_id === device.id && !a.resolved_at);
  if (deviceAlerts.some(a => a.alert_tier === 2)) return 'fire';
  if (deviceAlerts.length > 0) return 'warning';
  if (!device.is_active) return 'offline';
  return getConnectivityStatus(device.last_seen_at, now);
};

/** Secondary line under a status badge: why a device isn't online. */
export const getStatusNote = (
  device: { is_active: boolean; last_seen_at: string | null },
  status: DeviceStatus,
  now: number = Date.now()
): string | null => {
  if (status !== 'reconnecting' && status !== 'offline') return null;
  if (!device.is_active) return 'Disabled by admin';
  return formatLastSeen(device.last_seen_at, now);
};

export const formatLastSeen = (
  lastSeenAt: string | null | undefined,
  now: number = Date.now()
): string => {
  if (!lastSeenAt) return 'Never seen';
  const minutes = Math.max(0, Math.round((now - new Date(lastSeenAt).getTime()) / 60000));
  if (minutes < 1) return 'Last seen just now';
  if (minutes < 60) return `Last seen ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Last seen ${hours} h ago`;
  return `Last seen ${Math.round(hours / 24)} d ago`;
};

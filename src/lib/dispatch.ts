// What the BFP responder portal shows and where it sends a crew.
//
// BFP responders are dispatched on Tier 2 (fire) only: trigger-alert sends them push and Telegram on
// Tier 2, the device SMSes the BFP number on Tier 2, and their pages list Tier 2 incidents only. A Tier 1
// warning (one sensor over its threshold) is checked by the site and the admins first.
import { isValidCoordinate } from './location.ts';  // explicit extension so node --test can load this file

export const DISPATCH_TIER = 2;

export const isDispatchAlert = (alert: { alert_tier: number }): boolean => alert.alert_tier >= DISPATCH_TIER;

export interface NavigationTarget {
  lat: number;
  lng: number;
  /** Short label for where the point comes from. */
  label: string;
  /** True when the crew should expect to look around on arrival (not a live fix or a confirmed pin). */
  approximate: boolean;
}

/**
 * Where to navigate for an alert: the device's GPS fix at the alert, else the last-known position the alert
 * carried, else the install pin registered for the device (confirmed by an admin or not). Null when none is usable.
 */
export const navigationTarget = (
  alert: { latitude: number | null; longitude: number | null; gps_valid: boolean },
  device?: { latitude: number | null; longitude: number | null; location_verified?: boolean | null } | null,
): NavigationTarget | null => {
  if (isValidCoordinate(alert.latitude, alert.longitude)) {
    return alert.gps_valid
      ? { lat: alert.latitude as number, lng: alert.longitude as number, label: 'Live GPS at alert', approximate: false }
      : { lat: alert.latitude as number, lng: alert.longitude as number, label: 'Last-known GPS position', approximate: true };
  }
  if (device && isValidCoordinate(device.latitude, device.longitude)) {
    return device.location_verified
      ? { lat: device.latitude as number, lng: device.longitude as number, label: 'Registered pin, confirmed by admin', approximate: false }
      : { lat: device.latitude as number, lng: device.longitude as number, label: 'Registered pin, not yet confirmed', approximate: true };
  }
  return null;
};

export const directionsUrl = (t: NavigationTarget): string =>
  `https://www.google.com/maps/dir/?api=1&destination=${t.lat},${t.lng}`;

/** "45s" / "12m 05s" / "3h 20m", for how long an incident has been open. */
export const formatElapsed = (fromIso: string, now: number = Date.now()): string => {
  const total = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  if (m < 60) return `${m}m ${String(total % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};

/** Average seconds from trigger to acknowledgement, or null when nothing was acknowledged yet. */
export const averageAckSeconds = (alerts: ReadonlyArray<{ triggered_at: string; acknowledged_at?: string | null }>): number | null => {
  const durations = alerts
    .filter(a => a.acknowledged_at)
    .map(a => (new Date(a.acknowledged_at as string).getTime() - new Date(a.triggered_at).getTime()) / 1000)
    .filter(s => Number.isFinite(s) && s >= 0);
  return durations.length ? durations.reduce((sum, s) => sum + s, 0) / durations.length : null;
};

export const formatDuration = (seconds: number): string => {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

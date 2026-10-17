// Shared wording for alert events, so the Dashboard's Recent Activity and the
// Live Map's alert feed describe the same event the same way.

type AlertLike = {
  alert_tier: 1 | 2;
  triggered_at: string;
  resolved_at?: string | null;
  resolution_source?: string | null;
};

const RESOLVED_BY: Record<string, string> = {
  device: 'Auto-cleared by device',
  responder: 'Resolved by responder',
  admin: 'Resolved by admin',
  resident: 'Resolved by resident',
};

/** "Fire alert triggered" / "Warning resolved" etc. */
export const alertTitle = (alert: AlertLike): string =>
  `${alert.alert_tier === 2 ? 'Fire alert' : 'Warning'} ${alert.resolved_at ? 'resolved' : 'triggered'}`;

/** Who or what produced the event: "Tier 2 · Automated" / "Auto-cleared by device". */
export const alertActor = (alert: AlertLike): string =>
  alert.resolved_at
    ? RESOLVED_BY[alert.resolution_source ?? ''] ?? 'Resolved'
    : `Tier ${alert.alert_tier} · Automated`;

/** When the event in the title happened: resolution time if resolved, else trigger time. */
export const alertEventAt = (alert: AlertLike): string =>
  alert.resolved_at ?? alert.triggered_at;

// "Today, 6:33 PM" / "Yesterday, 10:43 PM" / "Oct 3, 10:28 PM". Time alone
// made entries from different days look out of order, and relative ages
// ("59 min ago") on one page next to clock times on another read as two
// different events.
export const formatEventTime = (iso: string, now: number = Date.now()): string => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dayDiff = Math.floor((startOfToday.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (dayDiff <= 0) return `Today, ${time}`;
  if (dayDiff === 1) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
};

/**
 * One status word for an alert row, the same on the Dashboard and Alert History:
 * open alerts show how far responders have got, closed ones how they ended.
 */
export const alertStatus = (alert: {
  resolved_at?: string | null;
  incident_status?: string | null;
}): { label: string; open: boolean } => {
  if (alert.incident_status === 'false_alarm') return { label: 'False alarm', open: false };
  if (alert.resolved_at) return { label: 'Resolved', open: false };
  if (alert.incident_status === 'responding') return { label: 'Responding', open: true };
  if (alert.incident_status === 'acknowledged') return { label: 'Acknowledged', open: true };
  return { label: 'Active', open: true };
};

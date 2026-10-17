// System Log: turns rows from the tables the admin can read into one
// chronological list. Pure functions only, so the page stays thin and the
// wording / severity rules are unit-tested (tests/system-log.test.ts).

export type LogCategory = 'alert' | 'login' | 'device' | 'account' | 'support' | 'firmware';
export type LogSeverity = 'critical' | 'warning' | 'success' | 'info';

export interface LogEntry {
  id: string;
  timestamp: string;
  category: LogCategory;
  /** Short event name shown in the Event column, e.g. "Sign-in failed". */
  event: string;
  actor: string;
  details: string;
  severity: LogSeverity;
  /** Still needs someone: an unresolved alert, a pending account request or an open support request. */
  open?: boolean;
}

export const CATEGORY_LABEL: Record<LogCategory, string> = {
  alert: 'Alerts',
  login: 'Sign-ins',
  device: 'Devices',
  account: 'Accounts',
  support: 'Support',
  firmware: 'Firmware',
};

export const SEVERITY_LABEL: Record<LogSeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  success: 'Done',
  info: 'Info',
};

/** How many rows are read from each source table per load. */
export const LOG_SOURCE_LIMIT = 200;

// Loose row shapes: only the columns this file reads.
export interface AlertRow {
  id: string;
  alert_tier: number;
  co_ppm: number;
  temp_celsius: number;
  triggered_at: string;
  resolved_at: string | null;
  resolution_source?: string | null;
  devices?: { device_code?: string | null; location_desc?: string | null } | null;
}
export interface LoginRow { id: string; email: string; ip_address: string | null; success: boolean; attempted_at: string }
export interface DeviceRow { id: string; device_code: string; label?: string | null; location_desc: string | null; created_at: string }
export interface RegistrationRow {
  id: string;
  email: string;
  requested_role: string;
  device_code: string | null;
  created_at: string;
  reviewed_at: string | null;
  profile?: { full_name?: string | null; status?: string | null } | null;
}
export interface SupportRow {
  id: string;
  category: string;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  profile?: { full_name?: string | null } | null;
}
export interface FirmwareRow { id: string; version: string; notes: string | null; created_at: string }

export interface LogSources {
  alerts?: AlertRow[] | null;
  logins?: LoginRow[] | null;
  devices?: DeviceRow[] | null;
  registrations?: RegistrationRow[] | null;
  support?: SupportRow[] | null;
  firmware?: FirmwareRow[] | null;
}

const ROLE_LABEL: Record<string, string> = { resident: 'Resident', bfp_responder: 'BFP Responder' };

// The IP is only mentioned when one was actually recorded; "[Unknown]" on
// every row was noise.
const fromIp = (ip: string | null) => (ip ? ` from ${ip}` : '');

export function buildLogEntries(src: LogSources): LogEntry[] {
  const out: LogEntry[] = [];

  // Describe only what the data shows: the units measure CO and temperature
  // (no smoke sensor), and nothing triggers suppression.
  src.alerts?.forEach(a => {
    const code = a.devices?.device_code || 'Unknown device';
    const where = a.devices?.location_desc || 'an unknown location';
    const tier2 = a.alert_tier === 2;
    out.push({
      id: `alert-${a.id}`,
      timestamp: a.triggered_at,
      category: 'alert',
      event: tier2 ? 'Tier 2 fire alert' : 'Tier 1 warning',
      actor: code,
      details: `${tier2 ? 'CO and temperature' : 'CO or temperature'} over threshold at ${where} (CO ${a.co_ppm} ppm, ${a.temp_celsius}°C).${a.resolved_at ? '' : ' Still open.'}`,
      severity: tier2 ? 'critical' : 'warning',
      open: !a.resolved_at,
    });
    if (a.resolved_at) {
      const auto = a.resolution_source === 'device';
      out.push({
        id: `alert-res-${a.id}`,
        timestamp: a.resolved_at,
        category: 'alert',
        event: auto ? 'Alert auto-cleared' : 'Alert resolved',
        actor: auto ? code
          : a.resolution_source === 'responder' ? 'BFP Responder'
          : a.resolution_source === 'admin' ? 'Admin'
          : a.resolution_source === 'resident' ? 'Resident'
          : 'System',
        details: auto
          ? `Readings at ${where} dropped back below thresholds.`
          : `Incident at ${where} marked as resolved.`,
        severity: 'success',
      });
    }
  });

  src.logins?.forEach(l => {
    out.push({
      id: `login-${l.id}`,
      timestamp: l.attempted_at,
      category: 'login',
      event: l.success ? 'Signed in' : 'Sign-in failed',
      actor: l.email,
      details: l.success ? `Signed in successfully${fromIp(l.ip_address)}.` : `Wrong credentials${fromIp(l.ip_address)}. Repeated failures lock the account.`,
      severity: l.success ? 'info' : 'warning',
    });
  });

  src.devices?.forEach(d => {
    out.push({
      id: `device-${d.id}`,
      timestamp: d.created_at,
      category: 'device',
      event: 'Device registered',
      actor: 'Admin',
      details: `${d.device_code}${d.label ? ` (${d.label})` : ''} added${d.location_desc ? ` at ${d.location_desc}` : '; install location not set yet'}.`,
      severity: 'info',
    });
  });

  src.registrations?.forEach(r => {
    const name = r.profile?.full_name || r.email;
    const role = ROLE_LABEL[r.requested_role] ?? r.requested_role;
    out.push({
      id: `reg-${r.id}`,
      timestamp: r.created_at,
      category: 'account',
      event: 'Account requested',
      actor: r.email,
      details: `${name} asked for a ${role} account${r.device_code ? ` for device ${r.device_code}` : ''}.${r.profile?.status === 'pending' ? ' Awaiting review.' : ''}`,
      severity: 'info',
      open: r.profile?.status === 'pending',
    });
    const status = r.profile?.status;
    if (r.reviewed_at && (status === 'approved' || status === 'rejected')) {
      out.push({
        id: `reg-rev-${r.id}`,
        timestamp: r.reviewed_at,
        category: 'account',
        event: status === 'approved' ? 'Account approved' : 'Account rejected',
        actor: 'Admin',
        details: `${role} account for ${name} ${status}.`,
        severity: status === 'approved' ? 'success' : 'warning',
      });
    }
  });

  src.support?.forEach(s => {
    const name = s.profile?.full_name || 'A user';
    out.push({
      id: `support-${s.id}`,
      timestamp: s.created_at,
      category: 'support',
      event: 'Support request',
      actor: name,
      details: `New "${s.category}" request${s.status === 'open' ? ', awaiting reply' : ''}.`,
      severity: 'info',
      open: s.status === 'open',
    });
    if (s.status === 'resolved' && s.reviewed_at) {
      out.push({
        id: `support-res-${s.id}`,
        timestamp: s.reviewed_at,
        category: 'support',
        event: 'Request resolved',
        actor: 'Admin',
        details: `"${s.category}" request from ${name} resolved.`,
        severity: 'success',
      });
    }
  });

  src.firmware?.forEach(f => {
    out.push({
      id: `fw-${f.id}`,
      timestamp: f.created_at,
      category: 'firmware',
      event: 'Firmware published',
      actor: 'Admin',
      details: `Version ${f.version} released${f.notes ? `: ${f.notes}` : '.'}`,
      severity: 'info',
    });
  });

  return out.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/** "just now", "5m ago", "3h ago", "2d ago"; full dates beyond a week. */
export function relativeTime(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return '';
}

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

/** CSV with every field quoted and escaped (actor names and emails included). */
export function toCsv(entries: LogEntry[]): string {
  const header = ['Timestamp (UTC)', 'Category', 'Event', 'Actor', 'Details', 'Severity'];
  const rows = entries.map(e => [
    new Date(e.timestamp).toISOString(),
    CATEGORY_LABEL[e.category],
    e.event,
    e.actor,
    e.details,
    SEVERITY_LABEL[e.severity],
  ]);
  return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
}

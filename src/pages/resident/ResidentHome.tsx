import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { Device, AlertEvent, SensorReading } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  Wifi, WifiOff, MapPin, Zap, RefreshCw, Cpu, Loader2, Flame, ThermometerSun,
  AlertTriangle, ArrowRight, FileText, Gauge, ShieldCheck, Power,
  Send, BellRing, Phone, Check, Wind, Thermometer,
} from 'lucide-react';
import { ResidentHomeSkeleton } from '../../components/SkeletonLoaders';
import { BTN_SECONDARY, PILL_OK, PILL_WARN, PILL_OFF } from '../../components/ui';
import { PageHeader } from '../../components/PageHeader';
import { TABLE_CARD, TABLE_TOOLBAR, TABLE, THEAD_ROW, TH, TR, TD, TableScroll, TableEmpty } from '../../components/Table';
import { resolveDeviceLocation, displayAddress, isValidCoordinate } from '../../lib/location';
import { DEVICE_STATUS, getConnectivityStatus, getDeviceStatus, formatAgo } from '../../lib/deviceStatus';
import type { DeviceStatus } from '../../lib/deviceStatus';
import { formatEventTime } from '../../lib/alertText';
import { getPushState } from '../../lib/pushNotifications';
import type { PushState } from '../../lib/pushNotifications';
import { LocationBadge } from '../../components/LocationBadge';
import { AlertStatusPill } from '../../components/StatusBadge';
import { EMERGENCY_CONTACTS, telHref } from '../../lib/emergencyContacts';
import { RESIDENT_RESOLVE_CONFIRM, residentResolveWarning } from '../../lib/incidents';

// The resident's home page, in the order a resident asks: is my home OK right
// now (status panel), what is the device measuring (readings), will I be told
// if something happens (notifications), and what happened before (alerts).
// Connectivity uses the shared 2 / 15 minute rule (lib/deviceStatus) like every
// other page, and readings from a device that stopped reporting are labelled as
// old, never as live.

// Rows shown in Recent Alerts; the full list lives on Alert History.
const RECENT_ALERT_ROWS = 5;
// Window for the "alerts" count in the status panel.
const ALERT_COUNT_DAYS = 7;

// One card / heading style for every section on this page.
const CARD = 'bg-white rounded-lg border border-border p-5 sm:p-6';
const CARD_TITLE = 'text-lg font-bold tracking-[-0.01em] text-text';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const AddressField = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <label className="flex flex-col gap-1">
    <span className="text-tier1-text text-[10px] font-bold tracking-wider uppercase">{label}</span>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-white border border-amber-light/50 rounded px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber"
    />
  </label>
);


const SectionHeader = ({ title, meta, action }: { title: string; meta?: React.ReactNode; action?: React.ReactNode }) => (
  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
    <div className="flex flex-col gap-0.5 min-w-0">
      <h2 className={CARD_TITLE}>{title}</h2>
      {meta && <p className="text-xs text-text-subtle">{meta}</p>}
    </div>
    {action}
  </div>
);

const SectionLink = ({ to, children }: { to: string; children: React.ReactNode }) => (
  <Link to={to} className="inline-flex items-center gap-1 text-primary-dark font-bold text-xs hover:underline whitespace-nowrap">
    {children} <ArrowRight className="w-3.5 h-3.5" />
  </Link>
);

// Responder progress on an open fire alert, from the incident fields responders update.
// Tier 1 warnings never go to responders, so they show none of this.
const INCIDENT_STEP: Record<string, string> = {
  active: 'Waiting for a responder',
  acknowledged: 'A responder has acknowledged',
  responding: 'Responders are on the way',
};

// The one panel that answers "is my home OK?". Colors follow the shared
// device-status vocabulary: red fire, amber warning, green online, blue
// reconnecting, grey offline, near-black disabled.
const HERO_STYLE: Record<DeviceStatus, { box: string; icon: string; title: string }> = {
  fire: { box: 'bg-tier2-bg border-tier2-border/40', icon: 'bg-primary text-white', title: 'text-tier2-text' },
  warning: { box: 'bg-tier1-bg border-amber-light/50', icon: 'bg-amber-light text-white', title: 'text-tier1-text' },
  online: { box: 'bg-white border-border', icon: `${DEVICE_STATUS.online.badgeBg} ${DEVICE_STATUS.online.badgeText}`, title: 'text-text' },
  reconnecting: { box: 'bg-white border-border', icon: `${DEVICE_STATUS.reconnecting.badgeBg} ${DEVICE_STATUS.reconnecting.badgeText}`, title: 'text-text' },
  offline: { box: 'bg-surface-alt border-border', icon: `${DEVICE_STATUS.offline.badgeBg} ${DEVICE_STATUS.offline.badgeText}`, title: 'text-text' },
  disabled: { box: 'bg-surface-alt border-border', icon: 'bg-text text-white', title: 'text-text' },
};

const StatusHero = ({ status, icon: Icon, title, children, action, facts }: {
  status: DeviceStatus;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  facts: { label: string; value: string; sub?: string }[];
}) => {
  const style = HERO_STYLE[status];
  const urgent = status === 'fire' || status === 'warning';
  return (
    <section
      role={urgent ? 'alert' : 'status'}
      aria-label="Device status"
      className={`rounded-lg border shadow-[0_1px_2px_rgba(0,0,0,0.04)] flex flex-col ${style.box}`}
    >
      <div className="flex-1 min-w-0 p-5 sm:p-6 flex gap-4">
        <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center shrink-0 ${style.icon} ${status === 'fire' ? 'animate-pulse' : ''}`}>
          <Icon className="w-6 h-6 sm:w-7 sm:h-7" />
        </div>
        <div className="min-w-0 flex flex-col gap-2">
          <h2 className={`text-2xl sm:text-[28px] sm:leading-8 font-extrabold tracking-[-0.02em] ${style.title}`}>{title}</h2>
          <div className="text-sm text-text-body leading-relaxed flex flex-col gap-2">{children}</div>
          {action && <div className="pt-1">{action}</div>}
        </div>
      </div>
      <dl className={`grid grid-cols-3 border-t ${urgent ? 'border-black/10' : 'border-border'}`}>
        {facts.map((f, i) => (
          <div key={f.label} className={`px-4 sm:px-6 py-3 flex flex-col justify-center min-w-0 ${i > 0 ? `border-l ${urgent ? 'border-black/10' : 'border-border'}` : ''}`}>
            <dt className="text-[10px] font-bold tracking-[0.1em] uppercase text-text-body">{f.label}</dt>
            <dd className="text-base sm:text-lg font-extrabold text-text truncate">{f.value}</dd>
            {f.sub && <dd className="text-[11px] text-text-subtle truncate">{f.sub}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
};

// One reading against its alert level. Doubles as the chart toggle: pressing it
// shows that reading's history below. `stale` greys it out when the device has
// stopped reporting, so an old value never reads as current.
const MetricTile = ({ label, icon: Icon, value, unit, max, threshold, stale, warmingUp, selected, onSelect }: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  unit: string;
  max: number;
  threshold: number;
  stale: boolean;
  warmingUp: boolean;
  selected: boolean;
  onSelect: () => void;
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  const thresholdPercentage = Math.min(100, Math.max(0, (threshold / max) * 100));
  const over = !warmingUp && value >= threshold;
  const fill = stale ? 'bg-border' : over ? 'bg-primary' : 'bg-teal-light';
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`text-left rounded-lg border p-4 flex flex-col gap-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        selected ? 'border-primary/40 bg-surface ring-1 ring-primary/20' : 'border-border bg-white hover:border-text-faint'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.1em] uppercase text-text-body">
          <Icon className="w-3.5 h-3.5" />{label}
        </span>
        {over && !stale && <span className="text-[10px] font-bold uppercase tracking-wide text-primary">Over alert level</span>}
      </div>
      {warmingUp ? (
        <div className="flex items-center gap-2 h-10 text-sm font-semibold text-text-body">
          <Loader2 className="w-4 h-4 animate-spin text-teal-light" /> Warming up
        </div>
      ) : (
        <div className="flex items-baseline gap-1">
          <span className={`text-[36px] leading-10 font-extrabold tracking-[-0.04em] tabular-nums ${stale ? 'text-text-faint' : over ? 'text-primary' : 'text-text'}`}>
            {value.toFixed(1)}
          </span>
          <span className={`text-sm font-bold ${stale ? 'text-text-faint' : 'text-text-body'}`}>{unit}</span>
        </div>
      )}
      <div>
        <div className="relative h-2 bg-surface-alt rounded-full overflow-hidden">
          {!warmingUp && <div className={`absolute left-0 top-0 bottom-0 rounded-full transition-all duration-700 ${fill}`} style={{ width: `${percentage}%` }} />}
          <div className="absolute top-0 bottom-0 w-0.5 bg-primary z-10" style={{ left: `${thresholdPercentage}%` }} />
        </div>
        <div className="flex justify-between text-[10px] font-semibold text-text-faint tabular-nums mt-1.5">
          <span>0</span>
          <span className="text-primary">Alert at {threshold} {unit}</span>
          <span>{max}</span>
        </div>
      </div>
    </button>
  );
};

// A label / value row with a status pill (Device Health, Notifications).
type Tone = 'ok' | 'warn' | 'none';
const TONE_PILL: Record<Tone, string> = { ok: PILL_OK, warn: PILL_WARN, none: PILL_OFF };
const TONE_ICON: Record<Tone, string> = { ok: 'text-success-dark', warn: 'text-[#B45309]', none: 'text-text-faint' };

const StatusRow = ({ icon: Icon, label, detail, status, tone }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  detail?: string;
  status: string;
  tone: Tone;
}) => (
  <li className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
    <div className="flex items-center gap-3 min-w-0">
      <Icon size={16} className={`shrink-0 ${TONE_ICON[tone]}`} />
      <div className="min-w-0">
        <span className="block text-sm font-bold text-text">{label}</span>
        {detail && <span className="block text-[11px] text-text-subtle truncate">{detail}</span>}
      </div>
    </div>
    <span className={`${TONE_PILL[tone]} shrink-0`}>{status}</span>
  </li>
);

type Metric = 'temp' | 'co';

// Bar chart of the last readings for one metric, with the alert threshold as
// a dashed line and bars over it in red. Hover/focus a bar for its value.
const ReadingHistoryChart = ({ readings, metric, threshold, now }: {
  readings: SensorReading[]; // oldest first
  metric: Metric;
  threshold: number;
  now: number;
}) => {
  const [hover, setHover] = useState<number | null>(null);
  const unit = metric === 'temp' ? '°C' : 'ppm';
  const valueOf = (r: SensorReading) => (metric === 'temp' ? r.temp_celsius : r.co_ppm) ?? 0;
  const values = readings.map(valueOf);
  // Keep the threshold in view with some headroom, rounded to a clean step.
  const step = metric === 'temp' ? 10 : 100;
  const top = Math.ceil((Math.max(threshold * 1.2, ...values) || step) / step) * step;
  const pct = (v: number) => Math.min(100, Math.max(0, (v / top) * 100));
  const hovered = hover !== null ? readings[hover] : null;

  return (
    <div>
      <div className="flex gap-2">
        {/* Y axis */}
        <div className="relative w-10 h-44 shrink-0 text-[10px] font-semibold text-text-faint tabular-nums text-right">
          <span className="absolute right-0 top-0 -translate-y-1/2">{top}</span>
          {Math.abs(pct(threshold) - 50) > 12 && <span className="absolute right-0 top-1/2 -translate-y-1/2">{top / 2}</span>}
          <span className="absolute right-0 bottom-0 translate-y-1/2">0</span>
          {/* Alert level sits in the axis gutter, so bars over it never hide the label */}
          <span className="absolute right-0 translate-y-1/2 font-bold text-primary" style={{ bottom: `${pct(threshold)}%` }}>{threshold}</span>
        </div>
        {/* Plot */}
        <div className="relative flex-1 h-44 border-b border-border" onMouseLeave={() => setHover(null)}>
          <div className="absolute inset-x-0 top-0 border-t border-border-warm" />
          <div className="absolute inset-x-0 top-1/2 border-t border-border-warm" />
          <div className="absolute inset-x-0 border-t-2 border-dashed border-primary/70 z-10 pointer-events-none" style={{ bottom: `${pct(threshold)}%` }} />
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {readings.map((r, i) => {
              const v = values[i];
              const over = v >= threshold;
              return (
                <div
                  key={r.id ?? i}
                  tabIndex={0}
                  aria-label={`${v.toFixed(1)} ${unit} at ${formatEventTime(r.recorded_at, now)}`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="relative flex-1 h-full flex items-end focus:outline-none group"
                >
                  <div
                    className={`w-full rounded-t transition-all duration-300 ${over ? 'bg-primary' : 'bg-teal-light'} ${hover !== null && hover !== i ? 'opacity-40' : ''} group-focus-visible:ring-2 group-focus-visible:ring-primary/40`}
                    style={{ height: `${Math.max(1.5, pct(v))}%` }}
                  />
                </div>
              );
            })}
          </div>
          {hovered && hover !== null && (
            <div
              className="absolute z-20 -top-2 -translate-y-full -translate-x-1/2 bg-text text-white rounded px-2 py-1 text-[11px] whitespace-nowrap pointer-events-none shadow"
              style={{ left: `${((hover + 0.5) / readings.length) * 100}%` }}
            >
              <span className="font-bold tabular-nums">{values[hover].toFixed(1)} {unit}</span>
              <span className="text-white/70"> · {formatEventTime(hovered.recorded_at, now)}</span>
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-between text-[10px] font-semibold text-text-faint mt-2 pl-12">
        <span>{formatEventTime(readings[0].recorded_at, now)}</span>
        <span>{formatEventTime(readings[readings.length - 1].recorded_at, now)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] font-medium text-text-body mt-4 pl-12 [&>span]:whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-teal-light" />Below alert level</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-primary" />At or above</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-primary" />Alert level ({threshold} {unit})</span>
      </div>
    </div>
  );
};


export const ResidentHome = () => {
  const { profile } = useAuth();
  const [device, setDevice] = useState<Device | null>(null);
  const [latestReading, setLatestReading] = useState<SensorReading | null>(null);
  const [recentReadings, setRecentReadings] = useState<SensorReading[]>([]);
  // Newest alerts for the table, plus every open one (an alert can stay open
  // longer than the newest few rows, and must still count as active).
  const [recentAlerts, setRecentAlerts] = useState<AlertEvent[]>([]);
  const [openAlerts, setOpenAlerts] = useState<AlertEvent[]>([]);
  const [alertsInWindow, setAlertsInWindow] = useState(0);
  const [pushState, setPushState] = useState<PushState | 'checking'>('checking');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [metric, setMetric] = useState<Metric>('temp');
  // Ticks so relative times ("2 min ago") and online/offline stay current between fetches.
  const [now, setNow] = useState(() => Date.now());
  const [discrepancy, setDiscrepancy] = useState<any>(null);
  // Philippine address form shown on the discrepancy banner - pre-filled from the
  // GPS-derived parts, smallest unit to largest, and editable before approval.
  const [addressForm, setAddressForm] = useState({
    houseNo: '', street: '', subdivision: '', barangay: '', cityMunicipality: '', province: '',
  });

  // Device linking state
  const [linkCode, setLinkCode] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Resolving an open Tier 1 warning from the status panel
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const fetchData = useCallback(async (deviceId: string) => {
    try {
      const windowStart = new Date(Date.now() - ALERT_COUNT_DAYS * 86_400_000);
      const [deviceRes, historyRes, recentRes, openRes, countRes, discrepancyRes] = await Promise.all([
        supabase.from('devices_safe').select('*').eq('id', deviceId).single(),
        supabase.from('sensor_readings').select('*').eq('device_id', deviceId).order('recorded_at', { ascending: false }).limit(24),
        supabase.from('alert_events').select('*').eq('device_id', deviceId).order('triggered_at', { ascending: false }).limit(RECENT_ALERT_ROWS),
        supabase.from('alert_events').select('*').eq('device_id', deviceId).is('resolved_at', null).order('triggered_at', { ascending: false }),
        supabase.from('alert_events').select('id', { count: 'exact', head: true }).eq('device_id', deviceId).gte('triggered_at', windowStart.toISOString()),
        supabase.from('address_discrepancies').select('*').eq('device_id', deviceId).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle()
      ]);

      if (deviceRes.data) setDevice(deviceRes.data);
      if (historyRes.data) {
        setRecentReadings(historyRes.data);
        setLatestReading(historyRes.data[0] ?? null);
      }
      if (recentRes.data) setRecentAlerts(recentRes.data);
      if (openRes.data) setOpenAlerts(openRes.data);
      if (countRes.count !== null) setAlertsInWindow(countRes.count);
      setDiscrepancy(discrepancyRes.data ?? null);
      setLastRefreshed(new Date());
      setNow(Date.now());
    } catch (error) {
      console.error("Error fetching device data", error);
    }
  }, []);

  useEffect(() => {
    getPushState().then(setPushState);
  }, []);

  useEffect(() => {
    if (profile?.device_id) {
      // Only set loading true if we haven't loaded a device yet
      if (!device) setLoading(true);
      fetchData(profile.device_id).finally(() => setLoading(false));
    } else if (profile) {
      setLoading(false);
    }
  }, [profile?.device_id, fetchData]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!profile?.device_id) return;
    const interval = setInterval(() => fetchData(profile.device_id!), 30000);
    return () => clearInterval(interval);
  }, [profile, fetchData]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(tick);
  }, []);

  // Realtime: new readings append; any alert change (new, escalated, resolved) refetches.
  useEffect(() => {
    if (!profile?.device_id) return;
    const deviceId = profile.device_id;
    const channel = supabase
      .channel('resident-readings')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sensor_readings', filter: `device_id=eq.${deviceId}` }, (payload) => {
        const newReading = payload.new as SensorReading;
        setLatestReading(newReading);
        setRecentReadings(prev => [newReading, ...prev].slice(0, 24));
        setLastRefreshed(new Date());
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alert_events', filter: `device_id=eq.${deviceId}` }, () => {
        fetchData(deviceId);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'address_discrepancies', filter: `device_id=eq.${deviceId}` }, (payload) => {
        setDiscrepancy(payload.new);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [profile, fetchData]);

  // Pre-fill the editable address form from whatever GPS-derived parts the
  // backend extracted; blank when there's no discrepancy to show.
  useEffect(() => {
    setAddressForm({
      houseNo: discrepancy?.gps_house_no || '',
      street: discrepancy?.gps_street || '',
      subdivision: discrepancy?.gps_subdivision || '',
      barangay: discrepancy?.gps_barangay || '',
      cityMunicipality: discrepancy?.gps_city_municipality || '',
      province: discrepancy?.gps_province || '',
    });
  }, [discrepancy?.id]);

  const handleRefresh = async () => {
    if (!profile?.device_id || refreshing) return;
    setRefreshing(true);
    await fetchData(profile.device_id);
    setRefreshing(false);
  };


  const handleLinkDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkCode.trim()) return;
    setLinkLoading(true);
    setLinkError(null);
    try {
      const { data, error } = await supabase.functions.invoke('link-device', {
        body: { device_code: linkCode.trim() }
      });
      if (error) {
        if (error.context && typeof error.context.json === 'function') {
          try {
            const errData = await error.context.json();
            throw new Error(errData.error || "Failed to link device.");
          } catch {
            // Error body wasn't JSON; fall through to the generic message
          }
        }
        throw new Error(error.message);
      }
      if (data?.error) throw new Error(data.error);

      window.location.reload();
    } catch (err: any) {
      setLinkError(err.message || 'Failed to link device.');
    } finally {
      setLinkLoading(false);
    }
  };

  if (loading) return <ResidentHomeSkeleton />;
  if (!device) {
    return (
      <div className="flex items-center justify-center min-h-[70vh] px-4 font-['Inter',_sans-serif]">
        <div className="bg-white p-8 rounded-xl shadow-sm border border-border max-w-md w-full text-center">
          <div className="w-16 h-16 bg-tier2-bg rounded-full flex items-center justify-center mx-auto mb-6">
            <Cpu className="text-accent w-8 h-8" />
          </div>
          <h2 className="text-2xl font-black text-text mb-2 tracking-tight">Link Your Device</h2>
          <p className="text-text-body text-sm mb-8">
            You don't have a device linked to your account yet. Enter your device code below to get started.
          </p>

          <form onSubmit={handleLinkDevice} className="space-y-4">
            <div>
              <input
                type="text"
                required
                placeholder="e.g. FA-001"
                value={linkCode}
                onChange={(e) => setLinkCode(e.target.value)}
                className="w-full px-4 py-3 bg-surface border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent text-center font-bold text-text tracking-widest uppercase"
              />
            </div>
            {linkError && (
              <div className="p-3 bg-tier2-bg/50 border border-tier2-border/30 rounded-lg text-primary text-sm font-medium">
                {linkError}
              </div>
            )}
            <button
              type="submit"
              disabled={linkLoading || !linkCode.trim()}
              className="w-full bg-primary hover:bg-primary-dark text-white font-bold py-3 px-4 rounded-lg transition-colors flex justify-center items-center disabled:opacity-70"
            >
              {linkLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : 'Link Device'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const connectivity = getConnectivityStatus(device.last_seen_at, now);
  const status = getDeviceStatus(device, openAlerts, now);
  const isOffline = connectivity === 'offline';
  // Readings, sensor, GPS and power only describe the device while it is
  // reporting; once offline they are history, not current state.
  const hasLiveData = !!latestReading && !isOffline;
  const warmingUp = hasLiveData && latestReading?.sensor_ready === false;

  const openFire = openAlerts.find(a => a.alert_tier === 2);
  const openAlert = openFire ?? openAlerts[0];
  const lastReportAgo = device.last_seen_at ? formatAgo(device.last_seen_at, now) : null;

  const secondsSinceRefresh = Math.max(0, Math.floor((now - lastRefreshed.getTime()) / 1000));
  const refreshedLabel = secondsSinceRefresh < 15 ? 'just now' : secondsSinceRefresh < 60 ? `${secondsSinceRefresh}s ago` : `${Math.floor(secondsSinceRefresh / 60)} min ago`;

  const heroFacts = [
    { label: 'Last report', value: lastReportAgo ? capitalize(lastReportAgo) : 'Never', sub: device.last_seen_at ? formatEventTime(device.last_seen_at, now) : undefined },
    { label: `${ALERT_COUNT_DAYS}-day alerts`, value: String(alertsInWindow), sub: openAlerts.length > 0 ? `${openAlerts.length} open` : 'None open' },
    { label: 'Device', value: device.device_code, sub: device.label || undefined },
  ];

  // Responder progress and "BFP notified" for the open fire alert, when there is one.
  const responderLine = openFire && (
    <div className="flex flex-wrap gap-2">
      {openFire.sms_sent_bfp && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 border border-black/10 px-2.5 py-1 text-xs font-bold text-text">
          <Check className="w-3.5 h-3.5 text-success-dark" /> BFP notified by SMS
        </span>
      )}
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 border border-black/10 px-2.5 py-1 text-xs font-bold text-text">
        <ShieldCheck className="w-3.5 h-3.5 text-primary" /> {INCIDENT_STEP[openFire.incident_status ?? 'active'] ?? INCIDENT_STEP.active}
      </span>
    </div>
  );
  const offlineDuringAlert = openAlert && isOffline && (
    <p className="text-xs font-semibold">Your device is also offline (last report {lastReportAgo ?? 'never'}), so these readings may be out of date.</p>
  );

  const handleResolveWarning = async (alertId: string) => {
    if (!window.confirm(RESIDENT_RESOLVE_CONFIRM)) return;
    setResolving(true);
    setResolveError(null);
    const result = await residentResolveWarning(supabase, alertId);
    if (!result.ok) setResolveError(result.message);
    if (result.ok || result.refresh) await fetchData(device.id);
    setResolving(false);
  };

  const hero = (() => {
    switch (status) {
      case 'fire':
        return (
          <StatusHero status={status} icon={Flame} title="Fire alert" facts={heroFacts} action={<SectionLink to="/home/alerts">View alert</SectionLink>}>
            <p>
              Temperature and carbon monoxide are both over their alert levels
              ({openFire!.temp_celsius?.toFixed(1)} °C, {openFire!.co_ppm?.toFixed(0)} ppm, {formatEventTime(openFire!.triggered_at, now)}).
            </p>
            <p className="font-bold text-tier2-text">
              Check your home now. If you see fire or smoke, leave the building and stay at a safe distance until responders arrive.
            </p>
            {responderLine}
            {offlineDuringAlert}
          </StatusHero>
        );
      case 'warning':
        return (
          <StatusHero
            status={status}
            icon={ThermometerSun}
            title="Warning"
            facts={heroFacts}
            action={
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <button type="button" onClick={() => handleResolveWarning(openAlert!.id)} disabled={resolving} className={BTN_SECONDARY}>
                  {resolving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Mark as resolved
                </button>
                <SectionLink to="/home/alerts">View alert</SectionLink>
              </div>
            }
          >
            <p>
              A reading went over its alert level ({openAlert!.temp_celsius?.toFixed(1)} °C, {openAlert!.co_ppm?.toFixed(0)} ppm, {formatEventTime(openAlert!.triggered_at, now)}).
              Check the room for heat, smoke or a gas source.
            </p>
            <p className="text-xs">
              Warnings are not sent to fire responders, so no one else will close this. Once you have checked the room, mark it as resolved; it also clears on its own when readings return to normal.
            </p>
            {resolveError && <p role="alert" className="text-xs font-semibold text-primary">{resolveError}</p>}
            {offlineDuringAlert}
          </StatusHero>
        );
      case 'online':
        return (
          <StatusHero status={status} icon={ShieldCheck} title="All clear" facts={heroFacts}>
            <p>{warmingUp
              ? 'Your device is online. Its carbon monoxide sensor is still warming up; readings appear once it is ready.'
              : 'Your device is reporting and its readings are within your alert levels.'}</p>
          </StatusHero>
        );
      case 'reconnecting':
        return (
          <StatusHero status={status} icon={Wifi} title="Reconnecting" facts={heroFacts}>
            <p>Your device last reported {lastReportAgo}. This usually recovers on its own. If it lasts more than 15 minutes, check its power and Wi-Fi.</p>
          </StatusHero>
        );
      case 'disabled':
        return (
          <StatusHero status={status} icon={Power} title="Device switched off" facts={heroFacts} action={<SectionLink to="/account">Contact your administrator</SectionLink>}>
            <p>{DEVICE_STATUS.disabled.description}</p>
          </StatusHero>
        );
      default:
        return (
          <StatusHero status={status} icon={WifiOff} title={device.last_seen_at ? 'Device offline' : 'Waiting for your device'} facts={heroFacts} action={<SectionLink to="/home/devices">Device information</SectionLink>}>
            <p>
              {device.last_seen_at ? `No report for ${lastReportAgo!.replace(' ago', '')}. ` : 'Your device has not reported yet. '}
              While it is offline, no new readings or fire alerts can reach you or responders. Check that it has power and Wi-Fi.
            </p>
          </StatusHero>
        );
    }
  })();

  const health: { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; status: string; tone: Tone }[] = [
    {
      label: 'Sensors', icon: Gauge,
      status: !hasLiveData ? 'No data' : warmingUp ? 'Warming up' : 'Ready',
      tone: !hasLiveData ? 'none' : warmingUp ? 'warn' : 'ok',
    },
    {
      label: 'GPS', icon: MapPin,
      status: !hasLiveData ? 'No data' : latestReading?.gps_valid ? 'Fixed' : 'Searching',
      tone: !hasLiveData ? 'none' : latestReading?.gps_valid ? 'ok' : 'warn',
    },
    {
      label: 'Power', icon: Zap,
      status: !hasLiveData ? 'No data' : latestReading?.on_battery ? 'On battery' : 'Mains',
      tone: !hasLiveData ? 'none' : latestReading?.on_battery ? 'warn' : 'ok',
    },
  ];

  const historyOldestFirst = [...recentReadings].reverse();

  // Live GPS / last-known GPS / registered install coordinates / unavailable -
  // never an invented position. Newest-first: the realtime reading, then the history window.
  const location = resolveDeviceLocation({
    readings: [latestReading, ...recentReadings],
    device,
  });

  // Mirrors resolve_address_discrepancy()'s composition order (smallest unit to
  // largest) so the optimistic UI update matches what the RPC actually saved.
  const composePhAddress = (form: typeof addressForm) => {
    const houseStreet = `${form.houseNo} ${form.street}`.trim();
    return [houseStreet, form.subdivision, form.barangay, form.cityMunicipality, form.province]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(', ');
  };

  const handleDiscrepancyResolution = async (status: 'approved' | 'rejected') => {
    if (!discrepancy) return;
    try {
      setLoading(true);
      const { error } = await supabase.rpc('resolve_address_discrepancy', {
        p_discrepancy_id: discrepancy.id,
        p_status: status,
        p_house_no: addressForm.houseNo,
        p_street: addressForm.street,
        p_subdivision: addressForm.subdivision,
        p_barangay: addressForm.barangay,
        p_city_municipality: addressForm.cityMunicipality,
        p_province: addressForm.province,
      });
      if (error) throw error;
      if (status === 'approved') {
        setDevice((prev) => prev ? {
          ...prev,
          location_desc: composePhAddress(addressForm),
          latitude: discrepancy.latitude,
          longitude: discrepancy.longitude,
        } : prev);
      }
      setDiscrepancy(null);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        title="Dashboard"
        description="Your home's fire monitoring at a glance."
        actions={<>
          <span className="text-xs text-text-faint hidden sm:inline">Updated {refreshedLabel}</span>
          <button type="button" onClick={handleRefresh} disabled={refreshing} className={BTN_SECONDARY}>
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </>}
      />

      {hero}

      {discrepancy && (
        <div className="bg-tier1-bg border border-amber-light p-4 rounded-lg flex flex-col gap-4">
          <div className="flex gap-3">
            <AlertTriangle className="text-amber mt-0.5 shrink-0" size={20} />
            <div>
              <h4 className="text-tier1-text font-bold text-sm">Location Discrepancy Detected</h4>
              <p className="text-[#B45309] text-xs mt-1">
                The device's GPS indicates it is at <strong className="font-extrabold">{discrepancy.gps_derived_address}</strong>, but its registered location is <strong className="font-extrabold">{discrepancy.registered_address}</strong>. Review and correct the address below, then confirm.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <AddressField label="House/Unit No." value={addressForm.houseNo} onChange={(v) => setAddressForm({ ...addressForm, houseNo: v })} />
            <AddressField label="Street" value={addressForm.street} onChange={(v) => setAddressForm({ ...addressForm, street: v })} />
            <AddressField label="Subdivision" value={addressForm.subdivision} onChange={(v) => setAddressForm({ ...addressForm, subdivision: v })} />
            <AddressField label="Barangay" value={addressForm.barangay} onChange={(v) => setAddressForm({ ...addressForm, barangay: v })} />
            <AddressField label="City/Municipality" value={addressForm.cityMunicipality} onChange={(v) => setAddressForm({ ...addressForm, cityMunicipality: v })} />
            <AddressField label="Province" value={addressForm.province} onChange={(v) => setAddressForm({ ...addressForm, province: v })} />
          </div>

          <div className="flex gap-2 w-full sm:w-auto sm:self-end">
             <button onClick={() => handleDiscrepancyResolution('approved')} className="flex-1 sm:flex-none px-4 py-2 bg-amber hover:bg-[#B45309] text-white text-xs font-bold rounded shadow-sm transition-colors uppercase tracking-wider">Update</button>
             <button onClick={() => handleDiscrepancyResolution('rejected')} className="flex-1 sm:flex-none px-4 py-2 bg-white hover:bg-gray-50 text-tier1-text border border-amber text-xs font-bold rounded shadow-sm transition-colors uppercase tracking-wider">Keep Current</button>
          </div>
        </div>
      )}


      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Main column (2/3) */}
        <div className="lg:col-span-2 flex flex-col gap-6 min-w-0">

          {/* Readings: current values (also the chart toggle) + last 24 readings */}
          <section className={CARD}>
            <SectionHeader
              title={hasLiveData ? 'Readings' : 'Last Readings'}
              meta={latestReading
                ? `Recorded ${formatEventTime(latestReading.recorded_at, now)} (${formatAgo(latestReading.recorded_at, now)})`
                : 'No readings received yet'}
            />

            {!latestReading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-text-faint">
                <Gauge className="w-8 h-8" />
                <span className="text-sm font-medium text-text-body">Your device hasn't sent a reading yet.</span>
              </div>
            ) : (
              <>
                {!hasLiveData && (
                  <p className="mt-4 text-xs font-medium text-text-body bg-surface-alt rounded px-3 py-2">
                    These values are from the device's last report and may not match conditions now.
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
                  <MetricTile
                    label="Temperature" icon={Thermometer}
                    value={latestReading.temp_celsius ?? 0} unit="°C" max={100} threshold={device.temp_threshold}
                    stale={!hasLiveData} warmingUp={false}
                    selected={metric === 'temp'} onSelect={() => setMetric('temp')}
                  />
                  {/* MQ-7 warm-up (spec SW-2.1.1/SW-2.4.5): the CO value is unreliable until sensor_ready. */}
                  <MetricTile
                    label="Carbon Monoxide" icon={Wind}
                    value={latestReading.co_ppm ?? 0} unit="ppm" max={1000} threshold={device.co_threshold}
                    stale={!hasLiveData} warmingUp={warmingUp}
                    selected={metric === 'co'} onSelect={() => setMetric('co')}
                  />
                </div>

                <div className="mt-6 pt-5 border-t border-border-warm">
                  <p className="text-xs font-bold text-text mb-6">
                    {metric === 'temp' ? 'Temperature' : 'Carbon monoxide'}, last {recentReadings.length} readings
                  </p>
                  <ReadingHistoryChart
                    readings={historyOldestFirst}
                    metric={metric}
                    threshold={metric === 'temp' ? device.temp_threshold : device.co_threshold}
                    now={now}
                  />
                </div>
              </>
            )}
          </section>

          {/* Recent alerts */}
          <div className={TABLE_CARD}>
            <div className={TABLE_TOOLBAR}>
              <h2 className={CARD_TITLE}>Recent Alerts</h2>
              <SectionLink to="/home/alerts">View all</SectionLink>
            </div>
            <TableScroll>
              <table className={TABLE}>
                <thead>
                  <tr className={THEAD_ROW}>
                    <th className={TH}>Event</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Triggered</th>
                    <th className={`${TH} !text-right`}>Temp</th>
                    <th className={`${TH} !text-right`}>CO</th>
                  </tr>
                </thead>
                <tbody>
                  {recentAlerts.length === 0 ? (
                    <TableEmpty colSpan={5} icon={<FileText className="w-10 h-10" />}>
                      No alerts yet. Your device hasn't raised any.
                    </TableEmpty>
                  ) : recentAlerts.map(alert => {
                    return (
                      <tr key={alert.id} className={TR}>
                        <td className={TD}>
                          <div className="flex items-center gap-2">
                            {alert.alert_tier === 2
                              ? <Flame className="w-4 h-4 text-primary shrink-0" />
                              : <ThermometerSun className="w-4 h-4 text-amber-light shrink-0" />}
                            <span className="text-sm font-bold text-text whitespace-nowrap">
                              {alert.alert_tier === 2 ? 'Tier 2 Alert' : 'Tier 1 Warning'}
                            </span>
                          </div>
                        </td>
                        <td className={TD}><AlertStatusPill alert={alert} /></td>
                        <td className={`${TD} text-xs text-text-body whitespace-nowrap`}>{formatEventTime(alert.triggered_at, now)}</td>
                        <td className={`${TD} text-right font-mono text-xs font-bold text-text whitespace-nowrap`}>{alert.temp_celsius?.toFixed(1)}°C</td>
                        <td className={`${TD} text-right font-mono text-xs font-bold text-text whitespace-nowrap`}>{alert.co_ppm?.toFixed(0)} ppm</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          </div>

        </div>

        {/* Side column (1/3) */}
        <div className="lg:col-span-1 flex flex-col gap-6 min-w-0">

          {/* Emergency contacts: hidden until a number is set (none during testing) */}
          {EMERGENCY_CONTACTS.length > 0 && (
          <section className={CARD}>
            <SectionHeader title="Emergency Contacts" meta="Tap to call" />
            <ul className="mt-5 flex flex-col divide-y divide-border-warm">
              {EMERGENCY_CONTACTS.map(c => (
                <li key={c.phone} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <span className="block text-sm font-bold text-text">{c.name}</span>
                    {c.detail && <span className="block text-[11px] text-text-subtle">{c.detail}</span>}
                  </div>
                  <a
                    href={telHref(c.phone)}
                    aria-label={`Call ${c.name}, ${c.phone}`}
                    className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-tier2-bg text-primary font-bold text-sm tabular-nums whitespace-nowrap hover:bg-tier2-bg/70 transition-colors"
                  >
                    <Phone className="w-3.5 h-3.5" /> {c.phone}
                  </a>
                </li>
              ))}
            </ul>
          </section>
          )}

          {/* Notifications: will the resident actually be told? */}
          <section className={CARD}>
            <SectionHeader title="Notifications" meta="Where your alerts are sent" />
            <ul className="mt-5 flex flex-col divide-y divide-border-warm">
              <StatusRow
                icon={Phone} label="SMS"
                detail={profile?.contact_number ? `${profile.contact_number} · fire alerts` : 'Add a mobile number for fire alerts'}
                status={profile?.contact_number ? 'Set' : 'Not set'}
                tone={profile?.contact_number ? 'ok' : 'warn'}
              />
              <StatusRow
                icon={Send} label="Telegram"
                status={profile?.telegram_chat_id ? 'Linked' : 'Not linked'}
                tone={profile?.telegram_chat_id ? 'ok' : 'warn'}
              />
              <StatusRow
                icon={BellRing} label="Push" detail="On this browser"
                status={pushState === 'checking' ? 'Checking' : pushState === 'on' ? 'On' : pushState === 'off' ? 'Off' : 'Unavailable'}
                tone={pushState === 'on' ? 'ok' : pushState === 'off' ? 'warn' : 'none'}
              />
            </ul>
            <div className="mt-5 pt-4 border-t border-border-warm">
              <SectionLink to="/home/settings">Alert settings</SectionLink>
            </div>
          </section>

          {/* Device health */}
          <section className={CARD}>
            <SectionHeader
              title="Device Health"
              meta={hasLiveData ? 'From the latest report' : isOffline ? 'Shown once the device reports again' : 'Waiting for the first reading'}
            />
            <ul className="mt-5 flex flex-col divide-y divide-border-warm">
              {health.map(item => (
                <StatusRow key={item.label} icon={item.icon} label={item.label} status={item.status} tone={item.tone} />
              ))}
            </ul>
          </section>

          {/* Install location (the map lives on Device Information) */}
          <section className={CARD}>
            <SectionHeader title="Install Location" />
            {/* No pin here: the card title says what this is, and the badge below already carries one. */}
            <p className="text-sm font-semibold text-text mt-4">{displayAddress(device.location_desc)}</p>
            <LocationBadge location={location} now={now} />
            {!isValidCoordinate(device.latitude, device.longitude) ? (
              <Link
                to="/home/devices"
                className="mt-4 block w-full text-center py-2.5 rounded bg-tier1-bg text-[#B45309] text-[11px] font-bold uppercase tracking-wide hover:bg-[#FDE68A] transition-colors"
              >
                Set your install address and pin
              </Link>
            ) : (
              <div className="mt-4"><SectionLink to="/home/devices">View on map</SectionLink></div>
            )}
          </section>

        </div>
      </div>
    </div>
  );
};

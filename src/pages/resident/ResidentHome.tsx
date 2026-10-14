import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { Device, AlertEvent, SensorReading } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  Wifi, WifiOff, ShieldAlert, BellRing, Clock, MapPin, Signal, Zap,
  RefreshCw, Cpu, Loader2, Flame, ThermometerSun, AlertTriangle, ArrowRight,
  FileText, Gauge,
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { ResidentHomeSkeleton } from '../../components/SkeletonLoaders';
import { PILL_OK, PILL_WARN, PILL_OFF } from '../../components/ui';
import { TABLE_CARD, TABLE_TOOLBAR, TABLE, THEAD_ROW, TH, TR, TD, TableScroll, TableEmpty } from '../../components/Table';
import { resolveDeviceLocation, markerOpacity, displayAddress, isValidCoordinate } from '../../lib/location';
import { DEVICE_STATUS, getConnectivityStatus, formatAgo } from '../../lib/deviceStatus';
import { formatEventTime } from '../../lib/alertText';
import { LocationBadge, LocationUnavailablePanel } from '../../components/LocationBadge';

// The resident's home page: is my device reporting, is anything wrong right
// now, what has it measured, and where is it. Connectivity uses the shared
// 2 / 15 minute rule (lib/deviceStatus) like every other page, and readings
// from a device that stopped reporting are labelled as old, never as live.

const markerIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Rows shown in Recent Alerts; the full list lives on Alert History.
const RECENT_ALERT_ROWS = 5;

// One card / heading style for every section on this page (same as the other resident pages).
const CARD = 'bg-white rounded-lg border border-border p-5 sm:p-6';
const CARD_TITLE = 'text-lg font-black tracking-tight text-text';

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

// Summary tile in the resident palette (same layout as the admin StatCard).
// Red only when `urgent`, so a red "0" never reads as an alarm.
const SummaryCard = ({ label, value, icon: Icon, hint, urgent = false }: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  hint: string;
  urgent?: boolean;
}) => (
  <div className={`rounded-lg border p-4 sm:p-5 flex flex-col gap-2 min-w-0 ${
    urgent ? 'bg-tier2-bg/50 border-tier2-border/30 border-b-4 border-b-primary' : 'bg-white border-border'
  }`}>
    <div className="flex items-start justify-between gap-2">
      <span className={`text-[10px] font-bold tracking-[0.1em] uppercase ${urgent ? 'text-primary' : 'text-text-body'}`}>{label}</span>
      <Icon className={`w-4 h-4 sm:w-5 sm:h-5 shrink-0 ${urgent ? 'text-primary' : 'text-text-faint'}`} />
    </div>
    <span className={`font-black text-[28px] leading-8 sm:text-[36px] sm:leading-10 tracking-tighter ${urgent ? 'text-primary' : 'text-text'}`}>
      {value}
    </span>
    <span className={`text-xs font-medium ${urgent ? 'text-primary' : 'text-text-subtle'}`}>{hint}</span>
  </div>
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

// Full-width notice above the page for things the resident must act on.
const Notice = ({ tone, icon: Icon, title, children, action }: {
  tone: 'fire' | 'warning' | 'offline';
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) => {
  const styles = {
    fire: 'bg-tier2-bg border-primary text-tier2-text',
    warning: 'bg-tier1-bg border-amber-light text-tier1-text',
    offline: 'bg-surface-alt border-text-faint text-text-body',
  }[tone];
  return (
    <div role={tone === 'offline' ? 'status' : 'alert'} className={`border-l-4 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3 ${styles}`}>
      <Icon className="w-5 h-5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm">{title}</p>
        <p className="text-xs mt-0.5 opacity-90">{children}</p>
      </div>
      {action}
    </div>
  );
};

// Current value against its alert threshold. `stale` greys it out when the
// device has stopped reporting, so an old value never reads as current.
const ReadingGauge = ({ label, value, unit, max, threshold, stale }: {
  label: string;
  value: number;
  unit: string;
  max: number;
  threshold: number;
  stale: boolean;
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  const thresholdPercentage = Math.min(100, Math.max(0, (threshold / max) * 100));
  const over = value >= threshold;
  const fill = stale ? 'bg-border' : over ? 'bg-primary' : 'bg-teal-light';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-end gap-3">
        <span className="text-[10px] font-bold tracking-widest uppercase text-text-body">{label}</span>
        <div className="flex items-baseline gap-1">
          <span className={`text-3xl font-black tracking-tighter tabular-nums ${stale ? 'text-text-faint' : over ? 'text-primary' : 'text-text'}`}>
            {value.toFixed(1)}
          </span>
          <span className={`text-sm font-bold ${stale ? 'text-text-faint' : 'text-text-body'}`}>{unit}</span>
        </div>
      </div>
      <div className="relative h-2.5 bg-surface-alt rounded-full overflow-hidden">
        <div className={`absolute left-0 top-0 bottom-0 rounded-full transition-all duration-700 ${fill}`} style={{ width: `${percentage}%` }} />
        <div className="absolute top-0 bottom-0 w-0.5 bg-primary z-10" style={{ left: `${thresholdPercentage}%` }} />
      </div>
      <div className="flex justify-between text-[10px] font-semibold text-text-faint tabular-nums">
        <span>0</span>
        <span className="text-primary">Alert at {threshold} {unit}</span>
        <span>{max} {unit}</span>
      </div>
    </div>
  );
};

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
      <div className="flex items-center gap-4 text-[11px] font-medium text-text-body mt-4 pl-12">
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
  const [alertsToday, setAlertsToday] = useState(0);
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

  const fetchData = useCallback(async (deviceId: string) => {
    try {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const [deviceRes, historyRes, recentRes, openRes, todayRes, discrepancyRes] = await Promise.all([
        supabase.from('devices_safe').select('*').eq('id', deviceId).single(),
        supabase.from('sensor_readings').select('*').eq('device_id', deviceId).order('recorded_at', { ascending: false }).limit(24),
        supabase.from('alert_events').select('*').eq('device_id', deviceId).order('triggered_at', { ascending: false }).limit(RECENT_ALERT_ROWS),
        supabase.from('alert_events').select('*').eq('device_id', deviceId).is('resolved_at', null).order('triggered_at', { ascending: false }),
        supabase.from('alert_events').select('id', { count: 'exact', head: true }).eq('device_id', deviceId).gte('triggered_at', startOfToday.toISOString()),
        supabase.from('address_discrepancies').select('*').eq('device_id', deviceId).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle()
      ]);

      if (deviceRes.data) setDevice(deviceRes.data);
      if (historyRes.data) {
        setRecentReadings(historyRes.data);
        setLatestReading(historyRes.data[0] ?? null);
      }
      if (recentRes.data) setRecentAlerts(recentRes.data);
      if (openRes.data) setOpenAlerts(openRes.data);
      if (todayRes.count !== null) setAlertsToday(todayRes.count);
      setDiscrepancy(discrepancyRes.data ?? null);
      setLastRefreshed(new Date());
      setNow(Date.now());
    } catch (error) {
      console.error("Error fetching device data", error);
    }
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
  const connInfo = DEVICE_STATUS[connectivity];
  const isOffline = connectivity === 'offline';
  // Readings, sensor, GPS and power only describe the device while it is
  // reporting; once offline they are history, not current state.
  const hasLiveData = !!latestReading && !isOffline;
  const warmingUp = hasLiveData && latestReading?.sensor_ready === false;

  const openFire = openAlerts.find(a => a.alert_tier === 2);
  const openWarning = !openFire ? openAlerts.find(a => a.alert_tier === 1) : undefined;

  const lastReportValue = device.last_seen_at ? capitalize(formatAgo(device.last_seen_at, now)) : 'Never';
  const lastReportHint = device.last_seen_at ? formatEventTime(device.last_seen_at, now) : 'No report received yet';

  const secondsSinceRefresh = Math.max(0, Math.floor((now - lastRefreshed.getTime()) / 1000));
  const refreshedLabel = secondsSinceRefresh < 15 ? 'just now' : secondsSinceRefresh < 60 ? `${secondsSinceRefresh}s ago` : `${Math.floor(secondsSinceRefresh / 60)} min ago`;

  // Device health rows, one per thing the device reports about itself.
  type Health = { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; status: string; tone: 'ok' | 'warn' | 'none' };
  const health: Health[] = [
    {
      label: 'Connection', icon: Signal, status: connInfo.label,
      // Grey when offline, like the shared status colors (grey = not reporting).
      tone: connectivity === 'online' ? 'ok' : connectivity === 'reconnecting' ? 'warn' : 'none',
    },
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
  const TONE_PILL = { ok: PILL_OK, warn: PILL_WARN, none: PILL_OFF };
  const TONE_ICON = { ok: 'text-success-dark', warn: 'text-[#B45309]', none: 'text-text-faint' };

  const historyOldestFirst = [...recentReadings].reverse();

  // Where to show the device. Live GPS / last-known GPS / registered install coordinates / unavailable -
  // never an invented position. Re-evaluated on each render (30 s poll), so a fix older than 15 minutes
  // stops being labelled live. Newest-first: the realtime reading, then the recent history window.
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
      {/* Header (same layout as the other resident pages) */}
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 text-primary">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            <span className="text-[10px] font-bold uppercase tracking-[0.1em]">Overview</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-text">Dashboard</h1>
          <p className="text-sm text-text-body mt-1">
            Status and readings from your device <span className="font-bold text-text">{device.device_code}</span>{device.label ? ` (${device.label})` : ''}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-faint hidden sm:inline">Updated {refreshedLabel}</span>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 border border-border bg-surface-card text-text-body text-[10px] font-bold uppercase tracking-widest rounded hover:bg-surface transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* What needs attention right now */}
      {openFire && (
        <Notice
          tone="fire" icon={Flame} title="Fire alert active"
          action={<SectionLink to="/home/alerts">View alert</SectionLink>}
        >
          Your device detected high temperature and carbon monoxide together ({formatEventTime(openFire.triggered_at, now)}). Check your home now.
        </Notice>
      )}
      {openWarning && (
        <Notice
          tone="warning" icon={ThermometerSun} title="Warning active"
          action={<SectionLink to="/home/alerts">View alert</SectionLink>}
        >
          A reading went over its alert level ({formatEventTime(openWarning.triggered_at, now)}): {openWarning.temp_celsius?.toFixed(1)} °C, {openWarning.co_ppm?.toFixed(0)} ppm.
        </Notice>
      )}
      {isOffline && (
        <Notice
          tone="offline" icon={WifiOff}
          title={device.last_seen_at ? `Device offline: ${formatAgo(device.last_seen_at, now).replace(' ago', '')} without a report` : 'Device has never reported'}
          action={<SectionLink to="/home/devices">Device information</SectionLink>}
        >
          While it is offline, no new readings or fire alerts can reach you or responders. Check that the device has power and Wi-Fi.
        </Notice>
      )}

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

      {/* Summary tiles (red only when something is actually wrong) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <SummaryCard
          label="Device Status"
          value={connInfo.label}
          icon={connectivity === 'offline' ? WifiOff : Wifi}
          hint={connectivity === 'online' ? 'Reporting normally' : connectivity === 'reconnecting' ? 'Connection interrupted' : 'Not reporting'}
        />
        <SummaryCard
          label="Active Alerts"
          value={String(openAlerts.length)}
          icon={ShieldAlert}
          urgent={openAlerts.length > 0}
          hint={openFire ? 'Fire alert open' : openWarning ? 'Warning open' : 'Nothing open'}
        />
        <SummaryCard label="Alerts Today" value={String(alertsToday)} icon={BellRing} hint="Since midnight" />
        <SummaryCard label="Last Report" value={lastReportValue} icon={Clock} hint={lastReportHint} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Main column (2/3) */}
        <div className="lg:col-span-2 flex flex-col gap-6 min-w-0">

          {/* Readings */}
          <section className={CARD}>
            <SectionHeader
              title={hasLiveData ? 'Current Readings' : 'Last Reading'}
              meta={latestReading
                ? `Recorded ${formatEventTime(latestReading.recorded_at, now)} (${formatAgo(latestReading.recorded_at, now)})`
                : 'No readings received yet'}
            />

            {!latestReading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-text-faint">
                <Gauge className="w-8 h-8" />
                <span className="text-sm font-medium text-text-body">Your device hasn't sent a reading yet.</span>
              </div>
            ) : warmingUp ? (
              // MQ-7 warm-up window (spec SW-2.1.1/SW-2.4.5): raw values and
              // threshold bars are unreliable/unset until sensor_ready flips
              // true, so show a placeholder instead of misleading numbers.
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                <Loader2 className="w-6 h-6 text-teal-light animate-spin" />
                <span className="text-sm font-bold text-text-body">Sensors warming up</span>
                <span className="text-xs text-text-faint max-w-xs">The carbon monoxide sensor is calibrating. Readings will appear once it is ready.</span>
              </div>
            ) : (
              <>
                {!hasLiveData && (
                  <p className="mt-4 text-xs font-medium text-text-body bg-surface-alt rounded px-3 py-2">
                    These values are from the device's last report and may not match conditions now.
                  </p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 mt-6">
                  <ReadingGauge
                    label="Temperature"
                    value={latestReading.temp_celsius ?? 0}
                    unit="°C"
                    max={100}
                    threshold={device.temp_threshold}
                    stale={!hasLiveData}
                  />
                  <ReadingGauge
                    label="Carbon Monoxide (CO)"
                    value={latestReading.co_ppm ?? 0}
                    unit="ppm"
                    max={1000}
                    threshold={device.co_threshold}
                    stale={!hasLiveData}
                  />
                </div>
              </>
            )}
          </section>

          {/* Reading history */}
          <section className={CARD}>
            <SectionHeader
              title="Reading History"
              meta={recentReadings.length > 0 ? `Last ${recentReadings.length} readings` : undefined}
              action={
                <div role="radiogroup" aria-label="Reading to chart" className="inline-flex rounded-lg border border-border p-0.5 bg-surface-alt">
                  {(['temp', 'co'] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={metric === m}
                      onClick={() => setMetric(m)}
                      className={`px-3 h-7 rounded-md text-xs font-bold transition-colors ${metric === m ? 'bg-white text-text shadow-sm' : 'text-text-subtle hover:text-text'}`}
                    >
                      {m === 'temp' ? 'Temperature' : 'CO'}
                    </button>
                  ))}
                </div>
              }
            />
            <div className="mt-8">
              {historyOldestFirst.length > 0 ? (
                <ReadingHistoryChart
                  readings={historyOldestFirst}
                  metric={metric}
                  threshold={metric === 'temp' ? device.temp_threshold : device.co_threshold}
                  now={now}
                />
              ) : (
                <div className="h-44 flex items-center justify-center text-sm font-medium text-text-faint">
                  No reading history yet
                </div>
              )}
            </div>
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
                  ) : recentAlerts.map(alert => (
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
                      <td className={TD}>
                        <span className={`text-[9px] font-bold px-2 py-1 rounded uppercase ${alert.resolved_at ? 'bg-surface-cream text-text-body' : 'bg-primary text-white'}`}>
                          {alert.resolved_at ? 'Resolved' : 'Active'}
                        </span>
                      </td>
                      <td className={`${TD} text-xs text-text-body whitespace-nowrap`}>{formatEventTime(alert.triggered_at, now)}</td>
                      <td className={`${TD} text-right font-mono text-xs font-bold text-text whitespace-nowrap`}>{alert.temp_celsius?.toFixed(1)}°C</td>
                      <td className={`${TD} text-right font-mono text-xs font-bold text-text whitespace-nowrap`}>{alert.co_ppm?.toFixed(0)} ppm</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </div>

        </div>

        {/* Side column (1/3) */}
        <div className="lg:col-span-1 flex flex-col gap-6 min-w-0">

          {/* Device health */}
          <section className={CARD}>
            <SectionHeader
              title="Device Health"
              meta={hasLiveData ? 'From the latest report' : isOffline ? 'Shown once the device reports again' : 'Waiting for the first reading'}
            />
            <ul className="mt-5 flex flex-col divide-y divide-border-warm">
              {health.map(item => (
                <li key={item.label} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    <item.icon size={16} className={TONE_ICON[item.tone]} />
                    <span className="text-sm font-bold text-text">{item.label}</span>
                  </div>
                  <span className={TONE_PILL[item.tone]}>{item.status}</span>
                </li>
              ))}
            </ul>
            <div className="mt-5 pt-4 border-t border-border-warm">
              <SectionLink to="/home/devices">Device information</SectionLink>
            </div>
          </section>

          {/* Install location */}
          <section className={CARD}>
            <SectionHeader title="Install Location" meta={`Device ${device.device_code}`} />
            <div className="mt-4">
              {location.lat !== null && location.lng !== null ? (
                <div className="h-48 rounded bg-gray-200 overflow-hidden z-0 relative">
                  <MapContainer
                    key={`${location.lat},${location.lng}`}
                    center={[location.lat, location.lng]}
                    zoom={14}
                    style={{ height: '100%', width: '100%' }}
                    zoomControl={false}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <Marker position={[location.lat, location.lng]} icon={markerIcon} opacity={markerOpacity(location.kind)}>
                      <Popup>
                        <strong>{device.device_code}</strong><br />
                        {displayAddress(device.location_desc)}
                      </Popup>
                    </Marker>
                  </MapContainer>
                </div>
              ) : (
                <LocationUnavailablePanel heightClass="h-48" />
              )}
            </div>
            <LocationBadge location={location} now={now} />
            <div className="flex gap-2 items-start mt-4">
              <MapPin size={16} className="text-text-body mt-0.5 shrink-0" />
              <span className="text-sm font-semibold text-text">{displayAddress(device.location_desc)}</span>
            </div>
            {!isValidCoordinate(device.latitude, device.longitude) && (
              <Link
                to="/home/devices"
                className="mt-4 block w-full text-center py-2.5 rounded bg-tier1-bg text-[#B45309] text-[11px] font-bold uppercase tracking-wide hover:bg-[#FDE68A] transition-colors"
              >
                Set your install address and pin
              </Link>
            )}
          </section>

        </div>
      </div>
    </div>
  );
};

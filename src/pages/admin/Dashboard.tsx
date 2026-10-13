import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { DEVICE_COLUMNS } from '../../lib/deviceColumns';
import { LoadErrorBanner } from '../../components/LoadErrorBanner';
import { PageHeader } from '../../components/PageHeader';
import type { LoadErrorInfo } from '../../components/LoadErrorBanner';
import type { AlertEvent } from '../../lib/supabase';
import {
  Users,
  Cpu,
  Activity,
  AlertTriangle,
  BatteryWarning,
  ArrowRight,
  MapPinOff,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { DashboardSkeleton } from '../../components/SkeletonLoaders';
import { getDeviceStatus, getStatusNote, DEVICE_STATUS_ORDER } from '../../lib/deviceStatus';
import type { DeviceStatus } from '../../lib/deviceStatus';
import { StatusBadge, StatusCountPill } from '../../components/StatusBadge';
import { useNowTick } from '../../hooks/useNowTick';
import { DeviceMap, MapLegend } from '../../components/DeviceMap';
import { MAP_READING_COLUMNS, toMapDevices, formatTemp } from '../../lib/mapDevices';
import type { DeviceWithReadings } from '../../lib/mapDevices';
import { alertTitle, alertActor, alertEventAt, formatEventTime } from '../../lib/alertText';

// Plain counts — no zero-padding ("00", "002"), which read as codes.
const formatNumber = (n: number): string => n.toLocaleString();

type RecentAlert = AlertEvent & { devices?: { label: string | null; device_code: string } | null };

const ACTIVITY_LIMIT = 4;
const DEVICE_ROWS_LIMIT = 6;

export const Dashboard = () => {
  const [devices, setDevices] = useState<DeviceWithReadings[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<AlertEvent[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [alerts24h, setAlerts24h] = useState(0);
  const [recentAlerts, setRecentAlerts] = useState<RecentAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadErrorInfo | null>(null);
  const navigate = useNavigate();
  const now = useNowTick();

  useEffect(() => {
    fetchData();

    const deviceSub = supabase.channel('dash_devices')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, fetchData)
      .subscribe();

    const alertSub = supabase.channel('dash_alerts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alert_events' }, fetchData)
      .subscribe();

    const profileSub = supabase.channel('dash_profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, fetchData)
      .subscribe();

    return () => {
      supabase.removeChannel(deviceSub);
      supabase.removeChannel(alertSub);
      supabase.removeChannel(profileSub);
    };
  }, []);

  const fetchData = async () => {
    try {
      const [devicesRes, alertsRes, profilesRes, alerts24hRes, recentAlertsRes] = await Promise.all([
        // Each device with its latest reading: position for the map, plus
        // on_battery for the battery badge (spec HW-1.5.2/SW-2.4.4).
        supabase.from('devices')
          .select<string, DeviceWithReadings>(`${DEVICE_COLUMNS}, sensor_readings(${MAP_READING_COLUMNS})`)
          .order('device_code', { ascending: true })
          .order('recorded_at', { foreignTable: 'sensor_readings', ascending: false })
          .limit(1, { foreignTable: 'sensor_readings' }),
        supabase.from('alert_events').select(`*, devices(${DEVICE_COLUMNS})`).is('resolved_at', null),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        // Alerts (any tier) triggered in the last 24 hours
        supabase.from('alert_events')
          .select('id', { count: 'exact', head: true })
          .gte('triggered_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
        // Recent alerts for the activity snapshot
        supabase.from('alert_events')
          .select('*, devices(label, device_code)')
          .order('triggered_at', { ascending: false })
          .limit(ACTIVITY_LIMIT),
      ]);

      // A failed read must be visible, not look like an empty fleet.
      const readError = devicesRes.error ?? alertsRes.error;
      setLoadError(readError ? { message: readError.message, code: readError.code } : null);

      if (devicesRes.data) setDevices(devicesRes.data);
      if (alertsRes.data) setActiveAlerts(alertsRes.data as unknown as AlertEvent[]);
      if (profilesRes.count !== null) setTotalUsers(profilesRes.count);
      if (alerts24hRes.count !== null) setAlerts24h(alerts24hRes.count);
      setRecentAlerts((recentAlertsRes.data ?? []) as unknown as RecentAlert[]);
    } catch (error) {
      console.error('Error fetching dashboard data', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <DashboardSkeleton />;
  }

  const statusById = new Map(devices.map(d => [d.id, getDeviceStatus(d, activeAlerts, now)]));
  const statusCounts: Record<DeviceStatus, number> = { fire: 0, warning: 0, online: 0, reconnecting: 0, offline: 0 };
  for (const s of statusById.values()) statusCounts[s]++;
  const isAlerting = (s: DeviceStatus | undefined) => s === 'fire' || s === 'warning';
  // Alerting devices first so they're never cut off by the row limit; the
  // rest keep device-code order from the query.
  const sortedDevices = [...devices].sort(
    (a, b) => Number(isAlerting(statusById.get(b.id))) - Number(isAlerting(statusById.get(a.id)))
  );
  const mapDevices = toMapDevices(devices, now);
  const devicesWithoutLocation = mapDevices.filter(d => d.location.kind === 'unavailable');

  return (
    <div className="w-full mx-auto pb-12">

      {loadError && (
        <div className="mb-6"><LoadErrorBanner what="dashboard data" error={loadError} onRetry={fetchData} /></div>
      )}

      {/* Page header */}
      <div className="mb-6 md:mb-8">
        <PageHeader title="Dashboard" description="Real-time overview of users, devices, and fire alerts." />
      </div>

      {/* Stat cards — 2-up on phones, 4-up on desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6 mb-6 md:mb-8">
        <StatCard label="Total Users" value={formatNumber(totalUsers)} icon={Users} />
        <StatCard label="Registered Devices" value={formatNumber(devices.length)} icon={Cpu} />
        {/* Red only when there is actually something burning — a red "0"
            reads as an alarm at a glance. */}
        <StatCard label="Active Alerts" value={formatNumber(activeAlerts.length)} icon={AlertTriangle} urgent={activeAlerts.length > 0} />
        <StatCard label="Alerts (Last 24h)" value={formatNumber(alerts24h)} icon={Activity} />
      </div>

      {/* Main layout: map + devices (2/3), actions + activity (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">

        <div className="lg:col-span-2 flex flex-col gap-6 lg:gap-8 min-w-0">

          {/* Live Device Map preview — full view lives on the Live Map tab */}
          <section className="flex flex-col gap-3">
            <SectionHeader title="Live Device Map" action={<SectionLink to="/admin/map">Open full map</SectionLink>} />
            <div className={`${CARD} overflow-hidden h-[360px] lg:h-[420px]`}>
              <DeviceMap
                compact
                devices={mapDevices}
                activeAlerts={activeAlerts}
                now={now}
                onViewDetails={(d) => navigate(`/admin/alerts?q=${encodeURIComponent(d.device_code)}&device=${d.id}`)}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* No counts here: the Device Status pills below already count
                  every device, and pin-only counts disagreed with them
                  whenever a device had no location. */}
              <MapLegend />
              {devicesWithoutLocation.length > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                  <MapPinOff className="w-3.5 h-3.5 shrink-0 text-[#B45309]" />
                  <span><strong className="text-text">No location for {devicesWithoutLocation.map(d => d.device_code).join(', ')}</strong> — not shown on the map.</span>
                </span>
              )}
            </div>
          </section>

          {/* Device status */}
          <section className="flex flex-col gap-3">
            <SectionHeader
              title="Device Status"
              meta={devices.length > 0 && (
                <>
                  {/* Online and offline always shown; the rest only when present */}
                  {DEVICE_STATUS_ORDER.filter(st => statusCounts[st] > 0 || st === 'online' || st === 'offline').map(st => (
                    <StatusCountPill key={st} status={st} count={statusCounts[st]} />
                  ))}
                </>
              )}
              action={<SectionLink to="/admin/devices">View all devices</SectionLink>}
            />

            <div className={`${CARD} overflow-hidden`}>
              {/* Column headers — hidden on phones, where rows stack */}
              <div className={`hidden sm:grid ${DEVICE_GRID} bg-surface-alt border-b border-border`}>
                <div className={TH}>Device ID</div>
                <div className={TH}>Location</div>
                <div className={`${TH} text-right`}>Status</div>
              </div>

              {devices.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-16 text-text-faint text-sm">
                  <Cpu className="w-8 h-8 text-border-light" />
                  <span>No devices registered yet</span>
                  <Link to="/admin/devices" className="text-primary-dark font-bold text-xs hover:underline mt-1">
                    Register your first device →
                  </Link>
                </div>
              ) : (
                <ul className="divide-y divide-border-warm">
                  {sortedDevices.slice(0, DEVICE_ROWS_LIMIT).map((device) => {
                    const status = statusById.get(device.id) ?? 'offline';
                    const isAlert = isAlerting(status);
                    const note = getStatusNote(device, status, now);
                    const onBattery = device.sensor_readings?.[0]?.on_battery;

                    return (
                      <li key={device.id}>
                        {/* Whole row opens the device on the Live Map, like the Live Map's feed cards. */}
                        <Link
                          to={`/admin/map?device=${device.id}`}
                          title="Show on map"
                          className={`grid grid-cols-[1fr_auto] ${DEVICE_GRID} gap-x-4 gap-y-1 px-4 sm:px-0 py-4 sm:py-0 hover:bg-surface transition-colors ${status === 'fire' ? 'bg-tier2-bg/40' : status === 'warning' ? 'bg-tier1-bg/40' : ''}`}
                        >
                          <div className="sm:px-6 sm:py-5 flex flex-col justify-center min-w-0">
                            <span className={`text-text font-mono text-xs leading-4 ${isAlert ? 'font-bold' : 'font-medium'}`}>
                              {device.device_code}
                            </span>
                            {device.label && <span className="text-[11px] leading-4 text-text-subtle mt-0.5 line-clamp-2" title={device.label}>{device.label}</span>}
                          </div>
                          <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto sm:px-6 sm:py-5 flex flex-wrap items-center gap-2 min-w-0">
                            <span className={`text-text-muted text-sm leading-5 ${isAlert ? 'font-bold' : 'font-medium'}`}>
                              {device.location_desc}
                            </span>
                            {onBattery && (
                              <span title="Mains power lost — running on backup battery" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tier1-bg text-[#B45309] text-[10px] font-bold uppercase tracking-wide">
                                <BatteryWarning className="w-3 h-3" /> On battery
                              </span>
                            )}
                          </div>
                          <div className="row-start-1 col-start-2 sm:row-start-auto sm:col-start-auto sm:px-6 sm:py-4 flex flex-col items-end justify-center gap-1">
                            <StatusBadge status={status} />
                            {note && (
                              <span className="text-[11px] text-text-subtle whitespace-nowrap">{note}</span>
                            )}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              {devices.length > DEVICE_ROWS_LIMIT && (
                <Link to="/admin/devices" className="block px-4 sm:px-6 py-3 border-t border-border-warm text-xs font-bold text-primary-dark hover:underline">
                  + {devices.length - DEVICE_ROWS_LIMIT} more devices
                </Link>
              )}
            </div>
          </section>
        </div>

        {/* Right column — sticks while the left column scrolls on desktop */}
        <aside className="flex flex-col gap-6 lg:gap-8 lg:sticky lg:top-0 lg:self-start">

          <section className="flex flex-col gap-3">
            <SectionHeader title="Quick Actions" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
              <button
                onClick={() => navigate('/admin/users')}
                className="h-12 px-4 rounded-lg flex items-center justify-between bg-primary text-white hover:bg-primary-dark transition-colors"
              >
                <span className="font-semibold text-sm">Add User</span>
                <Users className="w-4 h-4" />
              </button>
              <button
                onClick={() => navigate('/admin/devices')}
                className="h-12 px-4 rounded-lg flex items-center justify-between bg-surface-card border-2 border-primary-dark text-text hover:bg-surface-warm transition-colors"
              >
                <span className="font-semibold text-sm">Register Device</span>
                <Cpu className="w-4 h-4" />
              </button>
            </div>
          </section>

          {/* Recent activity — from real DB data */}
          <section className="flex flex-col gap-3">
            <SectionHeader
              title="Recent Activity"
              action={recentAlerts.length > 0 && <SectionLink to="/admin/logs">View full log</SectionLink>}
            />
            <div className={CARD}>
              {recentAlerts.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-text-faint text-xs">
                  <Activity className="w-6 h-6 text-border-light mb-2" />
                  <span>No recent activity</span>
                </div>
              ) : (
                <ul className="divide-y divide-border-warm">
                  {recentAlerts.map((alert) => {
                    const isResolved = !!alert.resolved_at;
                    const isFire = alert.alert_tier === 2;
                    const code = alert.devices?.device_code ?? 'Unknown device';
                    const label = alert.devices?.label;
                    return (
                      <li key={alert.id}>
                        <Link
                          to={alert.device_id ? `/admin/map?device=${alert.device_id}` : '/admin/logs'}
                          title={alert.device_id ? 'Show on map' : undefined}
                          className="flex gap-3 p-4 hover:bg-surface transition-colors"
                        >
                          <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${isResolved ? 'bg-text-faint' : isFire ? 'bg-tier2-border' : 'bg-tier1-border'}`}></span>
                          <div className="flex flex-col gap-1 min-w-0">
                            <h4 className="text-text font-bold text-[13px] leading-4">
                              {alertTitle(alert)}
                            </h4>
                            <p className="text-text-muted text-xs leading-[18px]">
                              <span className="font-mono font-semibold">{code}</span>{label ? ` · ${label}` : ''}
                              <br />
                              CO {alert.co_ppm} ppm · {formatTemp(alert.temp_celsius)} at trigger
                            </p>
                            <span className="text-text-subtle text-[11px] font-medium">
                              {formatEventTime(alertEventAt(alert), now)} · {alertActor(alert)}
                            </span>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
};

// ─── Shared building blocks (one card / heading / link style for the page) ───

const CARD = 'bg-surface-card border border-border rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.04)]';
const TH = 'px-6 py-3 text-text-body font-black text-[10px] uppercase tracking-[0.1em]';
// Phones: code + status on one line, location underneath. sm+: 3 columns.
const DEVICE_GRID = 'sm:grid-cols-[170px_minmax(0,1fr)_auto]';

const SectionHeader = ({ title, meta, action }: { title: string; meta?: React.ReactNode; action?: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-x-4 gap-y-2 flex-wrap min-h-7">
    <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
      <h3 className="text-text font-bold text-lg leading-7 tracking-[-0.01em]">{title}</h3>
      {meta && <div className="flex items-center gap-1.5 flex-wrap">{meta}</div>}
    </div>
    {action}
  </div>
);

const SectionLink = ({ to, children }: { to: string; children: React.ReactNode }) => (
  <Link to={to} className="inline-flex items-center gap-1 text-primary-dark font-bold text-xs hover:underline whitespace-nowrap">
    {children} <ArrowRight className="w-3.5 h-3.5" />
  </Link>
);

const StatCard = ({
  label,
  value,
  icon: Icon,
  urgent = false,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  urgent?: boolean;
}) => (
  <div className={`rounded-lg border shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4 sm:p-5 flex flex-col gap-2 min-w-0 ${urgent ? 'bg-tier2-bg/60 border-tier2-border/40 border-b-4 border-b-primary-dark' : 'bg-surface-card border-border'}`}>
    <div className="flex items-start justify-between gap-2">
      <span className={`font-bold text-[10px] leading-[15px] tracking-[0.1em] uppercase ${urgent ? 'text-primary-dark' : 'text-text-body'}`}>
        {label}
      </span>
      <Icon className={`w-4 h-4 sm:w-5 sm:h-5 shrink-0 ${urgent ? 'text-accent' : 'text-text-subtle'}`} />
    </div>
    <span className={`font-extrabold text-[28px] leading-8 sm:text-[36px] sm:leading-10 tracking-[-0.04em] ${urgent ? 'text-primary-dark' : 'text-text'}`}>
      {value}
    </span>
  </div>
);

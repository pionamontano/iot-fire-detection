import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { DEVICE_COLUMNS } from '../../lib/deviceColumns';
import { LoadErrorBanner } from '../../components/LoadErrorBanner';
import type { LoadErrorInfo } from '../../components/LoadErrorBanner';
import type { AlertEvent } from '../../lib/supabase';
import {
  Users,
  Cpu,
  Activity,
  AlertTriangle,
  BatteryWarning,
  Map as MapIcon,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { DashboardSkeleton } from '../../components/SkeletonLoaders';
import { getConnectivityStatus } from '../../lib/deviceStatus';
import { formatAge } from '../../lib/location';
import { useNowTick } from '../../hooks/useNowTick';
import { DeviceMap, MapLegend } from '../../components/DeviceMap';
import { MAP_READING_COLUMNS, toMapDevices } from '../../lib/mapDevices';
import type { DeviceWithReadings } from '../../lib/mapDevices';

type DeviceStatus = 'online' | 'reconnecting' | 'alert' | 'offline';

// Helper to determine device status based on alerts and last_seen_at
const getDeviceStatus = (device: DeviceWithReadings, activeAlerts: AlertEvent[], now: number): DeviceStatus => {
  const hasAlert = activeAlerts.some(a => a.device_id === device.id);
  if (hasAlert) return 'alert';
  if (!device.is_active) return 'offline';
  return getConnectivityStatus(device.last_seen_at, now);
};

// Plain counts — no zero-padding ("00", "002"), which read as codes.
const formatNumber = (n: number): string => n.toLocaleString();

// "Today, 6:33 PM" / "Yesterday, 10:43 PM" / "Oct 3, 10:28 PM". Time alone
// made entries from different days look out of order.
const formatEventTime = (iso: string, now: number): string => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dayDiff = Math.floor((startOfToday.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (dayDiff <= 0) return `Today, ${time}`;
  if (dayDiff === 1) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
};

const RESOLVED_BY: Record<string, string> = {
  device: 'Auto-cleared by device',
  responder: 'Resolved by responder',
  admin: 'Resolved by admin',
};

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
  const statusCounts = { online: 0, reconnecting: 0, alert: 0, offline: 0 };
  for (const s of statusById.values()) statusCounts[s]++;
  // Alerting devices first so they're never cut off by the row limit; the
  // rest keep device-code order from the query.
  const sortedDevices = [...devices].sort(
    (a, b) => Number(statusById.get(b.id) === 'alert') - Number(statusById.get(a.id) === 'alert')
  );
  const mapDevices = toMapDevices(devices, now);
  const devicesWithoutLocation = mapDevices.filter(d => d.location.kind === 'unavailable');

  return (
    <div className="w-full mx-auto pb-[63px]">

      {loadError && (
        <div className="mb-6"><LoadErrorBanner what="dashboard data" error={loadError} onRetry={fetchData} /></div>
      )}

      {/* Top Header Area */}
      <div className="flex flex-col gap-1 mb-10">
        <h2 className="text-[#1C1B1B] font-extrabold text-[40px] leading-[36px] tracking-[-0.0187em]">
          Dashboard
        </h2>
        <p className="text-[#5B403D]/80 font-medium text-sm leading-5 mt-1 max-w-[809px]">
          Real-time overview of users, devices, and fire alerts.
        </p>
      </div>

      {/* 4 Stat Cards — all from real data */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <StatCard
          label="Total Users"
          value={formatNumber(totalUsers)}
          icon={<Users className="w-5 h-5 text-[#1C1B1B]" />}
        />
        <StatCard
          label="Registered Devices"
          value={formatNumber(devices.length)}
          icon={<Cpu className="w-5 h-5 text-[#1C1B1B]" />}
        />
        {/* Red only when there is actually something burning — a red "0"
            reads as an alarm at a glance. */}
        {activeAlerts.length > 0 ? (
          <UrgentStatCard
            label="Active Alarms"
            value={formatNumber(activeAlerts.length)}
            icon={<AlertTriangle className="w-[22px] h-[19px] text-[#D32F2F]" />}
          />
        ) : (
          <StatCard
            label="Active Alarms"
            value="0"
            icon={<AlertTriangle className="w-5 h-5 text-[#1C1B1B]" />}
          />
        )}
        <StatCard
          label="Alerts (Last 24h)"
          value={formatNumber(alerts24h)}
          icon={<Activity className="w-4 h-[19px] text-[#1C1B1B]" />}
        />
      </div>

      {/* Main Dashboard Layout (Grid 3 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">

        {/* Map + System Status Table (Col span 2) */}
        <div className="lg:col-span-2 flex flex-col gap-10 min-w-0">

          {/* Live Device Map preview — full view lives on the Live Map tab */}
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[#1C1B1B] font-bold text-[20px] leading-7 tracking-[-0.025em]">
                Live Device Map
              </h3>
              <Link
                to="/admin/map"
                className="text-[#AF101A] font-bold text-[12px] leading-4 hover:underline inline-flex items-center gap-1"
              >
                <MapIcon className="w-3.5 h-3.5" /> Open full map
              </Link>
            </div>
            <div className="h-[420px] rounded-[8px] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.05)] border border-[#EBE7E7]">
              <DeviceMap
                compact
                devices={mapDevices}
                activeAlerts={activeAlerts}
                now={now}
                onViewDetails={() => navigate('/admin/alerts')}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <MapLegend />
              {devicesWithoutLocation.length > 0 && (
                <span className="text-[11px] text-[#B45309]">
                  No location for {devicesWithoutLocation.map(d => d.device_code).join(', ')}
                </span>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-[#1C1B1B] font-bold text-[20px] leading-7 tracking-[-0.025em]">
                  Device Status
                </h3>
                {devices.length > 0 && (
                  <span className="text-[12px] font-semibold text-[#52525B]">
                    {statusCounts.online} online
                    {statusCounts.reconnecting > 0 && <> · {statusCounts.reconnecting} reconnecting</>}
                    {' · '}
                    <span className={statusCounts.offline > 0 ? 'text-[#B45309]' : ''}>{statusCounts.offline} offline</span>
                    {statusCounts.alert > 0 && <> · <span className="text-[#DC2626]">{statusCounts.alert} alerting</span></>}
                  </span>
                )}
              </div>
              <Link
                to="/admin/devices"
                className="text-[#AF101A] font-bold text-[12px] leading-4 text-center hover:underline"
              >
                View All Devices
              </Link>
            </div>

            <div className="bg-[#F6F3F2] rounded-[8px] shadow-[0_1px_2px_rgba(0,0,0,0.05)] overflow-hidden flex flex-col">

              {/* Table Header */}
              <div className="flex bg-[#EBE7E7] border-b border-[#F4F4F5]">
                <div className="w-[130px] px-6 py-4 text-[#5B403D] font-black text-[10px] uppercase tracking-[0.1em]">
                  Device UID
                </div>
                <div className="flex-1 px-6 py-4 text-[#5B403D] font-black text-[10px] uppercase tracking-[0.1em]">
                  Location
                </div>
                <div className="w-[191px] px-6 py-4 text-[#5B403D] font-black text-[10px] uppercase tracking-[0.1em] text-right">
                  Status
                </div>
              </div>

              {/* Table Body — from real DB data */}
              <div className="flex flex-col bg-white">
                {devices.length === 0 ? (
                  <div className="flex items-center justify-center py-16 text-[#A1A1AA] text-sm">
                    <div className="flex flex-col items-center gap-2">
                      <Cpu className="w-8 h-8 text-[#E4E4E7]" />
                      <span>No devices registered yet</span>
                      <Link to="/admin/devices" className="text-[#AF101A] font-bold text-[12px] hover:underline mt-1">
                        Register your first device →
                      </Link>
                    </div>
                  </div>
                ) : (
                  sortedDevices.slice(0, DEVICE_ROWS_LIMIT).map((device) => {
                    const status = statusById.get(device.id) ?? 'offline';
                    const isAlert = status === 'alert';
                    const onBattery = device.sensor_readings?.[0]?.on_battery;

                    return (
                      <div
                        key={device.id}
                        className={`flex border-b border-[#F4F4F5] hover:bg-gray-50 transition-colors ${isAlert ? 'bg-[#F4A185]/10' : ''}`}
                      >
                        <div className="w-[130px] px-6 py-[22px]">
                          <span className={`text-[#1C1B1B] font-mono text-[12px] leading-4 ${isAlert ? 'font-bold' : ''}`}>
                            {device.device_code}
                          </span>
                        </div>
                        <div className="flex-1 px-6 py-5 flex items-center gap-2 flex-wrap min-w-0">
                          <span className={`text-[#52525B] font-medium text-[14px] leading-5 ${isAlert ? 'font-bold' : ''}`}>
                            {device.location_desc}
                          </span>
                          {onBattery && (
                            <span title="Mains power lost — running on backup battery" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#B45309] text-[10px] font-bold uppercase tracking-wide">
                              <BatteryWarning className="w-3 h-3" /> On battery
                            </span>
                          )}
                        </div>
                        <div className="w-[191px] px-6 py-4 flex flex-col items-end justify-center gap-1">
                          <StatusBadge status={status} />
                          {status !== 'online' && status !== 'alert' && (
                            <span className="text-[11px] text-[#71717A]">
                              {device.last_seen_at ? `Last seen ${formatAge(device.last_seen_at, now)}` : 'Never seen'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                {devices.length > DEVICE_ROWS_LIMIT && (
                  <Link to="/admin/devices" className="px-6 py-3 text-[12px] font-bold text-[#AF101A] hover:underline">
                    + {devices.length - DEVICE_ROWS_LIMIT} more devices
                  </Link>
                )}
              </div>
            </div>
          </section>
        </div>

        {/* Sidebar Content (Col span 1) */}
        <div className="flex flex-col gap-6">

          {/* Quick Actions */}
          <div className="flex flex-col gap-4">
            <h3 className="text-[#71717A] font-bold text-[14px] uppercase tracking-[0.1em]">
              Quick Actions
            </h3>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => navigate('/admin/users')}
                className="bg-[#B91C1C] rounded-[8px] p-4 flex items-center justify-between text-white hover:bg-[#AF101A] transition-colors"
              >
                <span className="font-semibold text-[14px] leading-5">Add User</span>
                <Users className="w-4 h-4" />
              </button>
              <button
                onClick={() => navigate('/admin/devices')}
                className="border-2 border-[#AF101A] rounded-[8px] p-4 flex items-center justify-between text-[#3F3F46] hover:bg-[#FFF5F2] transition-colors"
              >
                <span className="font-semibold text-[14px] leading-5">Register Device</span>
                <Cpu className="w-5 h-5 text-[#1C1B1B]" />
              </button>
            </div>
          </div>

          {/* Recent Activity — from real DB data */}
          <div className="flex flex-col gap-6 mt-2">
            <h3 className="text-[#71717A] font-bold text-[14px] uppercase tracking-[0.1em]">
              Recent Activity
            </h3>

            <div className="flex flex-col gap-4">
              {recentAlerts.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-[#A1A1AA] text-[12px]">
                  <Activity className="w-6 h-6 text-[#E4E4E7] mb-2" />
                  <span>No recent activity</span>
                </div>
              ) : (
                recentAlerts.map((alert) => {
                  const isResolved = !!alert.resolved_at;
                  const isFire = alert.alert_tier === 2;
                  const kind = isFire ? 'Fire alert' : 'Warning';
                  const code = alert.devices?.device_code ?? 'Unknown device';
                  const label = alert.devices?.label;
                  const actor = isResolved
                    ? RESOLVED_BY[alert.resolution_source ?? ''] ?? 'Resolved'
                    : `Tier ${alert.alert_tier} · Automated`;
                  return (
                    <div key={alert.id} className="flex gap-4">
                      <div className={`w-[3px] rounded-full shrink-0 ${isResolved ? 'bg-[#E4E4E7]' : isFire ? 'bg-[#DC2626]' : 'bg-[#F59E0B]'}`}></div>
                      <div className="flex flex-col gap-1 py-1 min-w-0">
                        <h4 className="text-[#1C1B1B] font-bold text-[12px] leading-4">
                          {kind} {isResolved ? 'resolved' : 'triggered'}
                        </h4>
                        <p className="text-[#52525B] text-[11px] leading-[16.5px]">
                          <span className="font-mono font-semibold">{code}</span>{label ? ` · ${label}` : ''}
                          <br />
                          CO {alert.co_ppm} ppm · {alert.temp_celsius}°C at trigger
                        </p>
                        <span className="text-[#71717A] font-bold text-[10px] uppercase tracking-[0.02em] mt-1">
                          {formatEventTime(isResolved ? (alert.resolved_at as string) : alert.triggered_at, now)} · {actor}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {recentAlerts.length > 0 && (
              <Link to="/admin/logs" className="text-[#AF101A] font-bold text-[12px] hover:underline">
                View full log →
              </Link>
            )}
          </div>

        </div>
      </div>

    </div>
  );
};

// Status Badge component
const StatusBadge = ({ status }: { status: DeviceStatus }) => {
  const config = {
    online: {
      bg: 'bg-[#00799C]/10',
      dot: 'bg-[#10B981]',
      text: 'text-[#00799C]',
      label: 'Online'
    },
    reconnecting: {
      bg: 'bg-[#FEF3C7]/60',
      dot: 'bg-[#F59E0B]',
      text: 'text-[#B45309]',
      label: 'Reconnecting'
    },
    alert: {
      bg: 'bg-[#FFDAD6]/20',
      dot: 'bg-[#DC2626]',
      text: 'text-[#DC2626]',
      label: 'Alert'
    },
    offline: {
      bg: 'bg-[#EBE7E7]',
      dot: 'bg-[#71717A]',
      text: 'text-[#52525B]',
      label: 'Offline'
    }
  };

  const c = config[status];

  return (
    <div className={`${c.bg} px-3 py-1 rounded-[12px] flex items-center gap-2`}>
      <span className={`w-2 h-2 rounded-full ${c.dot}`}></span>
      <span className={`${c.text} font-bold text-[12px] leading-5 uppercase tracking-[0.1em]`}>{c.label}</span>
    </div>
  );
};

// Simple Stat Card
const StatCard = ({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) => (
  <div className="bg-[#F6F3F2] border-b-2 border-transparent rounded-[8px] p-6 flex flex-col gap-2">
    <span className="text-[#5B403D] font-bold text-[10px] leading-[15px] tracking-[0.1em] uppercase">
      {label}
    </span>
    <div className="flex items-end justify-between">
      <span className="font-extrabold text-[36px] leading-[40px] tracking-[-0.05em] text-[#1C1B1B]">
        {value}
      </span>
      <div className="pb-1">{icon}</div>
    </div>
  </div>
);

// Urgent Stat Card (Red theme)
const UrgentStatCard = ({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) => (
  <div className="bg-[#F4A185]/20 border-b-4 border-[#AF101A] rounded-[8px] p-6 flex flex-col gap-2 relative overflow-hidden">
    <span className="text-[#AF101A] font-bold text-[10px] leading-[15px] tracking-[0.1em] uppercase relative z-10">
      {label}
    </span>
    <div className="flex items-end justify-between relative z-10">
      <span className="font-extrabold text-[36px] leading-[40px] tracking-[-0.05em] text-[#AF101A]">
        {value}
      </span>
      <div className="pb-1">{icon}</div>
    </div>
  </div>
);
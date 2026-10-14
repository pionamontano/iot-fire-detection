import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { supabase } from '../../lib/supabase';
import { DEVICE_COLUMNS } from '../../lib/deviceColumns';
import { LoadErrorBanner } from '../../components/LoadErrorBanner';
import type { LoadErrorInfo } from '../../components/LoadErrorBanner';
import type { Device, AlertEvent } from '../../lib/supabase';
import { Link, useSearchParams } from 'react-router-dom';
import {
  XCircle,
  CheckCircle2,
  List,
  Pencil,
  Power,
  ShieldCheck,
  BatteryWarning,
  Search,
  X,
  Map as MapIcon,
} from 'lucide-react';
import { TableBodySkeleton } from '../../components/SkeletonLoaders';
import { TABLE_CARD, TABLE_TITLE, TABLE, THEAD_ROW, TH, TR, TD, TableScroll, TableEmpty, TablePager, TABLE_PAGE_SIZE } from '../../components/Table';
import { getDeviceStatus as getSharedDeviceStatus, getStatusNote, DEVICE_STATUS, DEVICE_STATUS_ORDER } from '../../lib/deviceStatus';
import type { DeviceStatus } from '../../lib/deviceStatus';
import { StatusBadge } from '../../components/StatusBadge';
import { useNowTick } from '../../hooks/useNowTick';
import { transitionIncident } from '../../lib/incidents';
import { displayAddress } from '../../lib/location';

type DeviceWithStatus = Device & {
  status: DeviceStatus;
  activeAlert?: AlertEvent;
};

// Status comes from the shared model (Fire / Warning / Online / Reconnecting
// / Offline) so this table matches the dashboard and the map.
const getDeviceStatus = (device: Device, activeAlerts: AlertEvent[], now: number): { status: DeviceStatus; activeAlert?: AlertEvent } => ({
  status: getSharedDeviceStatus(device, activeAlerts, now),
  activeAlert: activeAlerts.find(a => a.device_id === device.id),
});

export const Alerts = () => {
  const [rawDevices, setRawDevices] = useState<Device[]>([]);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadErrorInfo | null>(null);
  const now = useNowTick();
  // device_id -> latest on_battery (spec HW-1.5.2/SW-2.4.4 — previously
  // this indicator existed only on Resident/Responder views, never Admin)
  const [batteryByDevice, setBatteryByDevice] = useState<Record<string, boolean>>({});
  // device_id -> assigned resident's full_name. The "Owner Name" column
  // used to show devices.label (an admin-set free-text field, editable in Devices → Edit device) which can drift from the actual resident account
  // on the device — this is the name the resident portal actually shows.
  const [residentNameByDevice, setResidentNameByDevice] = useState<Record<string, string>>({});

  // New states for functionality
  const [statusFilter, setStatusFilter] = useState<'all' | DeviceStatus>('all');
  // ?q= comes from the header device search; ?device= highlights the row
  // that was picked there.
  const [searchParams, setSearchParams] = useSearchParams();
  const searchQuery = searchParams.get('q') ?? '';
  const highlightedId = searchParams.get('device');
  // Scroll the row picked in the header search into view, once per pick
  // (not on every clock tick re-render).
  useEffect(() => {
    if (!highlightedId || loading) return;
    document.querySelector(`tr[data-device-id="${highlightedId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightedId, loading]);
  const setSearchQuery = (q: string) => {
    const next = new URLSearchParams(searchParams);
    if (q) next.set('q', q); else next.delete('q');
    next.delete('device');
    setSearchParams(next, { replace: true });
    setCurrentPage(1);
  };
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = TABLE_PAGE_SIZE;

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [devicesRes, alertsRes, batteryRes, residentsRes] = await Promise.all([
      supabase.from('devices').select<string, Device>(DEVICE_COLUMNS).order('created_at', { ascending: false }),
      supabase.from('alert_events').select('*, devices(device_code, label, location_desc)').order('triggered_at', { ascending: false }),
      // Latest readings across devices, to derive each device's current
      // on_battery state (no per-device "latest reading" view exists, so
      // the most recent batch is reduced client-side below).
      supabase.from('sensor_readings')
        .select('device_id, on_battery, recorded_at')
        .order('recorded_at', { ascending: false })
        .limit(300),
      // Resident assigned to each device (profiles.device_id is unique per
      // resident — see 20260917040000_prevent_duplicate_device_assignment.sql —
      // so there's at most one row per device_id here).
      supabase.from('profiles')
        .select('device_id, full_name')
        .eq('role', 'resident')
        .not('device_id', 'is', null),
    ]);

    // A failed read must be visible, not look like an empty fleet.
    const readError = devicesRes.error ?? alertsRes.error;
    setLoadError(readError ? { message: readError.message, code: readError.code } : null);
    setRawDevices(devicesRes.data || []);
    setAlerts((alertsRes.data || []) as unknown as AlertEvent[]);
    if (batteryRes.data) {
      const latestByDevice: Record<string, boolean> = {};
      for (const r of batteryRes.data) {
        if (!(r.device_id in latestByDevice)) latestByDevice[r.device_id] = r.on_battery;
      }
      setBatteryByDevice(latestByDevice);
    }
    if (residentsRes.data) {
      const nameByDevice: Record<string, string> = {};
      for (const p of residentsRes.data as { device_id: string; full_name: string }[]) {
        nameByDevice[p.device_id] = p.full_name;
      }
      setResidentNameByDevice(nameByDevice);
    }
    setLoading(false);
  }, []);

  // Re-derived on every fetch AND every 30s tick, so a device's badge advances
  // from Online → Reconnecting → Offline even with no new realtime event.
  const devices = useMemo<DeviceWithStatus[]>(() => {
    const activeAlerts = alerts.filter(a => !a.resolved_at);
    return rawDevices.map(d => {
      const { status, activeAlert } = getDeviceStatus(d, activeAlerts, now);
      return { ...d, status, activeAlert };
    });
  }, [rawDevices, alerts, now]);

  useEffect(() => {
    fetchData();

    const deviceSub = supabase.channel('sysoverview_devices')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, fetchData)
      .subscribe();
    const alertSub = supabase.channel('sysoverview_alerts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alert_events' }, fetchData)
      .subscribe();
    // So a resident's device (re)assignment in admin/Users.tsx is reflected
    // here without waiting on an unrelated device/alert change.
    const profileSub = supabase.channel('sysoverview_profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, fetchData)
      .subscribe();

    return () => {
      supabase.removeChannel(deviceSub);
      supabase.removeChannel(alertSub);
      supabase.removeChannel(profileSub);
    };
  }, [fetchData]);

  const activeAlertCount = devices.filter(d => d.status === 'fire' || d.status === 'warning').length;
  const onlineCount = devices.filter(d => d.status === 'online').length;

  const handleTogglePower = async (device: DeviceWithStatus) => {
    try {
      const updates: Record<string, unknown> = { is_active: !device.is_active };
      // When activating, set last_seen_at so status becomes 'Online' instead of staying 'Offline'
      if (!device.is_active) {
        updates.last_seen_at = new Date().toISOString();
      }
      const { error } = await supabase.from('devices').update(updates).eq('id', device.id);
      if (error) throw error;
      fetchData();
    } catch (err) {
      console.error('Error toggling power:', err);
      window.alert('Failed to update device power state: ' + (err as Error).message);
    }
  };

  // Manual resolve fallback (spec SW-2.1.6) — e.g. for a device that went
  // offline mid-alert and can no longer auto-resolve via a safe reading.
  const handleResolveAlert = async (device: DeviceWithStatus) => {
    if (!device.activeAlert) return;
    if (!window.confirm(`Resolve the active alert for ${device.device_code}? This should only be done once the reported condition is confirmed cleared.`)) {
      return;
    }
    // Goes through transition_incident: the database validates the change and records who closed it and when.
    const result = await transitionIncident(supabase, device.activeAlert.id, 'resolved');
    if (!result.ok) window.alert(result.message);
    if (result.ok || result.refresh) fetchData();
  };

  // Status chips double as the legend: color, count, and (on hover) what
  // the status means — so the legend no longer needs its own sidebar.
  const countByStatus = useMemo(() => {
    const counts = Object.fromEntries(DEVICE_STATUS_ORDER.map(st => [st, 0])) as Record<DeviceStatus, number>;
    for (const d of devices) counts[d.status]++;
    return counts;
  }, [devices]);
  const changeStatusFilter = (st: 'all' | DeviceStatus) => {
    setStatusFilter(st);
    setCurrentPage(1);
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredDevices = devices.filter(d =>
    (statusFilter === 'all' || d.status === statusFilter) &&
    (!q || [d.device_code, d.label, d.location_desc, residentNameByDevice[d.id]]
      .some(v => v?.toLowerCase().includes(q)))
  );
  const paginatedDevices = filteredDevices.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="space-y-8">
      {loadError && (
        <LoadErrorBanner what="devices and alerts" error={loadError} onRetry={fetchData} />
      )}
      {/* ─── Page Header & Stats Summary ─── */}
      <PageHeader
        title="Device Status"
        description="Real-time status tracking for all deployed IoT environmental sensors."
        actions={
        <div className="grid grid-cols-2 gap-3 md:gap-4">
          <StatCard
            label="Active Alerts"
            value={activeAlertCount}
            icon={<XCircle className="w-5 h-5 text-[#DC2626]" />}
            iconBg="bg-[rgba(220,38,38,0.1)]"
            valueClass={activeAlertCount > 0 ? 'text-[#DC2626]' : 'text-[#1C1B1B]'}
          />
          <StatCard
            label="Online"
            value={onlineCount}
            icon={<CheckCircle2 className="w-5 h-5 text-[#10B981]" />}
            iconBg="bg-[rgba(16,185,129,0.1)]"
            valueClass="text-[#1C1B1B]"
          />
        </div>
        }
      />

      {/* ─── Device table (full width, same layout as Devices) ─── */}
      <div className={TABLE_CARD}>
        <div className="flex flex-col gap-4 p-5 border-b border-border">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <List className="w-5 h-5 text-[#DC2626]" />
              <h3 className={`${TABLE_TITLE} whitespace-nowrap`}>
                All Connected Devices <span className="text-[#A1A1AA] font-medium">({devices.length})</span>
              </h3>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#A1A1AA]" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search code, owner, location…"
                  aria-label="Search devices"
                  className="w-60 pl-8 pr-7 py-1.5 border border-[#E5E2E1] rounded text-xs text-[#1C1B1B] placeholder:text-[#A1A1AA] focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-[#A1A1AA] hover:text-[#1C1B1B]">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Status filter + legend in one row. Hover a chip for its meaning. */}
          <div role="radiogroup" aria-label="Filter by status" className="flex flex-wrap gap-2">
            <StatusChip
              selected={statusFilter === 'all'}
              onClick={() => changeStatusFilter('all')}
              label="All"
              count={devices.length}
            />
            {DEVICE_STATUS_ORDER.map(st => (
              <StatusChip
                key={st}
                selected={statusFilter === st}
                onClick={() => changeStatusFilter(st)}
                label={DEVICE_STATUS[st].longLabel}
                count={countByStatus[st]}
                color={DEVICE_STATUS[st].color}
                description={DEVICE_STATUS[st].description}
              />
            ))}
          </div>
        </div>

        <TableScroll>
          <table className={TABLE}>
            <thead>
              <tr className={THEAD_ROW}>
                <th className={TH}>Device</th>
                <th className={TH}>Resident</th>
                <th className={TH}>Install Location</th>
                <th className={TH}>Status</th>
                <th className={TH}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableBodySkeleton cols={5} rows={5} />
              ) : paginatedDevices.length === 0 ? (
                <TableEmpty colSpan={5}>
                    <p>
                      {q ? `No devices match “${searchQuery}”.` : statusFilter !== 'all' ? 'No devices with this status.' : 'No devices registered yet.'}
                    </p>
                    {/* Registration lives on the Devices page only; this is just a pointer for an empty fleet. */}
                    {devices.length === 0 && (
                      <Link to="/admin/devices?register=1" className="inline-block mt-2 text-xs font-bold text-primary hover:underline">
                        Register a device on the Devices page
                      </Link>
                    )}
                </TableEmpty>
              ) : (
                paginatedDevices.map((device) => {
                  const note = getStatusNote(device, device.status, now);
                  const isHighlighted = device.id === highlightedId;
                  const resident = residentNameByDevice[device.id];
                  return (
                    <tr
                      key={device.id}
                      data-device-id={device.id}
                      className={`${TR} ${isHighlighted ? 'bg-[#FFF5F2] outline outline-2 -outline-offset-2 outline-primary/40' : ''}`}
                    >
                      <td className={TD}>
                        <span className="block font-mono font-semibold text-xs text-[#1C1B1B] whitespace-nowrap">{device.device_code}</span>
                        {device.label && device.label !== device.device_code && (
                          <span className="block text-[11px] text-[#5B403D] max-w-[220px] leading-tight mt-0.5">{device.label}</span>
                        )}
                      </td>
                      <td className={TD}>
                        {resident
                          ? <span className="text-xs font-bold text-[#1C1B1B] whitespace-nowrap">{resident}</span>
                          : <span className="text-xs text-[#A1A1AA]">Not linked</span>}
                      </td>
                      <td className={TD}>
                        <span className="block text-xs text-[#5B403D] max-w-[260px] leading-tight">
                          {displayAddress(device.location_desc)}
                        </span>
                      </td>
                      <td className={TD}>
                        <div className="flex flex-col gap-1 items-start">
                          <StatusBadge status={device.status} />
                          {note && <span className="text-[10px] text-[#71717A] whitespace-nowrap">{note}</span>}
                          {batteryByDevice[device.id] && (
                            <span title="Running on backup battery" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#B45309] text-[9px] font-bold uppercase tracking-wide">
                              <BatteryWarning className="w-3 h-3" /> Battery
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={TD}>
                        <div className="flex items-center gap-3 text-[#A1A1AA]">
                          <Link to={`/admin/map?device=${device.id}`} className="hover:text-[#1C1B1B] transition-colors" title="Show on map"><MapIcon className="w-4 h-4" /></Link>
                          <Link to={`/admin/devices?edit=${device.id}`} className="hover:text-[#AF101A] transition-colors" title="Edit device (name, thresholds, location, firmware)"><Pencil className="w-4 h-4" /></Link>
                          <button onClick={() => handleTogglePower(device)} className={`transition-colors ${device.is_active ? 'hover:text-red-500' : 'text-red-400 hover:text-green-500'}`} title={device.is_active ? 'Disable device' : 'Enable device'}><Power className="w-4 h-4" /></button>
                          {device.activeAlert && (
                            <button onClick={() => handleResolveAlert(device)} className="hover:text-[#10B981] transition-colors" title="Manually Resolve Alert"><ShieldCheck className="w-4 h-4" /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TableScroll>

        <TablePager page={currentPage} pageSize={itemsPerPage} total={filteredDevices.length} onPageChange={setCurrentPage} />
      </div>
    </div>
  );
};

// ─── Helper Components ───

const StatCard = ({ label, value, icon, iconBg, valueClass }: {
  label: string;
  value: number;
  icon: React.ReactNode;
  iconBg: string;
  valueClass: string;
}) => (
  <div className="bg-[#F6F3F2] border border-[#E5E2E1] rounded-lg px-4 md:px-5 py-3 flex items-center gap-3 md:gap-4 min-w-0 md:min-w-[170px]">
    <div className={`w-8 h-8 rounded-full ${iconBg} flex items-center justify-center shrink-0`}>
      {icon}
    </div>
    <div>
      <p className="text-[#5B403D] font-bold text-[10px] tracking-[0.1em] uppercase whitespace-nowrap">{label}</p>
      <p className={`font-extrabold text-2xl leading-none mt-0.5 ${valueClass}`}>{value.toLocaleString()}</p>
    </div>
  </div>
);

// Same chip shape as the Users page filters, plus the status color dot.
const StatusChip = ({ selected, onClick, label, count, color, description }: {
  selected: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color?: string;
  description?: string;
}) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    onClick={onClick}
    title={description}
    className={`h-8 px-3 rounded-full border text-xs whitespace-nowrap inline-flex items-center gap-2 transition-colors ${
      selected
        ? 'bg-primary border-primary text-white font-bold'
        : 'bg-white border-[#E5E2E1] text-[#5B403D] font-semibold hover:border-[#A1A1AA] hover:text-[#1C1B1B]'
    }`}
  >
    {color && <span className={`w-2 h-2 rounded-full shrink-0 ${selected ? 'ring-2 ring-white/70' : ''}`} style={{ background: color }}></span>}
    {label}
    <span className={`font-bold tabular-nums ${selected ? 'text-white/80' : 'text-[#A1A1AA]'}`}>{count}</span>
  </button>
);

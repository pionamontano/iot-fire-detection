import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
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
  Filter,
  Plus,
  Pencil,
  Power,
  ShieldCheck,
  BatteryWarning,
  Search,
  X,
  Map as MapIcon,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { TableBodySkeleton } from '../../components/SkeletonLoaders';
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
  const [statusFilter, setStatusFilter] = useState<string>('all');
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
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

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

  const filterOptions = [
    { value: 'all', label: 'All Statuses' },
    ...DEVICE_STATUS_ORDER.map(st => ({ value: st, label: DEVICE_STATUS[st].longLabel })),
  ];

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const q = searchQuery.trim().toLowerCase();
  const filteredDevices = devices.filter(d =>
    (statusFilter === 'all' || d.status === statusFilter) &&
    (!q || [d.device_code, d.label, d.location_desc, residentNameByDevice[d.id]]
      .some(v => v?.toLowerCase().includes(q)))
  );
  const totalPages = Math.ceil(filteredDevices.length / itemsPerPage) || 1;
  const paginatedDevices = filteredDevices.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="space-y-8">
      {loadError && (
        <LoadErrorBanner what="devices and alerts" error={loadError} onRetry={fetchData} />
      )}
      {/* ─── Page Header & Stats Summary ─── */}
      <PageHeader
        title="System Overview"
        description="Real-time status tracking for all deployed IoT environmental sensors."
        actions={
        <div className="flex items-stretch gap-3 md:gap-4">
          {/* Critical Alerts */}
          <div className="bg-[#F6F3F2] border border-[#E5E2E1] rounded-lg px-5 py-3 flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-[rgba(220,38,38,0.1)] flex items-center justify-center shrink-0">
              <XCircle className="w-5 h-5 text-[#DC2626]" />
            </div>
            <div>
              <p className="text-[#5B403D] font-bold text-[10px] tracking-[0.1em] uppercase">Active Alerts</p>
              <p className={`font-extrabold text-2xl leading-none mt-0.5 ${activeAlertCount > 0 ? 'text-[#DC2626]' : 'text-[#1C1B1B]'}`}>
                {activeAlertCount.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Active Nodes */}
          <div className="bg-[#F6F3F2] border border-[#E5E2E1] rounded-lg px-5 py-3 flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-[rgba(16,185,129,0.1)] flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5 text-[#10B981]" />
            </div>
            <div>
              <p className="text-[#5B403D] font-bold text-[10px] tracking-[0.1em] uppercase">Online</p>
              <p className="font-extrabold text-2xl leading-none text-[#1C1B1B] mt-0.5">
                {onlineCount.toLocaleString()}
              </p>
            </div>
          </div>
        </div>
        }
      />

      {/* ─── Bento Grid: 8-col Table + 4-col Sidebar ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* ─── MAIN TABLE (8/12) ─── */}
        <div className="col-span-1 lg:col-span-8">
          <div className="bg-white border border-[#E5E2E1] rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.05)] overflow-hidden flex flex-col">
            {/* Table Header Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-[#E5E2E1]">
              <div className="flex items-center gap-3">
                <div className="text-[#DC2626]">
                  <List className="w-5 h-5" />
                </div>
                <h3 className="text-[#1C1B1B] font-bold text-sm tracking-[0.02em] whitespace-nowrap">
                  All Connected Devices
                </h3>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#A1A1AA]" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search ID, owner, location…"
                    aria-label="Search devices"
                    className="w-52 pl-8 pr-7 py-1.5 border border-[#E5E2E1] rounded text-xs text-[#1C1B1B] placeholder:text-[#A1A1AA] focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-[#A1A1AA] hover:text-[#1C1B1B]">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="relative" ref={filterRef}>
                  <button
                    onClick={() => setFilterOpen(f => !f)}
                    className="flex items-center gap-2 px-3 py-1.5 border border-[#E5E2E1] rounded text-[#1C1B1B] text-xs font-bold transition-colors hover:bg-gray-50 capitalize"
                  >
                    <Filter className="w-3.5 h-3.5" />
                    {filterOptions.find(o => o.value === statusFilter)?.label}
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${filterOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {filterOpen && (
                    <div className="absolute right-0 mt-1 w-44 bg-white border border-[#E5E2E1] rounded-lg shadow-lg z-50 py-1 animate-in fade-in slide-in-from-top-1">
                      {filterOptions.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => { setStatusFilter(opt.value); setFilterOpen(false); setCurrentPage(1); }}
                          className={`w-full text-left px-4 py-2 text-xs font-medium transition-colors ${statusFilter === opt.value
                              ? 'bg-[#FEE2E2] text-primary font-bold'
                              : 'text-[#1C1B1B] hover:bg-[#F6F3F2]'
                            }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Link to="/admin/devices?register=1" className="flex items-center gap-2 px-3 py-1.5 bg-primary rounded text-white text-xs font-bold transition-colors hover:bg-primary-dark">
                  <Plus className="w-3.5 h-3.5" />
                  Register New
                </Link>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F6F3F2] border-b border-[#E5E2E1]">
                    <th className="text-left px-5 py-4 text-[#5B403D] font-semibold text-[10px] tracking-[0.05em] uppercase whitespace-nowrap">Device UID</th>
                    <th className="text-left px-5 py-4 text-[#5B403D] font-semibold text-[10px] tracking-[0.05em] uppercase whitespace-nowrap">Owner Name</th>
                    <th className="text-left px-5 py-4 text-[#5B403D] font-semibold text-[10px] tracking-[0.05em] uppercase whitespace-nowrap">Location</th>
                    <th className="text-left px-5 py-4 text-[#5B403D] font-semibold text-[10px] tracking-[0.05em] uppercase whitespace-nowrap">Status</th>
                    <th className="text-left px-5 py-4 text-[#5B403D] font-semibold text-[10px] tracking-[0.05em] uppercase whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <TableBodySkeleton cols={5} rows={5} />
                  ) : paginatedDevices.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-16 text-[#A1A1AA]">
                        <p className="font-medium text-sm text-[#5B403D]">{q ? `No devices match “${searchQuery}”.` : 'No devices found.'}</p>
                      </td>
                    </tr>
                  ) : (
                    paginatedDevices.map((device) => {
                      const note = getStatusNote(device, device.status, now);
                      const isHighlighted = device.id === highlightedId;
                      return (
                        <tr
                          key={device.id}
                          data-device-id={device.id}
                          className={`border-b border-[#E5E2E1] last:border-0 hover:bg-[#FCF9F8] transition-colors ${isHighlighted ? 'bg-[#FFF5F2] outline outline-2 -outline-offset-2 outline-primary/40' : ''}`}
                        >
                          <td className="px-5 py-4 align-top">
                            <span className="font-mono font-semibold text-xs text-[#1C1B1B] whitespace-nowrap">
                              {device.device_code}
                            </span>
                          </td>
                          <td className="px-5 py-4 align-top">
                            {residentNameByDevice[device.id] ? (
                              <>
                                <span className="text-[#1C1B1B] text-xs font-bold block max-w-[120px] leading-tight">
                                  {residentNameByDevice[device.id]}
                                </span>
                                <span className="text-[#A1A1AA] text-[10px] block max-w-[120px] leading-tight mt-0.5">
                                  {device.label}
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="text-[#1C1B1B] text-xs font-bold block max-w-[120px] leading-tight">
                                  {device.label}
                                </span>
                                <span className="text-[#A1A1AA] text-[10px] block max-w-[120px] leading-tight mt-0.5">
                                  Unassigned
                                </span>
                              </>
                            )}
                          </td>
                          <td className="px-5 py-4 align-top">
                            <span className="text-[#5B403D] text-xs block max-w-[150px] leading-tight">
                              {displayAddress(device.location_desc)}
                            </span>
                          </td>
                          <td className="px-5 py-4 align-top">
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
                          <td className="px-5 py-4 align-top">
                            <div className="flex items-center gap-3 text-[#A1A1AA]">
                              <Link to={`/admin/map?device=${device.id}`} className="hover:text-[#1C1B1B] transition-colors" title="Show on map"><MapIcon className="w-4 h-4" /></Link>
                              <Link to={`/admin/devices?edit=${device.id}`} className="hover:text-[#1C1B1B] transition-colors" title="Edit device (name, thresholds, location, firmware)"><Pencil className="w-4 h-4" /></Link>
                              <button onClick={() => handleTogglePower(device)} className={`transition-colors ${device.is_active ? 'hover:text-red-500' : 'text-red-400 hover:text-green-500'}`} title="Toggle Active Status"><Power className="w-4 h-4" /></button>
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
            </div>

            {/* Table Footer / Pagination */}
            <div className="mt-auto p-5 border-t border-[#E5E2E1] flex items-center justify-between">
              <span className="text-[#A1A1AA] text-xs font-medium">
                Showing {Math.min(filteredDevices.length, (currentPage - 1) * itemsPerPage + 1)}-{Math.min(filteredDevices.length, currentPage * itemsPerPage)} of {filteredDevices.length} devices
              </span>
              <div className="flex items-center gap-1 text-xs font-medium">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="w-6 h-6 flex items-center justify-center text-[#A1A1AA] hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                {Array.from({ length: Math.min(3, totalPages) }).map((_, i) => {
                  // Simple moving window for pagination
                  let pageNum = i + 1;
                  if (totalPages > 3 && currentPage > 2) {
                    pageNum = currentPage - 1 + i;
                    if (pageNum > totalPages) pageNum = totalPages - (2 - i);
                  }

                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${currentPage === pageNum ? 'bg-[#DC2626] text-white font-bold' : 'text-[#5B403D] hover:bg-gray-100'
                        }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}

                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="w-6 h-6 flex items-center justify-center text-[#A1A1AA] hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ─── ASIDE SIDEBAR (4/12) ─── */}
        <div className="col-span-1 lg:col-span-4 flex flex-col gap-6">
          {/* Status Legend Card */}
          <div className="bg-[#F6F3F2] rounded-lg p-6 flex flex-col gap-6">
            <h4 className="text-[#A1A1AA] font-bold text-[10px] tracking-[0.1em] uppercase">
              Status Legend
            </h4>

            <div className="flex flex-col gap-6">
              {DEVICE_STATUS_ORDER.map(st => (
                <LegendRow key={st} color={DEVICE_STATUS[st].color} label={DEVICE_STATUS[st].longLabel} desc={DEVICE_STATUS[st].description} />
              ))}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
};

// ─── Helper Components ───

const LegendRow = ({ color, label, desc }: { color: string; label: string; desc: string }) => (
  <div className="flex items-start gap-3">
    <span className="w-2.5 h-2.5 rounded-full mt-1 shrink-0" style={{ background: color }}></span>
    <div className="flex-1">
      <span className="text-[#1C1B1B] font-bold text-xs leading-none">{label}</span>
      <p className="text-[#5B403D] text-[10px] leading-[15px] mt-1 pr-4">{desc}</p>
    </div>
  </div>
);
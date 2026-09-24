import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type { Device, AlertEvent } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';
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
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { TableBodySkeleton } from '../components/SkeletonLoaders';
import { getConnectivityStatus } from '../lib/deviceStatus';
import { useNowTick } from '../hooks/useNowTick';

type DeviceWithStatus = Device & {
  status: 'operational' | 'critical' | 'reconnecting' | 'maintenance' | 'offline';
  activeAlert?: AlertEvent;
};

const getDeviceStatus = (device: Device, activeAlerts: AlertEvent[], now: number): { status: DeviceWithStatus['status']; activeAlert?: AlertEvent } => {
  const alert = activeAlerts.find(a => a.device_id === device.id);
  if (alert) {
    return { status: 'critical', activeAlert: alert };
  }
  if (!device.is_active) return { status: 'offline' };
  const connectivity = getConnectivityStatus(device.last_seen_at, now);
  if (connectivity === 'offline') return { status: 'offline' };
  if (connectivity === 'reconnecting') return { status: 'reconnecting' };
  return { status: 'operational' };
};

const statusConfig = {
  operational: { label: 'Operational', color: '#10B981', dot: 'bg-[#10B981]' },
  critical: { label: 'Thermal Warning', color: '#DC2626', dot: 'bg-[#DC2626]' },
  reconnecting: { label: 'Reconnecting', color: '#F59E0B', dot: 'bg-[#F59E0B]' },
  maintenance: { label: 'Maintenance', color: '#F59E0B', dot: 'bg-[#F59E0B]' },
  offline: { label: 'Offline', color: '#A1A1AA', dot: 'bg-[#A1A1AA]' },
};

export const Alerts = () => {
  const [rawDevices, setRawDevices] = useState<Device[]>([]);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const now = useNowTick();
  // device_id -> latest on_battery (spec HW-1.5.2/SW-2.4.4 — previously
  // this indicator existed only on Resident/Responder views, never Admin)
  const [batteryByDevice, setBatteryByDevice] = useState<Record<string, boolean>>({});

  // New states for functionality
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [editingDevice, setEditingDevice] = useState<DeviceWithStatus | null>(null);
  const [editLabelValue, setEditLabelValue] = useState('');
  const itemsPerPage = 5;

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [devicesRes, alertsRes, batteryRes] = await Promise.all([
      supabase.from('devices').select('*').order('created_at', { ascending: false }),
      supabase.from('alert_events').select('*, devices(device_code, label, location_desc)').order('triggered_at', { ascending: false }),
      // Latest readings across devices, to derive each device's current
      // on_battery state (no per-device "latest reading" view exists, so
      // the most recent batch is reduced client-side below).
      supabase.from('sensor_readings')
        .select('device_id, on_battery, recorded_at')
        .order('recorded_at', { ascending: false })
        .limit(300),
    ]);

    setRawDevices(devicesRes.data || []);
    setAlerts((alertsRes.data || []) as unknown as AlertEvent[]);
    if (batteryRes.data) {
      const latestByDevice: Record<string, boolean> = {};
      for (const r of batteryRes.data) {
        if (!(r.device_id in latestByDevice)) latestByDevice[r.device_id] = r.on_battery;
      }
      setBatteryByDevice(latestByDevice);
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

    return () => {
      supabase.removeChannel(deviceSub);
      supabase.removeChannel(alertSub);
    };
  }, [fetchData]);

  const activeAlertCount = devices.filter(d => d.status === 'critical').length;
  const operationalCount = devices.filter(d => d.status === 'operational').length;
  const totalDevices = devices.length;

  const handleTogglePower = async (device: DeviceWithStatus) => {
    try {
      const updates: Record<string, unknown> = { is_active: !device.is_active };
      // When activating, set last_seen_at so status becomes 'Operational' instead of staying 'Offline'
      if (!device.is_active) {
        updates.last_seen_at = new Date().toISOString();
      }
      await supabase.from('devices').update(updates).eq('id', device.id);
      fetchData();
    } catch (err) {
      console.error('Error toggling power:', err);
    }
  };

  const handleEditLabel = (device: DeviceWithStatus) => {
    setEditingDevice(device);
    setEditLabelValue(device.label);
  };

  const saveEditLabel = async () => {
    if (editingDevice && editLabelValue.trim() !== '') {
      try {
        await supabase.from('devices').update({ label: editLabelValue.trim() }).eq('id', editingDevice.id);
        fetchData();
      } catch (err) {
        console.error('Error updating label:', err);
      }
    }
    setEditingDevice(null);
  };

  // Manual resolve fallback (spec SW-2.1.6) — e.g. for a device that went
  // offline mid-alert and can no longer auto-resolve via a safe reading.
  const handleResolveAlert = async (device: DeviceWithStatus) => {
    if (!device.activeAlert) return;
    if (!window.confirm(`Resolve the active alert for ${device.device_code}? This should only be done once the reported condition is confirmed cleared.`)) {
      return;
    }
    try {
      await supabase
        .from('alert_events')
        .update({ resolved_at: new Date().toISOString() })
        .eq('id', device.activeAlert.id);
      fetchData();
    } catch (err) {
      console.error('Error resolving alert:', err);
    }
  };

  const filterOptions = [
    { value: 'all', label: 'All Statuses' },
    { value: 'operational', label: 'Operational' },
    { value: 'critical', label: 'Thermal Warning' },
    { value: 'reconnecting', label: 'Reconnecting' },
    { value: 'maintenance', label: 'Maintenance' },
    { value: 'offline', label: 'Offline' },
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

  const filteredDevices = devices.filter(d => statusFilter === 'all' || d.status === statusFilter);
  const totalPages = Math.ceil(filteredDevices.length / itemsPerPage) || 1;
  const paginatedDevices = filteredDevices.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="space-y-8">
      {/* ─── Page Header & Stats Summary ─── */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-[#1C1B1B] font-extrabold text-[40px] leading-9 tracking-[-0.019em]">
            System Overview
          </h2>
          <p className="text-[#5B403D] text-base leading-6 mt-2">
            Real-time status tracking for all deployed IoT environmental sensors.
          </p>
        </div>

        {/* Summary Badges */}
        <div className="flex items-stretch gap-4 shrink-0">
          {/* Critical Alerts */}
          <div className="bg-[#F6F3F2] border border-[#E5E2E1] rounded-lg px-5 py-3 flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-[rgba(220,38,38,0.1)] flex items-center justify-center shrink-0">
              <XCircle className="w-5 h-5 text-[#DC2626]" />
            </div>
            <div>
              <p className="text-[#5B403D] font-bold text-[10px] tracking-[0.1em] uppercase">Critical Alerts</p>
              <p className="font-extrabold text-2xl leading-none text-[#DC2626] mt-0.5">
                {activeAlertCount.toString().padStart(2, '0')}
              </p>
            </div>
          </div>

          {/* Active Nodes */}
          <div className="bg-[#F6F3F2] border border-[#E5E2E1] rounded-lg px-5 py-3 flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-[rgba(16,185,129,0.1)] flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5 text-[#10B981]" />
            </div>
            <div>
              <p className="text-[#5B403D] font-bold text-[10px] tracking-[0.1em] uppercase">Active Nodes</p>
              <p className="font-extrabold text-2xl leading-none text-[#1C1B1B] mt-0.5">
                {operationalCount.toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Bento Grid: 8-col Table + 4-col Sidebar ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* ─── MAIN TABLE (8/12) ─── */}
        <div className="col-span-1 lg:col-span-8">
          <div className="bg-white border border-[#E5E2E1] rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.05)] overflow-hidden flex flex-col">
            {/* Table Header Bar */}
            <div className="flex items-center justify-between p-5 border-b border-[#E5E2E1]">
              <div className="flex items-center gap-3">
                <div className="text-[#DC2626]">
                  <List className="w-5 h-5" />
                </div>
                <h3 className="text-[#1C1B1B] font-bold text-sm tracking-[0.02em]">
                  All Connected Devices
                </h3>
              </div>

              <div className="flex items-center gap-3">
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
                              ? 'bg-[#FEE2E2] text-[#DC2626] font-bold'
                              : 'text-[#1C1B1B] hover:bg-[#F6F3F2]'
                            }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Link to="/admin/devices" className="flex items-center gap-2 px-3 py-1.5 bg-[#DC2626] rounded text-white text-xs font-bold transition-colors hover:bg-[#B91C1C]">
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
                        <p className="font-medium text-sm text-[#5B403D]">No devices found.</p>
                      </td>
                    </tr>
                  ) : (
                    paginatedDevices.map((device) => {
                      const cfg = statusConfig[device.status];
                      return (
                        <tr key={device.id} className="border-b border-[#E5E2E1] last:border-0 hover:bg-[#FCF9F8] transition-colors">
                          <td className="px-5 py-4 align-top">
                            <span className="font-bold text-xs text-[#1C1B1B] break-words whitespace-pre-wrap max-w-[80px] block">
                              {device.device_code.replace('-', '-\n')}
                            </span>
                          </td>
                          <td className="px-5 py-4 align-top">
                            <span className="text-[#1C1B1B] text-xs font-bold block max-w-[120px] leading-tight">
                              {device.label}
                            </span>
                          </td>
                          <td className="px-5 py-4 align-top">
                            <span className="text-[#5B403D] text-xs block max-w-[150px] leading-tight">
                              {device.location_desc}
                            </span>
                          </td>
                          <td className="px-5 py-4 align-top">
                            <div className="flex flex-col gap-1 items-start">
                              <span className="inline-flex items-center gap-1.5 text-xs font-bold" style={{ color: cfg.color }}>
                                <span className={`w-2 h-2 rounded-full ${cfg.dot}`}></span>
                                {cfg.label}
                              </span>
                              {batteryByDevice[device.id] && (
                                <span title="Running on backup battery" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#B45309] text-[9px] font-bold uppercase tracking-wide">
                                  <BatteryWarning className="w-3 h-3" /> Battery
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-4 align-top">
                            <div className="flex items-center gap-3 text-[#A1A1AA]">
                              <button onClick={() => handleEditLabel(device)} className="hover:text-[#1C1B1B] transition-colors" title="Rename Device"><Pencil className="w-4 h-4" /></button>
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
              <LegendRow dot="bg-[#DC2626]" label="Critical Alarm" desc="Thermal threshold exceeded or smoke detected. Immediate response required." />
              <LegendRow dot="bg-[#F59E0B]" label="Reconnecting" desc="No telemetry for 2–15 minutes. Connection may be recovering." />
              <LegendRow dot="bg-[#F59E0B]" label="Maintenance" desc="Sensor degradation detected or calibration cycle pending." />
              <LegendRow dot="bg-[#10B981]" label="Operational" desc="System healthy. Environment within safe operational parameters." />
              <LegendRow dot="bg-[#A1A1AA]" label="Offline" desc="No telemetry for over 15 minutes, or never connected." />
            </div>
          </div>

          {/* Visual Highlight Card: Geospatial Awareness */}
          <Link to="/admin/map" className="group relative rounded-lg overflow-hidden h-[180px] shadow-sm flex items-end p-5 transition-transform hover:scale-[1.02]">
            {/* Background image placeholder - using CSS gradient to mimic dark map */}
            <div className="absolute inset-0 bg-gradient-to-tr from-[#1C1B1B] to-[#3B2D2C] opacity-90"></div>
            {/* Grid overlay for map feel */}
            <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>

            <div className="relative z-10 w-full">
              <p className="text-white/70 font-bold text-[10px] tracking-[0.1em] uppercase mb-1">Geospatial Awareness</p>
              <h3 className="text-white font-extrabold text-lg leading-tight mb-2">Active Coverage Map</h3>
              <div className="flex items-center gap-1.5 text-[#DC2626] font-bold text-xs uppercase tracking-[0.05em] group-hover:text-red-400 transition-colors">
                View Full Map <ExternalLink className="w-3.5 h-3.5" />
              </div>
            </div>
          </Link>
        </div>

      </div>

      {/* Edit Label Modal */}
      {editingDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditingDevice(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-[#1C1B1B] font-extrabold text-xl mb-2">Edit Device Label</h3>
            <p className="text-[#5B403D] text-sm mb-4">Update the display name for <span className="font-bold">{editingDevice.device_code}</span></p>
            <input
              type="text"
              value={editLabelValue}
              onChange={(e) => setEditLabelValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveEditLabel()}
              className="w-full border border-[#E5E2E1] rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#DC2626]/30 focus:border-[#DC2626] mb-6"
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setEditingDevice(null)}
                className="px-4 py-2 text-sm font-bold text-[#5B403D] hover:bg-[#F6F3F2] rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveEditLabel}
                className="px-4 py-2 text-sm font-bold text-white bg-[#DC2626] hover:bg-[#B91C1C] rounded transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Helper Components ───

const LegendRow = ({ dot, label, desc }: { dot: string; label: string; desc: string }) => (
  <div className="flex items-start gap-3">
    <span className={`w-2.5 h-2.5 rounded-full ${dot} mt-1 shrink-0`}></span>
    <div className="flex-1">
      <span className="text-[#1C1B1B] font-bold text-xs leading-none">{label}</span>
      <p className="text-[#5B403D] text-[10px] leading-[15px] mt-1 pr-4">{desc}</p>
    </div>
  </div>
);
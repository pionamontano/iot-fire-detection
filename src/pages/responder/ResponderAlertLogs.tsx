import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import type { Device } from '../../lib/supabase';
import { TableBodySkeleton } from '../../components/SkeletonLoaders';
import { TABLE_CARD, TABLE, THEAD_ROW, TH, TR, TD, TableScroll, TableEmpty, TablePager } from '../../components/Table';
import { useSearchParams } from 'react-router-dom';
import {
  Download,
  Eye,
  AlertTriangle,
  Shield,
  Zap,
  RotateCcw,
} from 'lucide-react';

type TelemetryStatus = 'FIRE ALERT (CRITICAL)' | 'ELEVATED TEMP' | 'OPTIMAL' | 'OFFLINE / MAINT';

type LogRow = {
  id: string;
  timestamp: string;
  deviceName: string;
  location: string;
  status: TelemetryStatus;
  isCritical: boolean;
  tempCelsius: number | null;
  coPpm: number | null;
  resolvedAt: string | null;
  acknowledgedAt: string | null;
};

const statusConfig: Record<TelemetryStatus, { color: string; dot: string }> = {
  'FIRE ALERT (CRITICAL)': { color: '#DC2626', dot: 'bg-[#DC2626]' },
  'ELEVATED TEMP': { color: '#F59E0B', dot: 'bg-[#F59E0B]' },
  'OPTIMAL': { color: '#10B981', dot: 'bg-[#10B981]' },
  'OFFLINE / MAINT': { color: '#A1A1AA', dot: 'bg-[#A1A1AA]' },
};

const statusFilterColors = [
  { key: 'all', bg: 'bg-[#1C1B1B]', label: 'All' },
  { key: 'FIRE ALERT (CRITICAL)', bg: 'bg-[#DC2626]', label: 'Critical' },
  { key: 'ELEVATED TEMP', bg: 'bg-[#F59E0B]', label: 'Elevated' },
  { key: 'OPTIMAL', bg: 'bg-[#10B981]', label: 'Optimal' },
  { key: 'OFFLINE / MAINT', bg: 'bg-[#A1A1AA]', label: 'Offline' },
];

export const ResponderAlertLogs = () => {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('all');
  // ?device=<code> comes from the header device search: show that device's
  // whole history rather than only the last 24 hours.
  const [searchParams] = useSearchParams();
  const deviceParam = searchParams.get('device');
  const [dateFilter, setDateFilter] = useState(deviceParam ? 'All Time' : 'Last 24 Hours');
  const [deviceFilter, setDeviceFilter] = useState(deviceParam ?? 'All Devices');
  useEffect(() => {
    if (!deviceParam) return;
    setDeviceFilter(deviceParam);
    setDateFilter('All Time');
    setCurrentPage(1);
  }, [deviceParam]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [avgResponseSeconds, setAvgResponseSeconds] = useState<number | null>(null);
  const [selectedLog, setSelectedLog] = useState<LogRow | null>(null);
  const itemsPerPage = 15;

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [alertsRes, devicesRes] = await Promise.all([
        supabase
          .from('alert_events')
          .select('*, devices(device_code, label, location_desc, is_active)')
          .order('triggered_at', { ascending: false })
          .limit(200),
        supabase.from('devices_safe').select('*').order('created_at', { ascending: false }),
      ]);

      const allDevices = devicesRes.data || [];
      setDevices(allDevices);

      const allLogs: LogRow[] = [];

      // Map alert events to log rows
      (alertsRes.data || []).forEach((alert: any) => {
        const deviceName = alert.devices?.device_code || 'Unknown';
        const location = alert.devices?.location_desc || 'Unknown';
        let status: TelemetryStatus = 'OPTIMAL';
        if (!alert.resolved_at) {
          status = alert.alert_tier === 2 ? 'FIRE ALERT (CRITICAL)' : 'ELEVATED TEMP';
        }

        allLogs.push({
          id: `alert-${alert.id}`,
          timestamp: alert.triggered_at,
          deviceName,
          location,
          status,
          isCritical: status === 'FIRE ALERT (CRITICAL)',
          tempCelsius: alert.temp_celsius ?? null,
          coPpm: alert.co_ppm ?? null,
          resolvedAt: alert.resolved_at ?? null,
          acknowledgedAt: alert.acknowledged_at ?? null,
        });
      });

      // Sort by timestamp desc
      allLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setLogs(allLogs);

      // Real average response time (trigger -> first acknowledgement), not a
      // placeholder - computed only from alerts that have actually been
      // acknowledged, so it's honest about there being no data yet.
      const responseDurations = (alertsRes.data || [])
        .filter((a: any) => a.acknowledged_at)
        .map((a: any) => (new Date(a.acknowledged_at).getTime() - new Date(a.triggered_at).getTime()) / 1000)
        .filter((seconds: number) => seconds >= 0);
      setAvgResponseSeconds(
        responseDurations.length > 0
          ? responseDurations.reduce((sum: number, s: number) => sum + s, 0) / responseDurations.length
          : null
      );
    } catch (err) {
      console.error('Error fetching alert logs:', err);
    }
    setLoading(false);
  };

  const filteredLogs = useMemo(() => {
    let filtered = logs;
    if (statusFilter !== 'all') {
      filtered = filtered.filter(l => l.status === statusFilter);
    }
    if (deviceFilter !== 'All Devices') {
      filtered = filtered.filter(l => l.deviceName === deviceFilter);
    }
    if (dateFilter !== 'All Time') {
      const rangeMs = dateFilter === 'Last 24 Hours' ? 24 * 60 * 60 * 1000
        : dateFilter === 'Last 7 Days' ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000; // Last 30 Days
      const cutoff = Date.now() - rangeMs;
      filtered = filtered.filter(l => new Date(l.timestamp).getTime() >= cutoff);
    }
    return filtered;
  }, [logs, statusFilter, deviceFilter, dateFilter]);

  const paginatedLogs = filteredLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const unresolvedCount = logs.filter(l => l.status === 'FIRE ALERT (CRITICAL)' || l.status === 'ELEVATED TEMP').length;

  const handleReset = () => {
    setStatusFilter('all');
    setDateFilter('Last 24 Hours');
    setDeviceFilter('All Devices');
    setCurrentPage(1);
  };

  const handleExport = () => {
    const headers = ['Timestamp', 'Device Name', 'Location', 'Telemetry Status'];
    const csvContent = [
      headers.join(','),
      ...filteredLogs.map(log =>
        `"${log.timestamp}","${log.deviceName}","${log.location}","${log.status}"`
      ),
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `alert_history_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-8 pb-10">
      {/* ─── Page Header ─── */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-[#1C1B1B] font-extrabold text-[40px] leading-9 tracking-[-0.019em]">
            Fire Responder Alert Logs
          </h2>
          <p className="text-[#5B403D] text-base leading-6 mt-2 max-w-[600px]">
            Incident history logs and historical telemetry from {devices.length.toLocaleString()} distributed thermal nodes.
          </p>
        </div>
        <button
          onClick={handleExport}
          className="bg-primary px-5 py-2.5 rounded flex items-center gap-2 hover:bg-primary-dark transition-colors shrink-0"
        >
          <Download className="w-4 h-4 text-white" />
          <span className="text-white font-bold text-xs tracking-[0.02em]">Export Incident History</span>
        </button>
      </div>

      {/* ─── Filters Row ─── */}
      <div className="flex flex-wrap items-end gap-6">
        {/* Date Range */}
        <div>
          <span className="text-[#5B403D] font-bold text-[10px] tracking-[0.05em] uppercase block mb-2">Date Range</span>
          <select
            value={dateFilter}
            onChange={e => { setDateFilter(e.target.value); setCurrentPage(1); }}
            className="bg-white border border-[#E5E2E1] rounded px-4 py-2 text-sm text-[#1C1B1B] focus:outline-none focus:border-[#DC2626]/40 min-w-[180px]"
          >
            <option>Last 24 Hours</option>
            <option>Last 7 Days</option>
            <option>Last 30 Days</option>
            <option>All Time</option>
          </select>
        </div>

        {/* Device Node */}
        <div>
          <span className="text-[#5B403D] font-bold text-[10px] tracking-[0.05em] uppercase block mb-2">Device Node</span>
          <select
            value={deviceFilter}
            onChange={e => { setDeviceFilter(e.target.value); setCurrentPage(1); }}
            className="bg-white border border-[#E5E2E1] rounded px-4 py-2 text-sm text-[#1C1B1B] focus:outline-none focus:border-[#DC2626]/40 min-w-[180px]"
          >
            <option>All Devices</option>
            {devices.map(d => (
              <option key={d.id} value={d.device_code}>{d.device_code}</option>
            ))}
          </select>
        </div>

        {/* Status Protocol */}
        <div>
          <span className="text-[#5B403D] font-bold text-[10px] tracking-[0.05em] uppercase block mb-2">Status Protocol</span>
          <div className="flex items-center gap-2">
            {statusFilterColors.map(sf => (
              <button
                key={sf.key}
                onClick={() => { setStatusFilter(sf.key); setCurrentPage(1); }}
                className={`w-8 h-8 rounded-full ${sf.bg} transition-all ${
                  statusFilter === sf.key ? 'ring-2 ring-offset-2 ring-[#1C1B1B] scale-110' : 'opacity-60 hover:opacity-100'
                }`}
                title={sf.label}
              />
            ))}
          </div>
        </div>

        {/* Reset */}
        <button onClick={handleReset} className="flex items-center gap-1.5 text-[#5B403D] text-xs font-bold hover:text-[#DC2626] transition-colors pb-2">
          <RotateCcw className="w-3 h-3" />
          Reset
        </button>
      </div>

      {/* ─── Data Table ─── */}
      <div className={TABLE_CARD}>
        <TableScroll>
          <table className={TABLE}>
            <thead>
              <tr className={THEAD_ROW}>
                <th className={TH}>Timestamp</th>
                <th className={TH}>Device Name</th>
                <th className={TH}>Location</th>
                <th className={TH}>Telemetry Status</th>
                <th className={`${TH} !text-center`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableBodySkeleton cols={5} rows={5} />
              ) : paginatedLogs.length === 0 ? (
                <TableEmpty colSpan={5}>No records found.</TableEmpty>
              ) : (
                paginatedLogs.map(log => {
                  const cfg = statusConfig[log.status];
                  const d = new Date(log.timestamp);
                  const timeStr = d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(2, '0').substring(0, 2);
                  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();

                  return (
                    <tr key={log.id} className={TR}>
                      <td className={TD}>
                        <div className="flex flex-col">
                          <span className={`font-mono text-xs font-bold ${log.isCritical ? 'text-[#DC2626]' : 'text-[#1C1B1B]'}`}>
                            {timeStr}
                          </span>
                          <span className="text-[10px] text-[#A1A1AA] mt-0.5">{dateStr}</span>
                        </div>
                      </td>
                      <td className={TD}>
                        <span className="text-[#1C1B1B] font-bold text-xs">{log.deviceName}</span>
                      </td>
                      <td className={TD}>
                        <span className="text-[#5B403D] text-xs">{log.location}</span>
                      </td>
                      <td className={TD}>
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold" style={{ color: cfg.color }}>
                          <span className={`w-2 h-2 rounded-full ${cfg.dot}`}></span>
                          {log.status}
                        </span>
                      </td>
                      <td className={`${TD} text-center`}>
                        <button
                          onClick={() => setSelectedLog(log)}
                          title="View details"
                          aria-label={`View details for ${log.deviceName} at ${dateStr} ${timeStr}`}
                          className="text-[#A1A1AA] hover:text-[#1C1B1B] transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TableScroll>
        <TablePager page={currentPage} pageSize={itemsPerPage} total={filteredLogs.length} onPageChange={setCurrentPage} />
      </div>

      {/* ─── Footer Summary Cards ─── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Unresolved Alarms */}
        <div className="bg-[#F6F3F2] rounded-lg p-6 flex items-center gap-5 relative overflow-visible group hover:bg-[#F2EDEC] transition-colors cursor-help">
          {/* Tooltip */}
          <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-[#1C1B1B] text-white text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
            Active alerts that have not been resolved yet
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1C1B1B]"></div>
          </div>
          <div className="w-12 h-12 bg-[#FEE2E2] rounded-lg flex items-center justify-center shrink-0">
            <AlertTriangle className="w-6 h-6 text-[#DC2626]" />
          </div>
          <div>
            <p className="text-[#1C1B1B] font-extrabold text-3xl leading-none">
              {String(unresolvedCount).padStart(2, '0')}
            </p>
            <p className="text-[#DC2626] font-bold text-[10px] tracking-[0.1em] uppercase mt-1">
              Unresolved Alarms
            </p>
          </div>
        </div>

        {/* Network Integrity */}
        <div className="bg-[#F6F3F2] rounded-lg p-6 flex items-center gap-5 relative overflow-visible group hover:bg-[#F2EDEC] transition-colors cursor-help">
          {/* Tooltip */}
          <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-[#1C1B1B] text-white text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
            Percentage of devices currently online and reporting
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1C1B1B]"></div>
          </div>
          <div className="w-12 h-12 bg-[#ECFDF5] rounded-lg flex items-center justify-center shrink-0">
            <Shield className="w-6 h-6 text-[#10B981]" />
          </div>
          <div>
            <p className="text-[#1C1B1B] font-extrabold text-3xl leading-none">
              {devices.length > 0 ? `${((devices.filter(d => d.is_active).length / devices.length) * 100).toFixed(1)}%` : '0%'}
            </p>
            <p className="text-[#10B981] font-bold text-[10px] tracking-[0.1em] uppercase mt-1">
              Network Integrity
            </p>
          </div>
        </div>

        {/* Avg Response Time */}
        <div className="bg-[#F6F3F2] rounded-lg p-6 flex items-center gap-5 relative overflow-visible group hover:bg-[#F2EDEC] transition-colors cursor-help">
          {/* Tooltip */}
          <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-[#1C1B1B] text-white text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
            Average time from alert trigger to first responder action
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1C1B1B]"></div>
          </div>
          <div className="w-12 h-12 bg-[#E0F2FE] rounded-lg flex items-center justify-center shrink-0">
            <Zap className="w-6 h-6 text-[#0284C7]" />
          </div>
          <div>
            <p className="text-[#1C1B1B] font-extrabold text-3xl leading-none">
              {avgResponseSeconds !== null ? `${avgResponseSeconds.toFixed(1)}s` : '—'}
            </p>
            <p className="text-[#0284C7] font-bold text-[10px] tracking-[0.1em] uppercase mt-1">
              Avg Response Time
            </p>
          </div>
        </div>
      </div>

      {/* Log Detail Modal */}
      {selectedLog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelectedLog(null)}
        >
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[#1C1B1B] font-extrabold text-xl">Alert Detail</h3>
              <button onClick={() => setSelectedLog(null)} className="text-[#A1A1AA] hover:text-[#1C1B1B] transition-colors" aria-label="Close">
                &times;
              </button>
            </div>
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[#5B403D] font-bold uppercase text-[10px] tracking-wider">Device</span>
                <span className="text-[#1C1B1B] font-bold">{selectedLog.deviceName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#5B403D] font-bold uppercase text-[10px] tracking-wider">Location</span>
                <span className="text-[#1C1B1B]">{selectedLog.location}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#5B403D] font-bold uppercase text-[10px] tracking-wider">Status</span>
                <span className="font-bold" style={{ color: statusConfig[selectedLog.status].color }}>{selectedLog.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#5B403D] font-bold uppercase text-[10px] tracking-wider">Triggered</span>
                <span className="text-[#1C1B1B]">{new Date(selectedLog.timestamp).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#5B403D] font-bold uppercase text-[10px] tracking-wider">Temperature</span>
                <span className="text-[#1C1B1B]">{selectedLog.tempCelsius !== null ? `${selectedLog.tempCelsius}°C` : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#5B403D] font-bold uppercase text-[10px] tracking-wider">CO Level</span>
                <span className="text-[#1C1B1B]">{selectedLog.coPpm !== null ? `${selectedLog.coPpm}ppm` : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#5B403D] font-bold uppercase text-[10px] tracking-wider">Acknowledged</span>
                <span className="text-[#1C1B1B]">{selectedLog.acknowledgedAt ? new Date(selectedLog.acknowledgedAt).toLocaleString() : 'Not yet'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#5B403D] font-bold uppercase text-[10px] tracking-wider">Resolved</span>
                <span className="text-[#1C1B1B]">{selectedLog.resolvedAt ? new Date(selectedLog.resolvedAt).toLocaleString() : 'Not yet'}</span>
              </div>
            </div>
            <div className="flex justify-end mt-6">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 text-sm font-bold text-white bg-[#1C1B1B] hover:bg-black rounded transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

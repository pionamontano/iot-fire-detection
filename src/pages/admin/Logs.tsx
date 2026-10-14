import React, { useEffect, useState, useMemo, useRef } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { supabase } from '../../lib/supabase';
import type { Device } from '../../lib/supabase';
import { DEVICE_COLUMNS } from '../../lib/deviceColumns';
import { LoadErrorBanner } from '../../components/LoadErrorBanner';
import type { LoadErrorInfo } from '../../components/LoadErrorBanner';
import { Download, ChevronDown, AlertTriangle, Zap, History, Filter } from 'lucide-react';
import { TableBodySkeleton } from '../../components/SkeletonLoaders';
import { TABLE_CARD, TABLE, THEAD_ROW, TH, TR, TD, TableScroll, TableEmpty, TablePager, TABLE_PAGE_SIZE } from '../../components/Table';

type LogEvent = {
  id: string;
  timestamp: string;
  type: 'Fire Alert' | 'User Action' | 'Device Reg' | 'Login';
  initiator: string;
  description: string;
  status: 'CRITICAL' | 'INFO' | 'WARNING' | 'RESOLVED';
};

const eventConfig = {
  'Fire Alert': { dot: 'bg-[#DC2626]', text: 'text-[#DC2626]' },
  'User Action': { dot: 'bg-[#00799C]', text: 'text-[#00799C]' },
  'Device Reg': { dot: 'bg-[#A1A1AA]', text: 'text-[#5B403D]' },
  'Login': { dot: 'bg-[#1C1B1B]', text: 'text-[#1C1B1B]' },
};

const statusBadgeConfig = {
  CRITICAL: { bg: 'bg-[#FEE2E2]', text: 'text-[#DC2626]' },
  INFO: { bg: 'bg-[#E0F2FE]', text: 'text-[#0284C7]' },
  WARNING: { bg: 'bg-[#FFEDD5]', text: 'text-[#EA580C]' },
  RESOLVED: { bg: 'bg-[#F3F4F6]', text: 'text-[#6B7280]' },
};

export const Logs = () => {
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('All Event Types');
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<LoadErrorInfo | null>(null);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);

    try {
      // 1. Fetch Alert Events
      const { data: alerts } = await supabase
        .from('alert_events')
        .select('*, devices(device_code, location_desc)')
        .order('triggered_at', { ascending: false })
        .limit(50);

      // 2. Fetch Login Attempts
      const { data: logins } = await supabase
        .from('login_attempts')
        .select('*')
        .order('attempted_at', { ascending: false })
        .limit(50);

      // 3. Fetch Device Registrations
      const { data: devices, error: devicesError } = await supabase
        .from('devices')
        .select<string, Device>(DEVICE_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(50);

      // A failed read must be visible: otherwise device-registration entries silently disappear.
      setLoadError(devicesError ? { message: devicesError.message, code: devicesError.code } : null);

      const allLogs: LogEvent[] = [];

      // Map Alerts
      // Describe only what the data shows: the units measure CO and
      // temperature (no smoke sensor), and nothing triggers suppression.
      alerts?.forEach(alert => {
        const deviceCode = (alert.devices as any)?.device_code || 'Unknown device';
        const location = (alert.devices as any)?.location_desc || 'an unknown location';
        const kind = alert.alert_tier === 2
          ? 'Tier 2 fire alert (CO and temperature thresholds exceeded)'
          : 'Tier 1 warning (CO or temperature threshold exceeded)';
        allLogs.push({
          id: `alert-${alert.id}`,
          timestamp: alert.triggered_at,
          type: 'Fire Alert',
          initiator: deviceCode,
          description: `${kind} at ${location}. CO ${alert.co_ppm} ppm, ${alert.temp_celsius}°C.`,
          status: alert.resolved_at ? 'RESOLVED' : 'CRITICAL',
        });
        if (alert.resolved_at) {
          const autoCleared = alert.resolution_source === 'device';
          allLogs.push({
            id: `alert-res-${alert.id}`,
            timestamp: alert.resolved_at,
            type: autoCleared ? 'Fire Alert' : 'User Action',
            initiator: autoCleared
              ? deviceCode
              : alert.resolution_source === 'responder' ? 'BFP Responder'
              : alert.resolution_source === 'admin' ? 'Admin'
              : 'System',
            description: autoCleared
              ? `Readings back below thresholds at ${location}; incident auto-resolved.`
              : `Incident at ${location} marked as resolved.`,
            status: 'INFO',
          });
        }
      });

      // Map Logins
      logins?.forEach(login => {
        allLogs.push({
          id: `login-${login.id}`,
          timestamp: login.attempted_at,
          type: 'Login',
          initiator: login.email,
          description: login.success 
            ? `Authenticated session established from IP address [${login.ip_address || 'Unknown'}].`
            : `Failed authentication attempt from IP address [${login.ip_address || 'Unknown'}]. Flagged for review.`,
          status: login.success ? 'INFO' : 'WARNING',
        });
      });

      // Map Devices
      devices?.forEach(device => {
        allLogs.push({
          id: `device-${device.id}`,
          timestamp: device.created_at,
          type: 'Device Reg',
          initiator: 'Admin',
          description: `Device ${device.device_code} registered${device.location_desc ? ` at ${device.location_desc}` : ' (location not set yet)'}.`,
          status: 'INFO',
        });
      });

      // Sort all combined logs by timestamp descending
      allLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      setLogs(allLogs);
    } catch (error) {
      console.error("Error fetching logs:", error);
    }

    setLoading(false);
  };

  const filteredLogs = useMemo(() => {
    if (eventTypeFilter === 'All Event Types') return logs;
    return logs.filter(log => log.type === eventTypeFilter);
  }, [logs, eventTypeFilter]);

  const paginatedLogs = useMemo(() => {
    const startIndex = (currentPage - 1) * TABLE_PAGE_SIZE;
    return filteredLogs.slice(startIndex, startIndex + TABLE_PAGE_SIZE);
  }, [filteredLogs, currentPage]);


  const eventTypeOptions = ['All Event Types', 'Fire Alert', 'User Action', 'Device Reg', 'Login'];

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

  const handleExport = () => {
    const headers = ['Timestamp', 'Event Type', 'Initiator', 'Description', 'Status'];
    const csvContent = [
      headers.join(','),
      ...filteredLogs.map(log => 
        `"${log.timestamp}","${log.type}","${log.initiator}","${log.description.replace(/"/g, '""')}","${log.status}"`
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `system_audit_log_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-8 pb-10">
      {loadError && (
        <LoadErrorBanner what="device registration entries" error={loadError} onRetry={fetchLogs} />
      )}
      {/* ─── Page Header ─── */}
      <PageHeader
        title="System Log"
        description="A chronological record of events, alerts, and user actions."
        actions={
        <div className="flex items-center gap-4">
          <div className="relative" ref={filterRef}>
            <button 
              onClick={() => setFilterOpen(f => !f)}
              className="bg-[#F6F3F2] px-4 py-2.5 rounded flex items-center gap-3 hover:bg-gray-200 transition-colors"
            >
              <Filter className="w-4 h-4 text-[#5B403D]" />
              <span className="text-[#1C1B1B] font-bold text-xs tracking-[0.02em]">{eventTypeFilter}</span>
              <ChevronDown className={`w-4 h-4 text-[#5B403D] transition-transform ${filterOpen ? 'rotate-180' : ''}`} />
            </button>
            {filterOpen && (
              <div className="absolute right-0 mt-1 w-48 bg-white border border-[#E5E2E1] rounded-lg shadow-lg z-50 py-1">
                {eventTypeOptions.map(opt => (
                  <button
                    key={opt}
                    onClick={() => { setEventTypeFilter(opt); setFilterOpen(false); setCurrentPage(1); }}
                    className={`w-full text-left px-4 py-2 text-xs font-medium transition-colors ${
                      eventTypeFilter === opt
                        ? 'bg-[#FEE2E2] text-[#DC2626] font-bold'
                        : 'text-[#1C1B1B] hover:bg-[#F6F3F2]'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>
          
          <button 
            onClick={handleExport}
            className="bg-primary px-5 py-2.5 rounded-lg flex items-center gap-2 hover:bg-primary-dark transition-colors"
          >
            <Download className="w-4 h-4 text-white" />
            <span className="text-white font-bold text-xs tracking-[0.02em]">Export Logs</span>
          </button>
        </div>
        }
      />

      {/* ─── Main Log Table ─── */}
      <div className={TABLE_CARD}>
        <TableScroll>
          <table className={TABLE}>
            <thead>
              <tr className={THEAD_ROW}>
                <th className={`${TH} w-[15%]`}>Timestamp</th>
                <th className={`${TH} w-[15%]`}>Event Type</th>
                <th className={`${TH} w-[20%]`}>Initiator</th>
                <th className={`${TH} w-[40%]`}>Description</th>
                <th className={`${TH} w-[10%] !text-right`}>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableBodySkeleton cols={5} rows={5} />
              ) : paginatedLogs.length === 0 ? (
                <TableEmpty colSpan={5}>No logs found.</TableEmpty>
              ) : (
                paginatedLogs.map((log) => {
                  const cfg = eventConfig[log.type];
                  const badgeCfg = statusBadgeConfig[log.status];
                  
                  const d = new Date(log.timestamp);
                  const dateStr = d.toISOString().split('T')[0];
                  const timeStr = d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(2, '0').substring(0,2);

                  return (
                    <tr key={log.id} className={TR}>
                      <td className={TD}>
                        <div className="flex flex-col">
                          <span className="font-mono text-xs text-[#1C1B1B] font-medium">{dateStr}</span>
                          <span className="font-mono text-xs text-[#5B403D] mt-0.5">{timeStr}</span>
                        </div>
                      </td>
                      <td className={TD}>
                        <span className={`inline-flex items-center gap-2 font-bold text-xs ${cfg.text}`}>
                          <span className={`w-2 h-2 rounded-full ${cfg.dot}`}></span>
                          <span className="whitespace-nowrap">{log.type}</span>
                        </span>
                      </td>
                      <td className={TD}>
                        <span className="text-[#1C1B1B] font-bold text-xs">
                          {log.initiator}
                        </span>
                      </td>
                      <td className={TD}>
                        <p className="text-[#5B403D] text-[13px] leading-tight max-w-[90%]">
                          {log.description}
                        </p>
                      </td>
                      <td className={`${TD} text-right`}>
                        <span className={`inline-block px-2 py-1 rounded font-bold text-[9px] tracking-[0.05em] uppercase ${badgeCfg.bg} ${badgeCfg.text}`}>
                          {log.status}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TableScroll>
        <TablePager page={currentPage} pageSize={TABLE_PAGE_SIZE} total={filteredLogs.length} onPageChange={setCurrentPage} />
      </div>

      {/* ─── Footer Summary Cards ─── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
        {/* HIGH PRIORITY TODAY */}
        <div className="bg-[#F6F3F2] rounded-lg p-6 flex items-center gap-5 relative overflow-visible group hover:bg-[#F2EDEC] transition-colors cursor-help">
          {/* Tooltip */}
          <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-[#1C1B1B] text-white text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
            Total number of critical events logged today
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1C1B1B]"></div>
          </div>
          <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg bg-[#DC2626]/20 group-hover:bg-[#DC2626] transition-colors"></div>
          <div className="w-12 h-12 bg-[#FEE2E2] rounded flex items-center justify-center shrink-0">
            <AlertTriangle className="w-6 h-6 text-[#DC2626]" />
          </div>
          <div>
            <h4 className="text-[#A1A1AA] font-bold text-[10px] tracking-[0.1em] uppercase mb-1">
              High Priority Today
            </h4>
            <p className="text-[#1C1B1B] font-extrabold text-3xl leading-none">
              {logs.filter(l => l.status === 'CRITICAL' && new Date(l.timestamp).toDateString() === new Date().toDateString()).length.toString().padStart(2, '0')}
            </p>
          </div>
        </div>

        {/* SYSTEM THROTTLING */}
        <div className="bg-[#F6F3F2] rounded-lg p-6 flex items-center gap-5 relative overflow-visible group hover:bg-[#F2EDEC] transition-colors cursor-help">
          {/* Tooltip */}
          <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-[#1C1B1B] text-white text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
            Current state of API rate limiting
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1C1B1B]"></div>
          </div>
          <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg bg-[#00799C]"></div>
          <div className="w-12 h-12 bg-[#E0F2FE] rounded flex items-center justify-center shrink-0">
            <Zap className="w-6 h-6 text-[#00799C]" />
          </div>
          <div>
            <h4 className="text-[#A1A1AA] font-bold text-[10px] tracking-[0.1em] uppercase mb-1">
              System Throttling
            </h4>
            <p className="text-[#A1A1AA] font-extrabold text-lg leading-none">
              Not Monitored
            </p>
          </div>
        </div>

        {/* RETENTION HEALTH */}
        <div className="bg-[#F6F3F2] rounded-lg p-6 flex items-center gap-5 relative overflow-visible group hover:bg-[#F2EDEC] transition-colors cursor-help">
          {/* Tooltip */}
          <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-[#1C1B1B] text-white text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
            Percentage of logs successfully retained
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#1C1B1B]"></div>
          </div>
          <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg bg-[#A1A1AA]/20 group-hover:bg-[#A1A1AA] transition-colors"></div>
          <div className="w-12 h-12 bg-[#E5E7EB] rounded flex items-center justify-center shrink-0">
            <History className="w-6 h-6 text-[#6B7280]" />
          </div>
          <div>
            <h4 className="text-[#A1A1AA] font-bold text-[10px] tracking-[0.1em] uppercase mb-1">
              Retention Health
            </h4>
            <p className="text-[#A1A1AA] font-extrabold text-lg leading-none">
              Not Tracked
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

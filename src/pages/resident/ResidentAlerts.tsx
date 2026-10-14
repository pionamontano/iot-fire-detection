import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Filter } from 'lucide-react';
import { TableBodySkeleton } from '../../components/SkeletonLoaders';
import { TABLE_CARD, TABLE, THEAD_ROW, TH, TR, TD, TableScroll, TableEmpty } from '../../components/Table';

type ResidentAlertEvent = {
  id: string;
  triggered_at: string;
  alert_tier: number;
  co_ppm: number;
  temp_celsius: number;
};

export const ResidentAlerts = () => {
  const { profile } = useAuth();
  const [logs, setLogs] = useState<ResidentAlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [fromDate, setFromDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [toDate, setToDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [tierFilter, setTierFilter] = useState<string>('All');

  const fetchLogs = useCallback(async () => {
    if (!profile?.device_id) return;
    setLoading(true);

    try {
      let query = supabase
        .from('alert_events')
        .select('*')
        .eq('device_id', profile.device_id)
        .order('triggered_at', { ascending: false });

      // Apply date filters
      if (fromDate) {
        query = query.gte('triggered_at', `${fromDate}T00:00:00Z`);
      }
      if (toDate) {
        query = query.lte('triggered_at', `${toDate}T23:59:59Z`);
      }
      
      // Apply tier filter
      if (tierFilter === 'Tier 1 Warning') {
        query = query.eq('alert_tier', 1);
      } else if (tierFilter === 'Tier 2 Alert') {
        query = query.eq('alert_tier', 2);
      }

      const { data, error } = await query;
      if (error) throw error;
      setLogs(data || []);
    } catch (error) {
      console.error("Error fetching resident logs:", error);
    } finally {
      setLoading(false);
    }
  }, [profile?.device_id, fromDate, toDate, tierFilter]);

  useEffect(() => {
    if (profile?.device_id) {
      fetchLogs();
    } else {
      setLoading(false);
    }
  }, [profile?.device_id, fromDate, toDate, tierFilter, fetchLogs]);

  const getTierBadge = (tier: number) => {
    if (tier === 1) {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded bg-[#FEF3C7] text-[#92400E] font-bold text-[10px] uppercase tracking-wider">
          Tier 1 Warning
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-1 rounded bg-[#FEE2E2] text-[#DC2626] font-bold text-[10px] uppercase tracking-wider">
        Tier 2 Alert
      </span>
    );
  };

  return (
    <div className="max-w-[640px] mx-auto w-full px-4 py-8 flex flex-col gap-6 font-['Inter',_sans-serif]">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-black tracking-tight text-[#18181B]">Alert Log</h1>
        <p className="text-sm text-[#52525B]">History of fire alerts detected by your device.</p>
      </div>

      {/* Filters */}
      <div className="bg-white border border-[#E4E4E7] rounded-lg p-4 flex flex-col sm:flex-row gap-4 items-end">
        <div className="flex flex-col gap-1.5 w-full sm:w-auto">
          <label className="text-xs font-bold text-[#52525B] uppercase tracking-wider">From date</label>
          <input 
            type="date" 
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-full bg-[#FCF9F8] border border-[#E4E4E7] rounded px-3 py-2 text-sm text-[#18181B] focus:border-[#B91C1C] focus:ring-1 focus:ring-[#B91C1C]/30 outline-none"
          />
        </div>
        <div className="flex flex-col gap-1.5 w-full sm:w-auto">
          <label className="text-xs font-bold text-[#52525B] uppercase tracking-wider">To date</label>
          <input 
            type="date" 
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-full bg-[#FCF9F8] border border-[#E4E4E7] rounded px-3 py-2 text-sm text-[#18181B] focus:border-[#B91C1C] focus:ring-1 focus:ring-[#B91C1C]/30 outline-none"
          />
        </div>
        <div className="flex flex-col gap-1.5 w-full sm:w-auto flex-1">
          <label className="text-xs font-bold text-[#52525B] uppercase tracking-wider">Tier</label>
          <div className="relative">
            <select 
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="w-full bg-[#FCF9F8] border border-[#E4E4E7] rounded px-3 py-2 text-sm text-[#18181B] focus:border-[#B91C1C] focus:ring-1 focus:ring-[#B91C1C]/30 outline-none appearance-none"
            >
              <option value="All">All</option>
              <option value="Tier 1 Warning">Tier 1 Warning</option>
              <option value="Tier 2 Alert">Tier 2 Alert</option>
            </select>
            <Filter className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A1A1AA] pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className={TABLE_CARD}>
        <TableScroll>
          <table className={TABLE}>
            <thead>
              <tr className={THEAD_ROW}>
                <th className={TH}>Timestamp</th>
                <th className={TH}>Tier</th>
                <th className={`${TH} !text-right`}>CO</th>
                <th className={`${TH} !text-right`}>Temp</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableBodySkeleton cols={4} rows={3} />
              ) : !profile?.device_id ? (
                <TableEmpty colSpan={4}>No device linked to this account.</TableEmpty>
              ) : logs.length === 0 ? (
                <TableEmpty colSpan={4}>No alerts found for the selected filters.</TableEmpty>
              ) : (
                logs.map(log => {
                  const d = new Date(log.triggered_at);
                  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                  const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                  return (
                    <tr key={log.id} className={TR}>
                      <td className={TD}>
                        <div className="flex flex-col">
                          <span className="font-mono text-xs font-medium text-[#18181B]">{dateStr}, {timeStr}</span>
                        </div>
                      </td>
                      <td className={TD}>
                        {getTierBadge(log.alert_tier)}
                      </td>
                      <td className={`${TD} text-right`}>
                        <span className="font-mono text-sm text-[#18181B]">{Math.round(log.co_ppm)} ppm</span>
                      </td>
                      <td className={`${TD} text-right`}>
                        <span className="font-mono text-sm text-[#18181B]">{log.temp_celsius.toFixed(1)}°C</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TableScroll>
      </div>
    </div>
  );
};
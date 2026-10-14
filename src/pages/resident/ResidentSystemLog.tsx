import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { SystemLogSkeleton } from '../../components/SkeletonLoaders';
import { TABLE_CARD, TABLE, THEAD_ROW, TH, TR, TD, TableScroll, TableEmpty } from '../../components/Table';
import type { AlertEvent } from '../../lib/supabase';
import { FileText, RefreshCw, Flame, ThermometerSun } from 'lucide-react';

type FilterStatus = 'all' | 'active' | 'resolved';

export const ResidentSystemLog = () => {
  const { profile } = useAuth();
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterStatus>('all');

  useEffect(() => {
    if (profile?.device_id) {
      fetchAlerts(profile.device_id);
    } else if (profile) {
      setLoading(false);
    }
  }, [profile]);

  const fetchAlerts = async (deviceId: string) => {
    try {
      const { data, error } = await supabase
        .from('alert_events')
        .select('*')
        .eq('device_id', deviceId)
        .order('triggered_at', { ascending: false })
        .limit(50);

      if (data) setAlerts(data);
      if (error) console.error(error);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!profile?.device_id || refreshing) return;
    setRefreshing(true);
    setLoading(true);
    await fetchAlerts(profile.device_id);
    setRefreshing(false);
  };

  const filtered = alerts.filter(a => {
    if (filter === 'active') return !a.resolved_at;
    if (filter === 'resolved') return !!a.resolved_at;
    return true;
  });

  const activeCount = alerts.filter(a => !a.resolved_at).length;
  const resolvedCount = alerts.filter(a => !!a.resolved_at).length;

  if (loading && alerts.length === 0) return <SystemLogSkeleton />;
  if (!profile?.device_id) return <div className="p-8 font-bold text-[#DC2626]">No device registered to your account.</div>;

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[#DC2626]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#DC2626]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.1em]">Event History</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-[#18181B]">System Log</h1>
          <p className="text-sm text-[#52525B] mt-1">Complete alert event history for your device.</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-[#18181B] text-white text-[10px] font-bold uppercase tracking-widest rounded hover:bg-black transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats + Filter */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-colors ${filter === 'all' ? 'bg-[#18181B] text-white' : 'bg-[#F4F4F5] text-[#52525B] hover:bg-[#E4E4E7]'}`}
        >
          All ({alerts.length})
        </button>
        <button
          onClick={() => setFilter('active')}
          className={`px-4 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-colors ${filter === 'active' ? 'bg-[#DC2626] text-white' : 'bg-[#FEE2E2] text-[#DC2626] hover:bg-[#FECACA]'}`}
        >
          Active ({activeCount})
        </button>
        <button
          onClick={() => setFilter('resolved')}
          className={`px-4 py-2 rounded-md text-xs font-bold uppercase tracking-wider transition-colors ${filter === 'resolved' ? 'bg-[#00799C] text-white' : 'bg-[#E0F2FE] text-[#00799C] hover:bg-[#BAE6FD]'}`}
        >
          Resolved ({resolvedCount})
        </button>
      </div>

      {/* Alert Table */}
      <div className={TABLE_CARD}>
        <TableScroll>
          <table className={TABLE}>
            <thead>
              <tr className={THEAD_ROW}>
                <th className={TH}>Event</th>
                <th className={TH}>Status</th>
                <th className={TH}>Triggered</th>
                <th className={TH}>Temp</th>
                <th className={TH}>Smoke</th>
                <th className={TH}>Notifications</th>
                <th className={TH}>Resolved</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length > 0 ? filtered.map(alert => (
                <tr key={alert.id} className={TR}>
                  <td className={TD}>
                    <div className="flex items-center gap-2">
                      {alert.alert_tier === 2 ? (
                        <Flame className="w-4 h-4 text-[#DC2626]" />
                      ) : (
                        <ThermometerSun className="w-4 h-4 text-[#F59E0B]" />
                      )}
                      <span className="text-sm font-bold text-[#18181B]">
                        {alert.alert_tier === 2 ? 'Fire Alert' : 'High Temp Warning'}
                      </span>
                    </div>
                    <span className="text-[9px] text-[#A1A1AA] font-mono ml-6">{alert.id.substring(0, 8)}</span>
                  </td>
                  <td className={TD}>
                    <span className={`text-[9px] font-bold px-2 py-1 rounded uppercase ${alert.resolved_at ? 'bg-[#E4E4E7] text-[#52525B]' : 'bg-[#DC2626] text-white'}`}>
                      {alert.resolved_at ? 'RESOLVED' : 'ACTIVE'}
                    </span>
                  </td>
                  <td className={`${TD} text-xs text-[#52525B]`}>
                    {new Date(alert.triggered_at).toLocaleString()}
                  </td>
                  <td className={`${TD} text-xs font-bold text-[#DC2626]`}>{alert.temp_celsius?.toFixed(1)}°C</td>
                  <td className={`${TD} text-xs font-bold text-[#18181B]`}>{alert.co_ppm?.toFixed(0)} PPM</td>
                  <td className={TD}>
                    <div className="flex gap-1">
                      {alert.sms_sent_owner && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#E0F2FE] text-[#00799C]">SMS</span>}
                      {alert.sms_sent_bfp && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#FEE2E2] text-[#DC2626]">BFP</span>}
                      {alert.telegram_sent && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#E4E4E7] text-[#52525B]">TG</span>}
                      {!alert.sms_sent_owner && !alert.sms_sent_bfp && !alert.telegram_sent && <span className="text-[8px] text-[#A1A1AA]">—</span>}
                    </div>
                  </td>
                  <td className={`${TD} text-xs text-[#52525B]`}>
                    {alert.resolved_at ? new Date(alert.resolved_at).toLocaleString() : '—'}
                  </td>
                </tr>
              )) : (
                <TableEmpty colSpan={7} icon={<FileText className="w-10 h-10" />}>
                  {filter === 'all' ? 'No alert events recorded.' : `No ${filter} alerts.`}
                </TableEmpty>
              )}
            </tbody>
          </table>
        </TableScroll>
      </div>

      <p className="text-xs text-[#A1A1AA]">Showing {filtered.length} of {alerts.length} events (max 50)</p>
    </div>
  );
};

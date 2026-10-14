import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { AlertEvent } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Filter, FileText, Flame, RefreshCw, ThermometerSun } from 'lucide-react';
import { TableBodySkeleton } from '../../components/SkeletonLoaders';
import { TABLE_CARD, TABLE, THEAD_ROW, TH, TR, TD, TableScroll, TableEmpty, TablePager, TABLE_PAGE_SIZE } from '../../components/Table';
import { usePagedRows } from '../../hooks/usePagedRows';
import { AlertStatusPill } from '../../components/StatusBadge';
import { formatEventTime } from '../../lib/alertText';
import { PageHeader } from '../../components/PageHeader';
import { BTN_SECONDARY } from '../../components/ui';

// The resident's one alert page (it replaced the separate resident System
// Log): every alert their device raised, filtered by date range, tier and
// open/resolved, with readings, notifications sent and when it was resolved.
// Active alerts always show, whatever the dates: one can stay open for weeks
// (e.g. the device went offline mid-alert and could not auto-resolve), and
// the resident must never see "no alerts" while one is still open.

type TierFilter = 'all' | '1' | '2';
type StatusFilter = 'all' | 'active' | 'resolved';

// Safety cap on one fetch; a single device rarely gets anywhere near it.
const FETCH_LIMIT = 500;

// yyyy-mm-dd in the viewer's own timezone (toISOString would give the UTC
// date, which in the Philippines is still "yesterday" until 8 a.m.).
const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDate(d);
};

const FIELD = 'w-full bg-surface border border-border rounded px-3 py-2 text-sm text-text focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none';
const LABEL = 'text-xs font-bold text-text-body uppercase tracking-wider';

export const ResidentAlerts = () => {
  const { profile } = useAuth();
  // Active alerts first (any date), then everything else in the date range.
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  // Active alerts that fall outside the picked dates, to explain why they show.
  const [activeOutsideRange, setActiveOutsideRange] = useState(0);
  const [hitFetchLimit, setHitFetchLimit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const [fromDate, setFromDate] = useState(() => daysAgo(30));
  const [toDate, setToDate] = useState(() => localDate(new Date()));
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const deviceId = profile?.device_id;
  const profileLoaded = !!profile;
  // Only the newest request may set results (dates can change faster than a fetch returns).
  const requestId = useRef(0);

  const fetchAlerts = useCallback(async () => {
    if (!deviceId) return;
    const id = ++requestId.current;
    let ranged = supabase
      .from('alert_events')
      .select('*')
      .eq('device_id', deviceId)
      .order('triggered_at', { ascending: false })
      .limit(FETCH_LIMIT);
    // Whole local days: from 00:00 on the From date to the end of the To date.
    if (fromDate) ranged = ranged.gte('triggered_at', new Date(`${fromDate}T00:00:00`).toISOString());
    if (toDate) {
      const end = new Date(`${toDate}T00:00:00`);
      end.setDate(end.getDate() + 1);
      ranged = ranged.lt('triggered_at', end.toISOString());
    }
    let active = supabase
      .from('alert_events')
      .select('*')
      .eq('device_id', deviceId)
      .is('resolved_at', null)
      .order('triggered_at', { ascending: false });
    if (tierFilter !== 'all') {
      ranged = ranged.eq('alert_tier', Number(tierFilter));
      active = active.eq('alert_tier', Number(tierFilter));
    }

    const [rangedRes, activeRes] = await Promise.all([ranged, active]);
    if (id !== requestId.current) return;
    const error = rangedRes.error ?? activeRes.error;
    if (error) console.error('Error fetching alert history:', error);
    setLoadFailed(!!error);

    const inRange = (rangedRes.data as AlertEvent[]) || [];
    const open = (activeRes.data as AlertEvent[]) || [];
    const inRangeIds = new Set(inRange.map(a => a.id));
    setActiveOutsideRange(open.filter(a => !inRangeIds.has(a.id)).length);
    setHitFetchLimit(inRange.length === FETCH_LIMIT);
    setAlerts([...open, ...inRange.filter(a => a.resolved_at)]);
  }, [deviceId, fromDate, toDate, tierFilter]);

  useEffect(() => {
    if (!deviceId) {
      if (profileLoaded) setLoading(false);
      return;
    }
    setLoading(true);
    fetchAlerts().finally(() => setLoading(false));
  }, [deviceId, profileLoaded, fetchAlerts]);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    await fetchAlerts();
    setRefreshing(false);
  };

  const activeCount = alerts.filter(a => !a.resolved_at).length;
  const resolvedCount = alerts.length - activeCount;
  const filtered = alerts.filter(a =>
    statusFilter === 'all' || (statusFilter === 'active' ? !a.resolved_at : !!a.resolved_at)
  );
  const { page, setPage, pageRows } = usePagedRows(filtered, `${fromDate}|${toDate}|${tierFilter}|${statusFilter}`);

  const statusChips: { value: StatusFilter; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: alerts.length },
    { value: 'active', label: 'Active', count: activeCount },
    { value: 'resolved', label: 'Resolved', count: resolvedCount },
  ];

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        title="Alert History"
        description="Every fire alert and warning your device raised, and whether it has been resolved."
        actions={deviceId && (
          <button type="button" onClick={handleRefresh} disabled={refreshing || loading} className={BTN_SECONDARY}>
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
        )}
      />

      {/* Filters */}
      <div className="bg-white border border-border rounded-lg p-4 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex flex-col gap-1.5 w-full sm:w-auto">
            <label htmlFor="alerts-from" className={LABEL}>From date</label>
            <input id="alerts-from" type="date" value={fromDate} max={toDate || undefined} onChange={e => setFromDate(e.target.value)} className={FIELD} />
          </div>
          <div className="flex flex-col gap-1.5 w-full sm:w-auto">
            <label htmlFor="alerts-to" className={LABEL}>To date</label>
            <input id="alerts-to" type="date" value={toDate} min={fromDate || undefined} onChange={e => setToDate(e.target.value)} className={FIELD} />
          </div>
          <div className="flex flex-col gap-1.5 w-full sm:w-auto flex-1">
            <label htmlFor="alerts-tier" className={LABEL}>Tier</label>
            <div className="relative">
              <select id="alerts-tier" value={tierFilter} onChange={e => setTierFilter(e.target.value as TierFilter)} className={`${FIELD} appearance-none`}>
                <option value="all">All tiers</option>
                <option value="1">Tier 1 Warning</option>
                <option value="2">Tier 2 Alert</option>
              </select>
              <Filter className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint pointer-events-none" />
            </div>
          </div>
        </div>

        {activeOutsideRange > 0 && (
          <p className="text-xs font-medium text-primary">
            Includes {activeOutsideRange} active {activeOutsideRange === 1 ? 'alert' : 'alerts'} from outside these dates. Active alerts always show until they are resolved.
          </p>
        )}

        <div role="radiogroup" aria-label="Filter by status" className="flex flex-wrap gap-2">
          {statusChips.map(c => {
            const selected = statusFilter === c.value;
            return (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setStatusFilter(c.value)}
                className={`h-8 px-3 rounded-full border text-xs whitespace-nowrap inline-flex items-center gap-2 transition-colors ${
                  selected
                    ? 'bg-primary border-primary text-white font-bold'
                    : 'bg-white border-border text-text-body font-semibold hover:border-text-faint hover:text-text'
                }`}
              >
                {c.label}
                <span className={`font-bold tabular-nums ${selected ? 'text-white/80' : 'text-text-faint'}`}>{c.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className={TABLE_CARD}>
        <TableScroll>
          <table className={TABLE}>
            <thead>
              <tr className={THEAD_ROW}>
                <th className={TH}>Event</th>
                <th className={TH}>Status</th>
                <th className={TH}>Triggered</th>
                <th className={`${TH} !text-right`}>Temp</th>
                <th className={`${TH} !text-right`}>CO</th>
                <th className={TH}>Notifications</th>
                <th className={TH}>Resolved</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableBodySkeleton cols={7} rows={5} />
              ) : !deviceId ? (
                <TableEmpty colSpan={7}>No device linked to this account.</TableEmpty>
              ) : loadFailed ? (
                <TableEmpty colSpan={7}>Couldn't load your alerts. Check your connection and press Refresh.</TableEmpty>
              ) : filtered.length === 0 ? (
                <TableEmpty colSpan={7} icon={<FileText className="w-10 h-10" />}>
                  {alerts.length === 0 ? 'No alerts in this date range.' : `No ${statusFilter} alerts in this date range.`}
                </TableEmpty>
              ) : pageRows.map(alert => (
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
                    <span className="text-[9px] text-text-faint font-mono ml-6">{alert.id.substring(0, 8)}</span>
                  </td>
                  <td className={TD}><AlertStatusPill alert={alert} /></td>
                  <td className={`${TD} text-xs text-text-body whitespace-nowrap`}>{formatEventTime(alert.triggered_at)}</td>
                  <td className={`${TD} text-right font-mono text-xs font-bold text-text whitespace-nowrap`}>{alert.temp_celsius?.toFixed(1)}°C</td>
                  <td className={`${TD} text-right font-mono text-xs font-bold text-text whitespace-nowrap`}>{alert.co_ppm?.toFixed(0)} ppm</td>
                  <td className={TD}>
                    <div className="flex gap-1">
                      {alert.sms_sent_owner && <span title="SMS sent to you" className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-teal-light/10 text-teal-light">SMS</span>}
                      {alert.sms_sent_bfp && <span title="Bureau of Fire Protection notified" className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-tier2-bg text-primary">BFP</span>}
                      {alert.telegram_sent && <span title="Telegram message sent" className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-surface-cream text-text-body">TG</span>}
                      {!alert.sms_sent_owner && !alert.sms_sent_bfp && !alert.telegram_sent && <span className="text-xs text-text-faint">—</span>}
                    </div>
                  </td>
                  <td className={`${TD} text-xs text-text-body whitespace-nowrap`}>
                    {alert.resolved_at ? formatEventTime(alert.resolved_at) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
        <TablePager page={page} pageSize={TABLE_PAGE_SIZE} total={filtered.length} onPageChange={setPage} />
      </div>

      {hitFetchLimit && (
        <p className="text-xs text-text-faint">Only the {FETCH_LIMIT} most recent alerts in this range are shown. Narrow the dates to see older ones.</p>
      )}
    </div>
  );
};

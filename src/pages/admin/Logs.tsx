import React, { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { FilterChips } from '../../components/FilterChips';
import { supabase } from '../../lib/supabase';
import { LoadErrorBanner } from '../../components/LoadErrorBanner';
import type { LoadErrorInfo } from '../../components/LoadErrorBanner';
import { Download, RefreshCw, Search, Activity, Flame, ShieldAlert, Inbox, ScrollText, X } from 'lucide-react';
import { TableBodySkeleton } from '../../components/SkeletonLoaders';
import { TABLE_CARD, TABLE, THEAD_ROW, TH, TR, TD, TableScroll, TableEmpty, TablePager, TABLE_PAGE_SIZE } from '../../components/Table';
import { usePagedRows } from '../../hooks/usePagedRows';
import {
  buildLogEntries, relativeTime, toCsv, CATEGORY_LABEL, SEVERITY_LABEL, LOG_SOURCE_LIMIT,
} from '../../lib/systemLog';
import type { LogCategory, LogEntry, LogSeverity, LogSources } from '../../lib/systemLog';

type CategoryFilter = 'all' | LogCategory;
type RangeFilter = 'all' | '24h' | '7d' | '30d';
type SeverityFilter = 'all' | LogSeverity;

const RANGE_MS: Record<Exclude<RangeFilter, 'all'>, number> = {
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};
const RANGE_LABEL: Record<RangeFilter, string> = {
  all: 'All time', '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days',
};

// Colour per category for the dot in the Event column.
const CATEGORY_DOT: Record<LogCategory, string> = {
  alert: 'bg-accent',
  login: 'bg-text-subtle',
  device: 'bg-teal-light',
  account: 'bg-purple',
  support: 'bg-amber',
  firmware: 'bg-success',
};

// Same pill shape as the device StatusBadge, so badges look alike app-wide.
const SEVERITY_PILL: Record<LogSeverity, string> = {
  critical: 'bg-tier2-bg text-tier2-text',
  warning: 'bg-tier1-bg text-tier1-text',
  success: 'bg-[#ECFDF5] text-success-dark',
  info: 'bg-surface-alt text-text-body',
};

const SeverityPill = ({ severity }: { severity: LogSeverity }) => (
  <span className={`inline-flex shrink-0 px-2.5 py-1 rounded-full font-bold text-[11px] leading-4 uppercase tracking-[0.08em] whitespace-nowrap ${SEVERITY_PILL[severity]}`}>
    {SEVERITY_LABEL[severity]}
  </span>
);

const SELECT = 'w-full sm:w-auto h-10 pl-3 pr-8 border border-border rounded-lg bg-surface-card text-sm font-semibold text-text-body focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary';
const BTN = 'h-10 px-4 rounded-lg font-bold text-sm transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-50';

const dayKey = (iso: string) => new Date(iso).toDateString();

function dayLabel(iso: string, now: number) {
  const d = new Date(iso);
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

const timeOfDay = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });

export const Logs = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [loadErrors, setLoadErrors] = useState<{ what: string; error: LoadErrorInfo }[]>([]);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [range, setRange] = useState<RangeFilter>('7d');
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [openOnly, setOpenOnly] = useState(false);

  const fetchLogs = async () => {
    setLoading(true);
    const [alerts, logins, devices, registrations, support, firmware] = await Promise.all([
      supabase.from('alert_events')
        .select('id, alert_tier, co_ppm, temp_celsius, triggered_at, resolved_at, resolution_source, devices(device_code, location_desc)')
        .order('triggered_at', { ascending: false }).limit(LOG_SOURCE_LIMIT),
      supabase.from('login_attempts')
        .select('id, email, ip_address, success, attempted_at')
        .order('attempted_at', { ascending: false }).limit(LOG_SOURCE_LIMIT),
      supabase.from('devices')
        .select('id, device_code, label, location_desc, created_at')
        .order('created_at', { ascending: false }).limit(LOG_SOURCE_LIMIT),
      supabase.from('registration_requests')
        .select('id, email, requested_role, device_code, created_at, reviewed_at, profile:profiles(full_name, status)')
        .order('created_at', { ascending: false }).limit(LOG_SOURCE_LIMIT),
      supabase.from('support_requests')
        .select('id, category, status, created_at, reviewed_at, profile:profiles(full_name)')
        .order('created_at', { ascending: false }).limit(LOG_SOURCE_LIMIT),
      supabase.from('firmware_releases')
        .select('id, version, notes, created_at')
        .order('created_at', { ascending: false }).limit(LOG_SOURCE_LIMIT),
    ]);

    // Every failed read is shown, so missing entries are never mistaken for "nothing happened".
    const results = { 'fire alerts': alerts, 'sign-in attempts': logins, 'device registrations': devices, 'account requests': registrations, 'support requests': support, 'firmware releases': firmware };
    setLoadErrors(Object.entries(results)
      .filter(([, r]) => r.error)
      .map(([what, r]) => ({ what, error: { message: r.error!.message, code: r.error!.code } })));

    setLogs(buildLogEntries({
      alerts: alerts.data,
      logins: logins.data,
      devices: devices.data,
      registrations: registrations.data,
      support: support.data,
      firmware: firmware.data,
    } as unknown as LogSources));
    setNow(Date.now());
    setLoading(false);
  };

  useEffect(() => { fetchLogs(); }, []);

  // Range + search + severity + open-only narrow the list first; category
  // chip counts are taken after that, so each chip says what tapping it shows.
  const q = search.trim().toLowerCase();
  const baseFiltered = useMemo(() => logs.filter(l => {
    if (range !== 'all' && now - new Date(l.timestamp).getTime() > RANGE_MS[range]) return false;
    if (severity !== 'all' && l.severity !== severity) return false;
    if (openOnly && !l.open) return false;
    if (q && !`${l.event} ${l.actor} ${l.details}`.toLowerCase().includes(q)) return false;
    return true;
  }), [logs, range, severity, openOnly, q, now]);

  const filtered = category === 'all' ? baseFiltered : baseFiltered.filter(l => l.category === category);

  const categoryOptions = useMemo(() => {
    const count = (c: LogCategory) => baseFiltered.filter(l => l.category === c).length;
    return [
      { value: 'all' as CategoryFilter, label: 'All', count: baseFiltered.length },
      ...(Object.keys(CATEGORY_LABEL) as LogCategory[]).map(c => ({ value: c as CategoryFilter, label: CATEGORY_LABEL[c], count: count(c) })),
    ];
  }, [baseFiltered]);

  const filterKey = `${q}|${category}|${range}|${severity}|${openOnly}`;
  const { page, setPage, pageRows } = usePagedRows(filtered, filterKey);

  // ─── Summary numbers (always over everything loaded, not the filtered view) ───
  const last24h = (l: LogEntry) => now - new Date(l.timestamp).getTime() <= RANGE_MS['24h'];
  const events24h = logs.filter(last24h).length;
  const openAlerts = logs.filter(l => l.category === 'alert' && l.open).length;
  const failedSignIns = logs.filter(l => l.category === 'login' && l.severity === 'warning' && last24h(l)).length;
  const awaitingReview = logs.filter(l => (l.category === 'account' || l.category === 'support') && l.open).length;

  const applyView = (v: { category?: CategoryFilter; range?: RangeFilter; severity?: SeverityFilter; openOnly?: boolean }) => {
    setCategory(v.category ?? 'all');
    setRange(v.range ?? 'all');
    setSeverity(v.severity ?? 'all');
    setOpenOnly(v.openOnly ?? false);
    setSearch('');
  };
  const viewIs = (c: CategoryFilter, r: RangeFilter, s: SeverityFilter, o: boolean) =>
    category === c && range === r && severity === s && openOnly === o && !q;

  const hasFilters = !!q || category !== 'all' || range !== '7d' || severity !== 'all' || openOnly;
  const emptyText = hasFilters ? 'Nothing matches these filters.' : 'No events in the last 7 days.';

  const handleExport = () => {
    const blob = new Blob([toCsv(filtered)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `system_log_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 md:space-y-8 pb-10">
      <PageHeader
        title="System Log"
        description="Alerts, sign-ins, device, account, support and firmware events across AgapSense, newest first."
        actions={
          <>
            <button
              type="button"
              onClick={fetchLogs}
              disabled={loading}
              className={`${BTN} border border-border text-text-body bg-surface-card hover:bg-surface`}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={loading || filtered.length === 0}
              title="Downloads the entries currently shown, with all filters applied"
              className={`${BTN} bg-primary text-white hover:bg-primary-dark`}
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          </>
        }
      />

      {loadErrors.map(e => (
        <LoadErrorBanner key={e.what} what={e.what} error={e.error} onRetry={fetchLogs} />
      ))}

      {/* ─── Summary — each tile applies its filter ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
        <StatCard
          label="Events (24h)"
          value={loading ? '–' : events24h.toLocaleString()}
          icon={Activity}
          onClick={() => applyView({ range: '24h' })}
          active={viewIs('all', '24h', 'all', false)}
        />
        <StatCard
          label="Open Alerts"
          value={loading ? '–' : openAlerts.toLocaleString()}
          icon={Flame}
          urgent={openAlerts > 0}
          onClick={() => applyView({ category: 'alert', openOnly: true })}
          active={viewIs('alert', 'all', 'all', true)}
        />
        <StatCard
          label="Failed Sign-ins (24h)"
          value={loading ? '–' : failedSignIns.toLocaleString()}
          icon={ShieldAlert}
          onClick={() => applyView({ category: 'login', range: '24h', severity: 'warning' })}
          active={viewIs('login', '24h', 'warning', false)}
        />
        <StatCard
          label="Awaiting Review"
          value={loading ? '–' : awaitingReview.toLocaleString()}
          icon={Inbox}
          onClick={() => applyView({ openOnly: true })}
          active={viewIs('all', 'all', 'all', true)}
        />
      </div>

      {/* ─── Log table ─── */}
      <div className={TABLE_CARD}>
        <div className="p-3 sm:p-5 border-b border-border flex flex-col gap-3">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="relative w-full lg:max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none" />
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search email, device code, location…"
                aria-label="Search the log"
                className="w-full h-10 pl-9 pr-3 border border-border rounded-lg bg-surface-card text-sm text-text focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
              />
            </div>
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 lg:ml-auto">
              <select value={range} onChange={e => setRange(e.target.value as RangeFilter)} aria-label="Time range" className={SELECT}>
                {(Object.keys(RANGE_LABEL) as RangeFilter[]).map(r => <option key={r} value={r}>{RANGE_LABEL[r]}</option>)}
              </select>
              <select value={severity} onChange={e => setSeverity(e.target.value as SeverityFilter)} aria-label="Severity" className={SELECT}>
                <option value="all">All severities</option>
                {(Object.keys(SEVERITY_LABEL) as LogSeverity[]).map(s => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
              </select>
              {openOnly && (
                <button
                  type="button"
                  onClick={() => setOpenOnly(false)}
                  className="h-10 pl-3 pr-2 rounded-full bg-tier2-bg text-tier2-text text-xs font-bold inline-flex items-center gap-1.5"
                >
                  Open items only <X className="w-3.5 h-3.5" aria-label="Remove filter" />
                </button>
              )}
              {hasFilters && (
                <button
                  type="button"
                  onClick={() => applyView({ range: '7d' })}
                  className="h-10 px-2 text-xs font-bold text-primary-dark hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
          <FilterChips label="Filter by category" value={category} onChange={setCategory} options={categoryOptions} />
        </div>

        {/* Phones: one card per entry, so details never get squeezed sideways */}
        <div className="md:hidden">
          {loading ? (
            <div className="p-4 space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="skeleton-pulse h-24 rounded-lg" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <div className="flex justify-center mb-3 text-border"><ScrollText className="w-10 h-10" /></div>
              <p className="font-medium text-sm text-text-body">{emptyText}</p>
            </div>
          ) : (
            <ul>
              {pageRows.map((log, i) => {
                const newDay = i === 0 || dayKey(pageRows[i - 1].timestamp) !== dayKey(log.timestamp);
                const rel = relativeTime(log.timestamp, now);
                return (
                  <React.Fragment key={log.id}>
                    {newDay && (
                      <li className="px-4 py-2 bg-surface border-b border-border text-[11px] font-bold uppercase tracking-[0.08em] text-text-body">
                        {dayLabel(log.timestamp, now)}
                      </li>
                    )}
                    <li className="px-4 py-3.5 border-b border-border last:border-0 flex flex-col gap-1.5">
                      <div className="flex items-start justify-between gap-3">
                        <span className="inline-flex items-center gap-2 min-w-0">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${CATEGORY_DOT[log.category]}`} aria-hidden="true"></span>
                          <span className="font-bold text-sm text-text">{log.event}</span>
                        </span>
                        <SeverityPill severity={log.severity} />
                      </div>
                      <p className="text-[13px] leading-5 text-text-body">{log.details}</p>
                      <p className="text-[11px] text-text-faint">
                        <span className="font-semibold text-text-body break-all">{log.actor}</span>
                        {' · '}
                        <time dateTime={log.timestamp}>{timeOfDay(log.timestamp)}</time>
                        {rel && ` · ${rel}`}
                      </p>
                    </li>
                  </React.Fragment>
                );
              })}
            </ul>
          )}
        </div>

        <div className="hidden md:block">
        <TableScroll>
          <table className={`${TABLE} min-w-[760px]`}>
            <thead>
              <tr className={THEAD_ROW}>
                <th className={`${TH} w-[130px]`}>Time</th>
                <th className={`${TH} w-[190px]`}>Event</th>
                <th className={`${TH} w-[210px]`}>Actor</th>
                <th className={TH}>Details</th>
                <th className={`${TH} w-[110px] !text-right`}>Severity</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableBodySkeleton cols={5} rows={6} />
              ) : filtered.length === 0 ? (
                <TableEmpty colSpan={5} icon={<ScrollText className="w-10 h-10" />}>
                  {emptyText}
                </TableEmpty>
              ) : (
                pageRows.map((log, i) => {
                  const newDay = i === 0 || dayKey(pageRows[i - 1].timestamp) !== dayKey(log.timestamp);
                  const rel = relativeTime(log.timestamp, now);
                  return (
                    <React.Fragment key={log.id}>
                      {newDay && (
                        <tr className="bg-surface border-b border-border">
                          <td colSpan={5} className="px-5 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-text-body">
                            {dayLabel(log.timestamp, now)}
                          </td>
                        </tr>
                      )}
                      <tr className={TR}>
                        <td className={`${TD} whitespace-nowrap`}>
                          <time dateTime={log.timestamp} title={new Date(log.timestamp).toLocaleString()} className="block text-xs font-semibold text-text tabular-nums">
                            {timeOfDay(log.timestamp)}
                          </time>
                          {rel && <span className="block text-[11px] text-text-faint mt-0.5">{rel}</span>}
                        </td>
                        <td className={TD}>
                          <span className="inline-flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${CATEGORY_DOT[log.category]}`} aria-hidden="true"></span>
                            <span className="font-bold text-xs text-text whitespace-nowrap">{log.event}</span>
                          </span>
                          <span className="block pl-4 mt-0.5 text-[11px] text-text-faint">{CATEGORY_LABEL[log.category]}</span>
                        </td>
                        <td className={TD}>
                          <span className="block text-xs font-semibold text-text break-all">{log.actor}</span>
                        </td>
                        <td className={TD}>
                          <p className="text-[13px] leading-5 text-text-body">{log.details}</p>
                        </td>
                        <td className={`${TD} text-right`}>
                          <SeverityPill severity={log.severity} />
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </TableScroll>
        </div>
        <TablePager page={page} pageSize={TABLE_PAGE_SIZE} total={filtered.length} onPageChange={setPage} />
      </div>

      <p className="text-xs text-text-faint">
        Loads the latest {LOG_SOURCE_LIMIT} entries from each source. Times are shown in your local time zone; exports use UTC.
      </p>
    </div>
  );
};

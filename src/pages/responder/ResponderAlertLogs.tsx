import { useEffect, useState, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, realtimeChannel } from '../../lib/supabase';
import type { AlertEvent, Device } from '../../lib/supabase';
import { displayAddress } from '../../lib/location';
import { alertStatus, formatEventTime } from '../../lib/alertText';
import { formatTemp } from '../../lib/mapDevices';
import { navigationTarget, directionsUrl, averageAckSeconds, formatDuration } from '../../lib/dispatch';
import { TableBodySkeleton } from '../../components/SkeletonLoaders';
import { TABLE_CARD, TABLE, THEAD_ROW, TH, TR, TD, TableScroll, TableEmpty, TablePager, TABLE_PAGE_SIZE } from '../../components/Table';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { FilterChips } from '../../components/FilterChips';
import { AlertStatusPill } from '../../components/StatusBadge';
import { LoadErrorBanner } from '../../components/LoadErrorBanner';
import type { LoadErrorInfo } from '../../components/LoadErrorBanner';
import { Modal, BTN_PRIMARY, BTN_SECONDARY } from '../../components/ui';
import { Download, Flame, CheckCircle2, XCircle, Timer, ChevronRight, Navigation, FileText } from 'lucide-react';

// BFP sees fire (Tier 2) incidents only; Tier 1 warnings are not dispatched to them (lib/dispatch.ts).

type LogDevice = Pick<Device, 'device_code' | 'label' | 'location_desc' | 'latitude' | 'longitude' | 'location_verified'>;
type LogAlert = AlertEvent & { devices?: LogDevice | null };

type RangeFilter = '24h' | '7d' | '30d' | 'all';
const RANGE_LABEL: Record<RangeFilter, string> = { '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days', all: 'All time' };
const RANGE_MS: Record<Exclude<RangeFilter, 'all'>, number> = { '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5 };

type StatusFilter = 'all' | 'open' | 'resolved' | 'false_alarm';
const statusKey = (a: LogAlert): Exclude<StatusFilter, 'all'> => {
  const { label, open } = alertStatus(a);
  if (open) return 'open';
  return label === 'False alarm' ? 'false_alarm' : 'resolved';
};

const CLOSED_BY: Record<string, string> = { device: 'Device (readings back to normal)', responder: 'BFP responder', admin: 'Administrator', resident: 'Resident', legacy: 'System' };

const SELECT = 'w-full sm:w-auto h-10 pl-3 pr-8 border border-border rounded-lg bg-surface-card text-sm font-semibold text-text-body focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary';

const ackTime = (a: LogAlert): string =>
  a.acknowledged_at ? formatDuration((new Date(a.acknowledged_at).getTime() - new Date(a.triggered_at).getTime()) / 1000) : '—';

const csvCell = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;

export const ResponderAlertLogs = () => {
  const [alerts, setAlerts] = useState<LogAlert[]>([]);
  const [deviceCodes, setDeviceCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadErrorInfo | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusFilter>('all');
  // ?device=<code> comes from the header device search and the map: show that device's whole history.
  const [searchParams] = useSearchParams();
  const deviceParam = searchParams.get('device');
  const [range, setRange] = useState<RangeFilter>(deviceParam ? 'all' : '30d');
  const [device, setDevice] = useState(deviceParam ?? 'all');
  const [selected, setSelected] = useState<LogAlert | null>(null);

  useEffect(() => {
    if (!deviceParam) return;
    setDevice(deviceParam);
    setRange('all');
    setPage(1);
  }, [deviceParam]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [alertsRes, devicesRes] = await Promise.all([
      supabase
        .from('alert_events')
        .select('*, devices(device_code, label, location_desc, latitude, longitude, location_verified)')
        .eq('alert_tier', 2)
        .order('triggered_at', { ascending: false })
        .limit(500),
      supabase.from('devices_safe').select('device_code').order('device_code', { ascending: true }),
    ]);
    const err = alertsRes.error ?? devicesRes.error;
    setLoadError(err ? { message: err.message, code: err.code } : null);
    if (alertsRes.data) setAlerts(alertsRes.data as unknown as LogAlert[]);
    if (devicesRes.data) setDeviceCodes(devicesRes.data.map((d: { device_code: string }) => d.device_code));
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const sub = realtimeChannel('resp_alert_logs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alert_events' }, fetchData)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [fetchData]);

  // Date range and device narrow everything (cards, chip counts, table); the status chips narrow the table.
  const inScope = useMemo(() => {
    const cutoff = range === 'all' ? null : Date.now() - RANGE_MS[range];
    return alerts.filter(a =>
      (device === 'all' || a.devices?.device_code === device) &&
      (cutoff === null || new Date(a.triggered_at).getTime() >= cutoff));
  }, [alerts, device, range]);

  const counts = useMemo(() => {
    const c = { open: 0, resolved: 0, false_alarm: 0 };
    for (const a of inScope) c[statusKey(a)]++;
    return c;
  }, [inScope]);
  const avgAck = averageAckSeconds(inScope);

  const rows = status === 'all' ? inScope : inScope.filter(a => statusKey(a) === status);
  const pageRows = rows.slice((page - 1) * TABLE_PAGE_SIZE, page * TABLE_PAGE_SIZE);
  const hasFilters = status !== 'all' || device !== 'all' || range !== '30d';

  const applyStatus = (s: StatusFilter) => { setStatus(s); setPage(1); };
  const clearFilters = () => { setStatus('all'); setDevice('all'); setRange('30d'); setPage(1); };

  const handleExport = () => {
    const headers = ['Triggered', 'Device', 'Device label', 'Address', 'GPS area', 'Temperature (°C)', 'CO (ppm)', 'Status', 'Acknowledged', 'Time to acknowledge', 'Closed', 'Closed by', 'Notes'];
    const lines = rows.map(a => [
      new Date(a.triggered_at).toLocaleString(),
      a.devices?.device_code ?? '',
      a.devices?.label ?? '',
      displayAddress(a.devices?.location_desc),
      a.address_resolved ?? '',
      a.temp_celsius,
      a.co_ppm,
      alertStatus(a).label,
      a.acknowledged_at ? new Date(a.acknowledged_at).toLocaleString() : '',
      a.acknowledged_at ? ackTime(a) : '',
      a.resolved_at ? new Date(a.resolved_at).toLocaleString() : '',
      a.resolution_source ? CLOSED_BY[a.resolution_source] ?? a.resolution_source : '',
      a.outcome_notes ?? '',
    ].map(csvCell).join(','));
    const blob = new Blob([[headers.map(csvCell).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fire_incidents_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const statusOptions: { value: StatusFilter; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: inScope.length },
    { value: 'open', label: 'Open', count: counts.open },
    { value: 'resolved', label: 'Resolved', count: counts.resolved },
    { value: 'false_alarm', label: 'False alarm', count: counts.false_alarm },
  ];
  const emptyText = alerts.length === 0 ? 'No fire alerts have been recorded.' : 'No fire alerts match these filters.';

  return (
    <div className="space-y-6 md:space-y-8 pb-10">
      <PageHeader
        title="Alert Logs"
        description="Every fire alert (Tier 2): where it was, the readings, and how it was handled."
        actions={
          <button
            type="button"
            onClick={handleExport}
            disabled={loading || rows.length === 0}
            title="Downloads the alerts currently shown, with all filters applied"
            className={BTN_PRIMARY}
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        }
      />

      {loadError && <LoadErrorBanner what="alert logs" error={loadError} onRetry={fetchData} />}

      {/* Counts follow the date range and device filters; each tile applies its status filter. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
        <StatCard label="Open" value={loading ? '–' : String(counts.open)} icon={Flame} urgent={counts.open > 0} onClick={() => applyStatus('open')} active={status === 'open'} />
        <StatCard label="Resolved" value={loading ? '–' : String(counts.resolved)} icon={CheckCircle2} onClick={() => applyStatus('resolved')} active={status === 'resolved'} />
        <StatCard label="False Alarms" value={loading ? '–' : String(counts.false_alarm)} icon={XCircle} onClick={() => applyStatus('false_alarm')} active={status === 'false_alarm'} />
        <StatCard label="Avg. Time to Acknowledge" value={loading ? '–' : avgAck === null ? '—' : formatDuration(avgAck)} icon={Timer} />
      </div>

      <div className={TABLE_CARD}>
        <div className="p-3 sm:p-5 border-b border-border flex flex-col gap-3">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <FilterChips label="Filter by status" value={status} onChange={applyStatus} options={statusOptions} />
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 lg:ml-auto">
              <select value={range} onChange={e => { setRange(e.target.value as RangeFilter); setPage(1); }} aria-label="Date range" className={SELECT}>
                {(Object.keys(RANGE_LABEL) as RangeFilter[]).map(r => <option key={r} value={r}>{RANGE_LABEL[r]}</option>)}
              </select>
              <select value={device} onChange={e => { setDevice(e.target.value); setPage(1); }} aria-label="Device" className={SELECT}>
                <option value="all">All devices</option>
                {/* Keep a ?device= value selectable even if it is not in the list. */}
                {[...new Set([...deviceCodes, ...(device !== 'all' ? [device] : [])])].map(code => <option key={code} value={code}>{code}</option>)}
              </select>
              {hasFilters && (
                <button type="button" onClick={clearFilters} className="h-10 px-2 text-xs font-bold text-primary-dark hover:underline col-span-2 sm:col-span-1 justify-self-start">
                  Clear filters
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Phones: one card per alert */}
        <div className="md:hidden">
          {loading ? (
            <div className="p-4 space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="skeleton-pulse h-24 rounded-lg" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <div className="flex justify-center mb-3 text-border"><FileText className="w-10 h-10" /></div>
              <p className="font-medium text-sm text-text-body">{emptyText}</p>
            </div>
          ) : (
            <ul>
              {pageRows.map(a => (
                <li key={a.id} className="border-b border-border last:border-0">
                  <button type="button" onClick={() => setSelected(a)} className="w-full text-left px-4 py-3.5 flex items-start gap-3 hover:bg-surface transition-colors">
                    <span className="flex-1 min-w-0 flex flex-col gap-1">
                      <span className="flex items-center justify-between gap-3">
                        <span className="font-bold text-sm text-text font-mono">{a.devices?.device_code ?? 'Unknown device'}</span>
                        <AlertStatusPill alert={a} />
                      </span>
                      <span className="text-[13px] leading-5 text-text-body">{displayAddress(a.devices?.location_desc)}</span>
                      <span className="text-[11px] text-text-faint">
                        {formatEventTime(a.triggered_at)} · {formatTemp(a.temp_celsius)} · {a.co_ppm} ppm
                      </span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-text-faint mt-1 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="hidden md:block">
          <TableScroll>
            <table className={`${TABLE} min-w-[820px]`}>
              <thead>
                <tr className={THEAD_ROW}>
                  <th className={`${TH} w-[150px]`}>Triggered</th>
                  <th className={`${TH} w-[160px]`}>Device</th>
                  <th className={TH}>Address</th>
                  <th className={`${TH} w-[140px]`}>Readings</th>
                  <th className={`${TH} w-[120px]`}>Acknowledged in</th>
                  <th className={`${TH} w-[120px]`}>Status</th>
                  <th className={`${TH} w-[60px]`}><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableBodySkeleton cols={7} rows={5} />
                ) : rows.length === 0 ? (
                  <TableEmpty colSpan={7} icon={<FileText className="w-10 h-10" />}>{emptyText}</TableEmpty>
                ) : (
                  pageRows.map(a => (
                    <tr key={a.id} className={`${TR} cursor-pointer`} onClick={() => setSelected(a)}>
                      <td className={`${TD} whitespace-nowrap`}>
                        <time dateTime={a.triggered_at} title={new Date(a.triggered_at).toLocaleString()} className="text-xs font-semibold text-text tabular-nums">
                          {formatEventTime(a.triggered_at)}
                        </time>
                      </td>
                      <td className={TD}>
                        <span className="block font-bold text-xs text-text font-mono">{a.devices?.device_code ?? 'Unknown'}</span>
                        {a.devices?.label && <span className="block text-[11px] text-text-faint mt-0.5 truncate max-w-[150px]">{a.devices.label}</span>}
                      </td>
                      <td className={TD}>
                        <p className="text-[13px] leading-5 text-text-body">{displayAddress(a.devices?.location_desc)}</p>
                      </td>
                      <td className={`${TD} whitespace-nowrap text-xs text-text-body tabular-nums`}>
                        {formatTemp(a.temp_celsius)} · {a.co_ppm} ppm
                      </td>
                      <td className={`${TD} whitespace-nowrap text-xs text-text-body tabular-nums`}>{ackTime(a)}</td>
                      <td className={TD}><AlertStatusPill alert={a} /></td>
                      <td className={`${TD} text-right`}>
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); setSelected(a); }}
                          aria-label={`Details for ${a.devices?.device_code ?? 'alert'} at ${new Date(a.triggered_at).toLocaleString()}`}
                          className="p-1 text-text-faint hover:text-text transition-colors"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableScroll>
        </div>
        <TablePager page={page} pageSize={TABLE_PAGE_SIZE} total={rows.length} onPageChange={setPage} />
      </div>

      {selected && <AlertDetail alert={selected} onClose={() => setSelected(null)} />}
    </div>
  );
};

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[120px_1fr] gap-3 py-2.5 border-b border-border-warm last:border-0">
    <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-text-body pt-0.5">{label}</dt>
    <dd className="text-sm text-text min-w-0 break-words">{children}</dd>
  </div>
);

const AlertDetail = ({ alert, onClose }: { alert: LogAlert; onClose: () => void }) => {
  const target = navigationTarget(alert, alert.devices);
  const navigate = useNavigate();
  const { open } = alertStatus(alert);
  return (
    <Modal title="Fire Alert Details" onClose={onClose}>
      <dl>
        <Row label="Status"><AlertStatusPill alert={alert} /></Row>
        <Row label="Device">
          <span className="font-mono font-bold">{alert.devices?.device_code ?? 'Unknown'}</span>
          {alert.devices?.label && <span className="text-text-muted"> · {alert.devices.label}</span>}
        </Row>
        <Row label="Address">{displayAddress(alert.devices?.location_desc)}</Row>
        {alert.address_resolved && <Row label="GPS area">{alert.address_resolved}</Row>}
        <Row label="Location">
          {target ? (
            <span className="flex flex-col gap-1">
              <span className={target.approximate ? 'text-amber' : 'text-success-dark'}>{target.label}</span>
              <a href={directionsUrl(target)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-primary-dark hover:underline">
                <Navigation className="w-3.5 h-3.5" /> Open directions
              </a>
            </span>
          ) : 'No GPS or registered pin'}
        </Row>
        <Row label="Readings">{formatTemp(alert.temp_celsius)} · CO {alert.co_ppm} ppm</Row>
        <Row label="Triggered">{new Date(alert.triggered_at).toLocaleString()}</Row>
        <Row label="Acknowledged">
          {alert.acknowledged_at ? `${new Date(alert.acknowledged_at).toLocaleString()} (after ${ackTime(alert)})` : 'Not acknowledged'}
        </Row>
        <Row label="Closed">
          {alert.resolved_at ? new Date(alert.resolved_at).toLocaleString() : 'Still open'}
          {alert.resolution_source && <span className="block text-xs text-text-subtle mt-0.5">By {CLOSED_BY[alert.resolution_source] ?? alert.resolution_source}</span>}
        </Row>
        {alert.outcome_notes && <Row label="Notes">{alert.outcome_notes}</Row>}
        <Row label="BFP SMS">{alert.sms_sent_bfp ? 'Sent by the device' : 'None confirmed (the device texts only when it has no internet)'}</Row>
      </dl>
      <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button type="button" onClick={onClose} className={`${BTN_SECONDARY} w-full sm:w-auto`}>Close</button>
        {/* The log is the record; an open fire is acknowledged and closed on its dashboard card. */}
        {open && (
          <button type="button" onClick={() => navigate(`/responder?alert=${encodeURIComponent(alert.id)}`)} className={`${BTN_PRIMARY} w-full sm:w-auto`}>
            Acknowledge / resolve on dashboard
          </button>
        )}
      </div>
    </Modal>
  );
};

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { AlertEvent } from '../../lib/supabase';
import { displayAddress } from '../../lib/location';
import { useNowTick } from '../../hooks/useNowTick';
import { getDeviceStatus, DEVICE_STATUS_ORDER } from '../../lib/deviceStatus';
import type { DeviceStatus } from '../../lib/deviceStatus';
import { availableTransitions, closeConfirmMessage, transitionIncident } from '../../lib/incidents';
import type { IncidentTarget } from '../../lib/incidents';
import { MAP_READING_COLUMNS, toMapDevices, formatTemp } from '../../lib/mapDevices';
import type { DeviceWithReadings } from '../../lib/mapDevices';
import { isDispatchAlert, navigationTarget, directionsUrl, formatElapsed } from '../../lib/dispatch';
import { formatEventTime } from '../../lib/alertText';
import { ResponderDashboardSkeleton } from '../../components/SkeletonLoaders';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { DeviceMap, MapLegend } from '../../components/DeviceMap';
import { AlertStatusPill } from '../../components/StatusBadge';
import { LoadErrorBanner } from '../../components/LoadErrorBanner';
import type { LoadErrorInfo } from '../../components/LoadErrorBanner';
import { BTN, BTN_SECONDARY } from '../../components/ui';
import {
  AlertTriangle,
  Flame,
  Wifi,
  Clock,
  BellRing,
  Navigation,
  MapPin,
  MapPinOff,
  Volume2,
  VolumeX,
  ShieldCheck,
  PhoneCall,
  UserX,
} from 'lucide-react';

// The responder map has no Tier 1 warnings: BFP is dispatched on fires only (see lib/dispatch.ts).
const RESPONDER_STATUSES: readonly DeviceStatus[] = DEVICE_STATUS_ORDER.filter(s => s !== 'warning');

const ACTION_SPEC: Record<IncidentTarget, { label: string; busyLabel: string; cls: string }> = {
  acknowledged: { label: 'Acknowledge', busyLabel: 'Acknowledging…', cls: 'bg-primary hover:bg-primary-dark text-white col-span-2' },
  responding: { label: 'Unit dispatched', busyLabel: 'Updating…', cls: 'bg-primary hover:bg-primary-dark text-white col-span-2' },
  resolved: { label: 'Resolved', busyLabel: 'Closing…', cls: 'bg-success-dark hover:bg-[#065F46] text-white' },
  false_alarm: { label: 'False alarm', busyLabel: 'Closing…', cls: 'border border-border bg-surface-card text-text-body hover:bg-surface' },
};

// "0917 123 4567" for display; the tel: link uses the bare digits.
const formatMobile = (n: string) => (/^09\d{9}$/.test(n) ? `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}` : n);

type ContactState =
  | { kind: 'loading' }
  | { kind: 'ok'; residents: { full_name: string; contact_number: string | null }[] }
  | { kind: 'error'; message: string };

// The household to call about an open fire. Responders cannot read profiles directly; the
// get_incident_resident_contact RPC (20261104000000) returns the linked resident only while the fire is open.
const ResidentContact = ({ alertId }: { alertId: string }) => {
  const [state, setState] = useState<ContactState>({ kind: 'loading' });
  useEffect(() => {
    let cancelled = false;
    supabase.rpc('get_incident_resident_contact', { p_alert_id: alertId }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setState({
          kind: 'error',
          message: error.code === 'PGRST202'
            ? 'Resident contact is unavailable until the database update is applied.'
            : "Couldn't load the resident's number.",
        });
      } else {
        setState({ kind: 'ok', residents: (data ?? []) as { full_name: string; contact_number: string | null }[] });
      }
    });
    return () => { cancelled = true; };
  }, [alertId]);

  if (state.kind === 'loading') return <div className="h-10 rounded-lg skeleton-pulse" aria-label="Loading resident contact" />;
  if (state.kind === 'error') return <p className="text-[11px] font-medium text-text-subtle">{state.message}</p>;
  if (state.residents.length === 0) {
    return (
      <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-text-subtle">
        <UserX className="w-3.5 h-3.5" /> No resident account linked to this device.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {state.residents.map((r, i) => (
        <li key={i} className="flex items-center justify-between gap-3 rounded-lg border border-border-warm bg-surface px-3 py-2">
          <span className="min-w-0">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-text-body">Resident</span>
            <span className="block text-sm font-bold text-text truncate">{r.full_name || 'Name not set'}</span>
          </span>
          {r.contact_number ? (
            <a href={`tel:${r.contact_number.replace(/[^\d+]/g, '')}`} className={`${BTN_SECONDARY} !h-9 !text-xs shrink-0`} aria-label={`Call ${r.full_name || 'resident'} at ${r.contact_number}`}>
              <PhoneCall className="w-3.5 h-3.5" /> {formatMobile(r.contact_number)}
            </a>
          ) : (
            <span className="text-xs text-text-subtle shrink-0">No number on file</span>
          )}
        </li>
      ))}
    </ul>
  );
};

export const ResponderDashboard = () => {
  const [devices, setDevices] = useState<DeviceWithReadings[]>([]);
  // Open Tier 2 incidents only.
  const [fireAlerts, setFireAlerts] = useState<AlertEvent[]>([]);
  const [firesTodayCount, setFiresTodayCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadErrorInfo | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [focusDeviceId, setFocusDeviceId] = useState<string | null>(null);
  const navigate = useNavigate();
  const now = useNowTick();
  // Per-second clock for the "open for" timers (the shared tick is 30 s).
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (fireAlerts.length === 0) return;
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [fireAlerts.length]);

  // ─── Alarm sound (Web Audio siren) ───
  // Browsers keep a page's audio suspended until the user has clicked or typed on it, so a dashboard opened or
  // reloaded with a saved session would stay silent when a fire arrives. The AudioContext is therefore created on
  // mount: its state tells us up front whether sound is blocked, and the next click or key press anywhere on the
  // page unlocks it (a siren already started on a suspended context then becomes audible on its own).
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const oscillatorRef = React.useRef<OscillatorNode | null>(null);
  const gainNodeRef = React.useRef<GainNode | null>(null);
  const sirenIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const isPlayingRef = React.useRef(false);
  // 'running' when sound can play; 'suspended' (or Safari's 'interrupted') while the browser blocks it.
  const [audioState, setAudioState] = useState<string>('running');

  const startSiren = useCallback(() => {
    if (isPlayingRef.current) return;
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state === 'closed') return;
    isPlayingRef.current = true;
    try {
      if (ctx.state !== 'running') ctx.resume().catch(console.warn);

      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(800, ctx.currentTime);
      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.start();
      oscillatorRef.current = oscillator;
      gainNodeRef.current = gainNode;

      let high = false;
      sirenIntervalRef.current = setInterval(() => {
        oscillator.frequency.setTargetAtTime(high ? 800 : 1200, ctx.currentTime, 0.1);
        gainNode.gain.setTargetAtTime(0.3, ctx.currentTime, 0.1);
        high = !high;
      }, 500);
    } catch (err) {
      console.warn('AudioContext failed to start:', err);
    }
  }, []);

  const stopSiren = useCallback(() => {
    if (!isPlayingRef.current) return;
    isPlayingRef.current = false;
    if (sirenIntervalRef.current) {
      clearInterval(sirenIntervalRef.current);
      sirenIntervalRef.current = null;
    }
    const oscillator = oscillatorRef.current;
    const gainNode = gainNodeRef.current;
    oscillatorRef.current = null;
    gainNodeRef.current = null;
    try {
      if (gainNode && audioCtxRef.current) {
        gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.1);
      }
      setTimeout(() => {
        try {
          oscillator?.stop();
        } catch { /* already stopped */ }
        oscillator?.disconnect();
        gainNode?.disconnect();
      }, 200);
    } catch (err) {
      console.warn('Error stopping audio:', err);
    }
  }, []);

  useEffect(() => {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    let ctx: AudioContext;
    try {
      ctx = new AudioContextClass();
    } catch (err) {
      console.warn('AudioContext unavailable:', err);
      return;
    }
    audioCtxRef.current = ctx;
    const sync = () => setAudioState(ctx.state);
    ctx.addEventListener('statechange', sync);
    sync();
    return () => {
      stopSiren();
      ctx.removeEventListener('statechange', sync);
      audioCtxRef.current = null;
      ctx.close().catch(console.warn);
    };
  }, [stopSiren]);

  const audioBlocked = audioState === 'suspended' || audioState === 'interrupted';
  const unlockAudio = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(console.warn);
  }, []);

  // While sound is blocked, any click, tap or key press on the page counts as the user gesture that unlocks it.
  useEffect(() => {
    if (!audioBlocked) return;
    window.addEventListener('pointerdown', unlockAudio, true);
    window.addEventListener('keydown', unlockAudio, true);
    return () => {
      window.removeEventListener('pointerdown', unlockAudio, true);
      window.removeEventListener('keydown', unlockAudio, true);
    };
  }, [audioBlocked, unlockAudio]);

  // The siren sounds while any fire is still unacknowledged.
  const unacknowledgedCount = fireAlerts.filter(a => !a.incident_status || a.incident_status === 'active').length;
  useEffect(() => {
    if (unacknowledgedCount > 0 && soundOn) startSiren();
    else stopSiren();
  }, [unacknowledgedCount, soundOn, startSiren, stopSiren]);

  const fetchData = useCallback(async () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [devicesRes, alertsRes, todayRes] = await Promise.all([
      supabase.from('devices_safe')
        .select<string, DeviceWithReadings>(`*, sensor_readings(${MAP_READING_COLUMNS})`)
        .order('device_code', { ascending: true })
        .order('recorded_at', { foreignTable: 'sensor_readings', ascending: false })
        .limit(1, { foreignTable: 'sensor_readings' }),
      supabase.from('alert_events')
        .select('*, devices(device_code, label, location_desc)')
        .eq('alert_tier', 2)
        .is('resolved_at', null)
        .order('triggered_at', { ascending: true }),
      supabase.from('alert_events')
        .select('id', { count: 'exact', head: true })
        .eq('alert_tier', 2)
        .gte('triggered_at', todayStart.toISOString()),
    ]);

    const readError = devicesRes.error ?? alertsRes.error;
    setLoadError(readError ? { message: readError.message, code: readError.code } : null);
    if (devicesRes.data) setDevices(devicesRes.data);
    if (alertsRes.data) {
      // Oldest first: the fire that has waited longest is handled first. Closed incidents drop out.
      setFireAlerts((alertsRes.data as unknown as AlertEvent[])
        .filter(a => isDispatchAlert(a) && a.incident_status !== 'resolved' && a.incident_status !== 'false_alarm'));
    }
    if (todayRes.count !== null) setFiresTodayCount(todayRes.count);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const deviceSub = supabase.channel('resp_devices')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, fetchData)
      .subscribe();
    const alertSub = supabase.channel('resp_alerts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alert_events' }, fetchData)
      .subscribe();
    return () => {
      supabase.removeChannel(deviceSub);
      supabase.removeChannel(alertSub);
    };
  }, [fetchData]);

  // Every incident action goes through the transition_incident RPC: the database validates the transition,
  // checks the caller and sets the actor/timestamps. Closing is irreversible, so it asks for confirmation.
  const handleTransition = async (alertId: string, to: IncidentTarget) => {
    if ((to === 'resolved' || to === 'false_alarm') && !window.confirm(closeConfirmMessage(to))) return;
    setActionError(null);
    setBusyId(alertId);
    const result = await transitionIncident(supabase, alertId, to);
    if (!result.ok) setActionError(result.message);
    if (result.ok || result.refresh) await fetchData();
    setBusyId(null);
  };

  const deviceById = useMemo(() => new Map(devices.map(d => [d.id, d])), [devices]);
  const mapDevices = toMapDevices(devices, now);
  const devicesWithoutLocation = mapDevices.filter(d => d.location.kind === 'unavailable');

  // Connectivity is re-evaluated on every clock tick so a silent device moves to Reconnecting / Offline.
  const reporting = devices.filter(d => {
    const s = getDeviceStatus(d, [], now);
    return s === 'online' || s === 'reconnecting';
  }).length;
  const enabled = devices.filter(d => d.is_active).length;
  const everReported = devices.some(d => d.last_seen_at);
  const allSilent = enabled > 0 && reporting === 0 && everReported;
  const awaitingFirstCheckIn = enabled > 0 && !everReported;

  if (loading) return <ResponderDashboardSkeleton />;

  return (
    <div className="flex flex-col gap-6 md:gap-8 pb-12">
      <PageHeader
        title="Dashboard"
        description="Fire alerts (Tier 2) from AgapSense devices, and whether each device is reporting."
        actions={
          <button
            type="button"
            onClick={() => setSoundOn(on => !on)}
            aria-pressed={soundOn}
            className={soundOn ? BTN_SECONDARY : `${BTN} border border-tier1-border/50 bg-tier1-bg text-tier1-text hover:bg-tier1-bg/70`}
          >
            {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            {soundOn ? 'Alarm sound on' : 'Alarm sound muted'}
          </button>
        }
      />

      {loadError && <LoadErrorBanner what="dashboard data" error={loadError} onRetry={fetchData} />}

      {/* The browser blocks page audio until the user interacts with the page: say so before a fire is missed. */}
      {soundOn && audioBlocked && (
        <div
          role="alert"
          className={`flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg border ${unacknowledgedCount > 0
            ? 'border-tier2-border/40 bg-tier2-bg text-tier2-text'
            : 'border-tier1-border/40 bg-tier1-bg text-tier1-text'}`}
        >
          <VolumeX className="w-5 h-5 shrink-0" />
          <div className="text-sm flex-1 min-w-0">
            <p className="font-bold">
              {unacknowledgedCount > 0 ? 'A fire alarm is sounding, but the browser has blocked the sound.' : 'The browser is blocking the alarm sound.'}
            </p>
            <p className="mt-0.5">Click anywhere on this page to allow it. Until then a new fire will not be heard.</p>
          </div>
          <button type="button" onClick={unlockAudio} className={`${BTN_SECONDARY} shrink-0`}>
            <Volume2 className="w-4 h-4" /> Enable alarm sound
          </button>
        </div>
      )}

      {/* Only for devices that WERE reporting and have all gone silent: alerts cannot arrive. */}
      {allSilent && (
        <div role="alert" className="flex items-start gap-3 p-4 rounded-lg border border-tier2-border/40 bg-tier2-bg text-tier2-text">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-bold">No device is reporting.</p>
            <p className="mt-0.5">Fire alerts cannot reach this dashboard until devices reconnect.</p>
          </div>
        </div>
      )}
      {awaitingFirstCheckIn && (
        <div role="status" className="flex items-start gap-3 p-4 rounded-lg border border-tier1-border/40 bg-tier1-bg text-tier1-text">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <p className="text-sm"><strong>Waiting for first check-in.</strong> {enabled} device{enabled === 1 ? '' : 's'} registered, none has reported yet.</p>
        </div>
      )}

      {/* Same tile as the admin pages: red only when there is something to act on. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
        <StatCard label="Active Fires" value={String(fireAlerts.length)} icon={Flame} urgent={fireAlerts.length > 0} />
        <StatCard label="Not Acknowledged" value={String(unacknowledgedCount)} icon={BellRing} urgent={unacknowledgedCount > 0} />
        <StatCard label="Devices Reporting" value={`${reporting} / ${enabled}`} icon={Wifi} />
        <StatCard label="Fire Alerts Today" value={String(firesTodayCount)} icon={Clock} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 items-start">
        {/* ─── Active fires (first on phones: it is what a responder acts on) ─── */}
        <section className="lg:col-span-1 lg:order-2 flex flex-col gap-3 min-w-0" aria-labelledby="active-fires-title">
          <div className="flex items-center justify-between gap-2">
            <h2 id="active-fires-title" className="text-text font-bold text-base">Active Fire Alerts</h2>
            {fireAlerts.length > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-tier2-bg text-tier2-text">{fireAlerts.length} open</span>
            )}
          </div>

          {/* At list level (not on a card) so the explanation survives the refresh that may remove the card. */}
          {actionError && (
            <div role="alert" className="flex items-start justify-between gap-2 p-3 text-xs font-semibold text-tier2-text bg-tier2-bg border border-tier2-border/30 rounded-lg">
              <span>{actionError}</span>
              <button type="button" onClick={() => setActionError(null)} aria-label="Dismiss" className="shrink-0 font-bold">&times;</button>
            </div>
          )}

          {fireAlerts.length === 0 ? (
            <div className="bg-surface-card border border-border rounded-lg p-8 text-center">
              <ShieldCheck className="w-9 h-9 mx-auto text-success" />
              <p className="text-sm font-bold text-text mt-3">No active fire alerts</p>
              <p className="text-xs text-text-subtle mt-1 leading-relaxed">
                When a device detects fire, it appears here{soundOn ? ' and the alarm sounds' : ''}.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3 lg:max-h-[calc(480px+2.75rem)] lg:overflow-y-auto thin-scroll">
              {fireAlerts.map(alert => {
                const joined = (alert as unknown as { devices?: { device_code?: string; label?: string; location_desc?: string | null } }).devices ?? {};
                const device = deviceById.get(alert.device_id);
                const target = navigationTarget(alert, device);
                const address = displayAddress(joined.location_desc ?? device?.location_desc);
                const gpsArea = alert.address_resolved?.trim();
                const busy = busyId === alert.id;
                const unacknowledged = !alert.incident_status || alert.incident_status === 'active';
                return (
                  <li key={alert.id} className={`bg-surface-card border rounded-lg overflow-hidden ${unacknowledged ? 'border-tier2-border/60 ring-1 ring-tier2-border/30' : 'border-border'}`}>
                    <div className={`flex items-center justify-between gap-2 px-4 py-2 ${unacknowledged ? 'bg-tier2-bg' : 'bg-surface-alt'}`}>
                      <AlertStatusPill alert={alert} />
                      <span className="text-[11px] font-bold text-tier2-text tabular-nums" title={new Date(alert.triggered_at).toLocaleString()}>
                        Open {formatElapsed(alert.triggered_at, clock)}
                      </span>
                    </div>

                    <div className="p-4 flex flex-col gap-3">
                      <div className="min-w-0">
                        <h3 className="font-extrabold text-sm text-text">
                          <span className="font-mono">{joined.device_code ?? device?.device_code ?? 'Unknown device'}</span>
                          {(joined.label ?? device?.label) && <span className="font-semibold text-text-muted"> · {joined.label ?? device?.label}</span>}
                        </h3>
                        <p className="text-sm text-text-body mt-1 leading-snug">{address}</p>
                        {gpsArea && gpsArea !== address && (
                          <p className="text-xs text-text-subtle mt-1">GPS area: {gpsArea}</p>
                        )}
                        <p className="text-xs text-text-subtle mt-1">Triggered {formatEventTime(alert.triggered_at, clock)}</p>
                      </div>

                      <dl className="grid grid-cols-2 gap-2">
                        <div className="bg-surface border border-border-warm rounded-md px-3 py-2">
                          <dt className="text-[10px] font-bold uppercase tracking-wider text-text-body">Temperature</dt>
                          <dd className="font-extrabold text-sm text-tier2-text">{formatTemp(alert.temp_celsius)}</dd>
                        </div>
                        <div className="bg-surface border border-border-warm rounded-md px-3 py-2">
                          <dt className="text-[10px] font-bold uppercase tracking-wider text-text-body">Smoke / CO</dt>
                          <dd className="font-extrabold text-sm text-tier2-text">{alert.co_ppm} ppm</dd>
                        </div>
                      </dl>

                      <ResidentContact alertId={alert.id} />

                      <div className="grid grid-cols-2 gap-2">
                        {availableTransitions(alert.incident_status, 'bfp_responder').map(to => {
                          const spec = ACTION_SPEC[to];
                          return (
                            <button
                              key={to}
                              type="button"
                              onClick={() => handleTransition(alert.id, to)}
                              disabled={busy}
                              className={`h-10 px-3 rounded-lg font-bold text-sm transition-colors disabled:opacity-50 ${spec.cls}`}
                            >
                              {busy ? spec.busyLabel : spec.label}
                            </button>
                          );
                        })}
                      </div>

                      {target ? (
                        <div className="flex flex-col gap-1.5">
                          <div className="grid grid-cols-2 gap-2">
                            <a href={directionsUrl(target)} target="_blank" rel="noreferrer" className={`${BTN_SECONDARY} !h-9 !text-xs`}>
                              <Navigation className="w-3.5 h-3.5" /> Directions
                            </a>
                            <button type="button" onClick={() => setFocusDeviceId(alert.device_id)} className={`${BTN_SECONDARY} !h-9 !text-xs`}>
                              <MapPin className="w-3.5 h-3.5" /> Show on map
                            </button>
                          </div>
                          <p className={`text-[11px] font-medium ${target.approximate ? 'text-amber' : 'text-success-dark'}`}>
                            Directions to: {target.label}{target.approximate ? ' — check the address on arrival' : ''}
                          </p>
                        </div>
                      ) : (
                        <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-text-subtle">
                          <MapPinOff className="w-3.5 h-3.5" /> No GPS or registered pin. Use the address above.
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ─── Device map ─── */}
        <section className="lg:col-span-2 lg:order-1 flex flex-col gap-3 min-w-0" aria-labelledby="device-map-title">
          <h2 id="device-map-title" className="text-text font-bold text-base">Device Map</h2>
          <div className="bg-surface-card border border-border rounded-lg overflow-hidden h-[320px] sm:h-[400px] lg:h-[480px]">
            <DeviceMap
              compact
              devices={mapDevices}
              activeAlerts={fireAlerts}
              now={now}
              selectedDeviceId={focusDeviceId}
              onSelectionHandled={() => setFocusDeviceId(null)}
              onViewDetails={(d) => navigate(`/responder/alerts?device=${encodeURIComponent(d.device_code)}`)}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <MapLegend statuses={RESPONDER_STATUSES} />
            {devicesWithoutLocation.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                <MapPinOff className="w-3.5 h-3.5 shrink-0 text-amber" />
                <span><strong className="text-text">No location for {devicesWithoutLocation.map(d => d.device_code).join(', ')}</strong> — not shown on the map.</span>
              </span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

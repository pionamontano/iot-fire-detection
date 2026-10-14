import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import type { Device, AlertEvent } from '../../lib/supabase';
import { resolveDeviceLocation, describeLocation, isValidCoordinate, markerOpacity, displayAddress } from '../../lib/location';
import type { ReadingLocationInput, ResolvedLocation } from '../../lib/location';
import { useNowTick } from '../../hooks/useNowTick';
import { getDeviceStatus, getStatusNote, DEVICE_STATUS, DEVICE_STATUS_ORDER } from '../../lib/deviceStatus';
import type { DeviceStatus } from '../../lib/deviceStatus';
import { availableTransitions, closeConfirmMessage, transitionIncident } from '../../lib/incidents';
import type { IncidentTarget } from '../../lib/incidents';
import { ResponderDashboardSkeleton } from '../../components/SkeletonLoaders';
import {
  AlertTriangle,
  Wifi,
  Clock,
  PhoneCall,
  Navigation,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';

// ─── Map Marker Icons ─── (colors from the shared status model)
const PIN_SIZE: Record<DeviceStatus, number> = { fire: 16, warning: 14, online: 10, reconnecting: 12, offline: 12 };
const createCustomIcon = (status: DeviceStatus) => {
  const color = DEVICE_STATUS[status].color;
  const size = PIN_SIZE[status];
  const html = `
    <div style="position: relative; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">
      ${status === 'fire' ? `<div style="position: absolute; width: 48px; height: 48px; background: rgba(220, 38, 38, 0.4); border-radius: 50%; animation: pulse 2s infinite;"></div>` : ''}
      <div style="width: ${size}px; height: ${size}px; background: ${color}; border: 2px solid white; border-radius: 50%; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); position: relative; z-index: 10;"></div>
    </div>
  `;

  return new L.DivIcon({
    html,
    className: 'custom-leaflet-marker',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
  });
};

const iconByStatus = Object.fromEntries(DEVICE_STATUS_ORDER.map(st => [st, createCustomIcon(st)])) as Record<DeviceStatus, L.DivIcon>;

type DeviceWithStatus = Device & {
  status: DeviceStatus;
  activeAlert?: AlertEvent;
  /** This device's open alerts, so status can be re-evaluated on each clock tick. */
  deviceAlerts: AlertEvent[];
  // Raw readings are kept so the location (and its 15-minute live-fix window) can be re-evaluated on
  // every clock tick instead of being frozen at fetch time.
  sensor_readings?: ReadingLocationInput[];
};

type DeviceOnMap = DeviceWithStatus & { location: ResolvedLocation };

const TickingTimer = ({ triggeredAt }: { triggeredAt: string }) => {
  const [timeText, setTimeText] = React.useState(() => {
    const seconds = Math.floor((Date.now() - new Date(triggeredAt).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s ago`;
  });

  React.useEffect(() => {
    const interval = setInterval(() => {
      const seconds = Math.floor((Date.now() - new Date(triggeredAt).getTime()) / 1000);
      if (seconds < 60) {
        setTimeText(`${seconds}s ago`);
      } else {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        setTimeText(`${m}m ${s}s ago`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [triggeredAt]);

  return <span>Triggered {timeText}</span>;
};

export const ResponderDashboard = () => {
  const [devices, setDevices] = useState<DeviceWithStatus[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<AlertEvent[]>([]);
  const [alertsTodayCount, setAlertsTodayCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [klaxonArmed, setKlaxonArmed] = useState(true);
  const now = useNowTick();

  // Klaxon AudioContext ref
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const oscillatorRef = React.useRef<OscillatorNode | null>(null);
  const gainNodeRef = React.useRef<GainNode | null>(null);
  const sirenIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const isPlayingRef = React.useRef(false);

  const startKlaxon = useCallback(() => {
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!audioCtxRef.current && AudioContextClass) {
        audioCtxRef.current = new AudioContextClass();
      }

      const ctx = audioCtxRef.current;
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();

      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(800, ctx.currentTime); // Start at 800Hz

      gainNode.gain.setValueAtTime(0, ctx.currentTime);

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.start();

      oscillatorRef.current = oscillator;
      gainNodeRef.current = gainNode;

      let high = false;
      sirenIntervalRef.current = setInterval(() => {
        if (!ctx) return;
        const targetFreq = high ? 800 : 1200;
        oscillator.frequency.setTargetAtTime(targetFreq, ctx.currentTime, 0.1);
        gainNode.gain.setTargetAtTime(0.3, ctx.currentTime, 0.1);
        high = !high;
      }, 500);

    } catch (err) {
      console.warn("AudioContext failed to start:", err);
    }
  }, []);

  const stopKlaxon = useCallback(() => {
    if (!isPlayingRef.current) return;
    isPlayingRef.current = false;

    if (sirenIntervalRef.current) {
      clearInterval(sirenIntervalRef.current);
      sirenIntervalRef.current = null;
    }

    try {
      if (gainNodeRef.current && audioCtxRef.current) {
        gainNodeRef.current.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.1);
      }
      setTimeout(() => {
        if (oscillatorRef.current) {
          oscillatorRef.current.stop();
          oscillatorRef.current.disconnect();
          oscillatorRef.current = null;
        }
        if (gainNodeRef.current) {
          gainNodeRef.current.disconnect();
          gainNodeRef.current = null;
        }
      }, 200);
    } catch (err) {
       console.warn("Error stopping audio:", err);
    }
  }, []);

  useEffect(() => {
    return () => {
      stopKlaxon();
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(console.warn);
      }
    };
  }, [stopKlaxon]);

  // Check if there is an unacknowledged critical fire alert
  const hasUnacknowledgedCriticalFire = useMemo(() => {
    return activeAlerts.some(a => a.alert_tier === 2 && (!a.incident_status || a.incident_status === 'active'));
  }, [activeAlerts]);

  useEffect(() => {
    if (hasUnacknowledgedCriticalFire && klaxonArmed) {
      startKlaxon();
    } else {
      stopKlaxon();
    }
  }, [hasUnacknowledgedCriticalFire, klaxonArmed, startKlaxon, stopKlaxon]);


  // Every incident action goes through the transition_incident RPC: the database validates the transition,
  // checks the caller and sets the actor/timestamps. Closing is irreversible, so it asks for confirmation.
  const handleTransition = async (alertId: string, to: IncidentTarget) => {
    if ((to === 'resolved' || to === 'false_alarm') && !window.confirm(closeConfirmMessage(to))) return;
    setActionError(null);
    setAcknowledging(alertId);
    const result = await transitionIncident(supabase, alertId, to);
    if (!result.ok) setActionError(result.message);
    if (result.ok || result.refresh) await fetchData();
    setAcknowledging(null);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [devicesRes, alertsRes] = await Promise.all([
      supabase.from('devices_safe').select('*, sensor_readings(latitude, longitude, gps_valid, recorded_at)')
        .order('recorded_at', { foreignTable: 'sensor_readings', ascending: false })
        .limit(1, { foreignTable: 'sensor_readings' })
        .order('created_at', { ascending: false }),
      supabase.from('alert_events').select('*, devices(device_code, label, location_desc, bfp_contact)').order('triggered_at', { ascending: false }),
    ]);

    const allAlerts = (alertsRes.data || []) as unknown as AlertEvent[];
    const unresolvedAlerts = allAlerts.filter(a => !a.resolved_at && a.incident_status !== 'resolved' && a.incident_status !== 'false_alarm');

    const enriched: DeviceWithStatus[] = (devicesRes.data || []).map((d: any) => {
      // Shared status rules (2 / 15 min connectivity, Tier 2 = fire, Tier 1
      // = warning). This page used its own 5-minute cutoff and labelled
      // Tier 1 "HIGH TEMP".
      const deviceAlerts = unresolvedAlerts.filter(a => a.device_id === d.id);
      const alert = deviceAlerts.find(a => a.alert_tier === 2) ?? deviceAlerts[0];
      const status = getDeviceStatus(d, deviceAlerts);

      // Location is resolved at render time (see mapDevices) from d.sensor_readings + the registered
      // coordinates. No position is ever invented here.
      return { ...d, status, activeAlert: alert, deviceAlerts };
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const triggeredToday = allAlerts.filter(a => new Date(a.triggered_at).getTime() >= todayStart.getTime()).length;

    setDevices(enriched);
    setActiveAlerts(unresolvedAlerts);
    setAlertsTodayCount(triggeredToday);
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

  // Re-evaluate status on every clock tick so a silent device moves to
  // Reconnecting / Offline without waiting for new data.
  const liveDevices = useMemo(
    () => devices.map(d => ({ ...d, status: getDeviceStatus(d, d.deviceAlerts, now) })),
    [devices, now]
  );

  // Counts
  const activeAlarmCount = liveDevices.filter(d => d.status === 'fire').length;
  const preAlertsCount = liveDevices.filter(d => d.status === 'warning').length;
  const devicesOnline = liveDevices.filter(d => d.status !== 'offline').length;
  const totalDevices = devices.length;
  const coveragePercent = totalDevices > 0 ? (devicesOnline / totalDevices) * 100 : 0;
  const coverageColor =
    totalDevices === 0 ? '#71717A' : devicesOnline === 0 ? '#DC2626' : coveragePercent < 80 ? '#F59E0B' : '#10B981';

  // A device that has never sent telemetry (last_seen_at is null) has not been provisioned yet — that's
  // different from a device that WAS reporting and has since gone silent, which is the real outage signal.
  const everReportedCount = devices.filter(d => d.last_seen_at).length;
  const awaitingFirstCheckIn = totalDevices > 0 && everReportedCount === 0;
  const criticalOutage = totalDevices > 0 && devicesOnline === 0 && everReportedCount > 0;

  // Live feed alerts (top 5 unresolvedAlerts with device join data)
  const feedAlerts = activeAlerts.slice(0, 5);

  // Resolve each device's location (live / last-known / registered / unavailable). Re-evaluated on every
  // 30 s tick so a fix older than 15 minutes stops being shown as live even when no new data arrives.
  const mapDevices = useMemo<DeviceOnMap[]>(() => liveDevices.map(d => {
    const location = resolveDeviceLocation({ readings: d.sensor_readings, device: d, now });
    return { ...d, latitude: location.lat, longitude: location.lng, location };
  }), [liveDevices, now]);
  const devicesWithoutLocation = mapDevices.filter(d => d.location.kind === 'unavailable');

  if (loading) {
    return <ResponderDashboardSkeleton />;
  }

  return (
    <div className="space-y-8 pb-10">
      {/* Header with Klaxon Toggle */}
      <div className="flex justify-end mb-4">
        <button
          onClick={() => {
            // Need a user gesture to resume audio context reliably if it was suspended
            if (!klaxonArmed && audioCtxRef.current?.state === 'suspended') {
              audioCtxRef.current.resume();
            }
            setKlaxonArmed(!klaxonArmed);
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-colors ${
            klaxonArmed
              ? 'bg-red-100 text-red-700 border border-red-200 hover:bg-red-200'
              : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
          }`}
        >
          {klaxonArmed ? (
            <>
              <Volume2 className="w-4 h-4" /> Klaxon Armed
            </>
          ) : (
            <>
              <VolumeX className="w-4 h-4" /> Muted
            </>
          )}
        </button>
      </div>

      {/* Outage banner: only shown for devices that WERE reporting and have gone silent */}
      {criticalOutage && (
        <div className="bg-red-600 text-white font-bold px-4 py-3 rounded-lg flex items-center justify-center gap-2 mb-6">
          <AlertTriangle className="w-5 h-5" />
          CRITICAL: ALL TELEMETRY LOST (0 ONLINE DEVICES)
        </div>
      )}

      {/* Softer notice for devices that have never checked in yet (new/unprovisioned deployment) */}
      {awaitingFirstCheckIn && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 font-bold px-4 py-3 rounded-lg flex items-center justify-center gap-2 mb-6">
          <AlertTriangle className="w-5 h-5" />
          AWAITING FIRST CHECK-IN: {totalDevices} DEVICE{totalDevices > 1 ? 'S' : ''} REGISTERED, NONE HAVE REPORTED TELEMETRY YET
        </div>
      )}

      {/* ─── 4 Stat Cards ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard
          label="Active Alarms"
          value={String(activeAlarmCount).padStart(2, '0')}
          color="#DC2626"
          icon={<AlertTriangle className="w-5 h-5" />}
          highlightClass={activeAlarmCount > 0 ? "ring-2 ring-red-500 bg-red-50 animate-pulse" : ""}
        />
        <StatCard label="Pre-Alerts / Warning" value={String(preAlertsCount)} color="#F59E0B" icon={<AlertTriangle className="w-5 h-5" />} />
        <StatCard
          label="Monitored Coverage"
          value={`${devicesOnline} / ${totalDevices}`}
          subValue={`${coveragePercent.toFixed(1)}% online`}
          color={coverageColor}
          icon={<Wifi className="w-5 h-5" />}
        />
        <StatCard label="Alerts Today" value={String(alertsTodayCount)} color="#DC2626" icon={<Clock className="w-5 h-5" />} />
      </div>

      {/* ─── Map + Live Alert Feed ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Interactive Map (8/12) */}
        <div className="lg:col-span-8 bg-[#2D1F1E] rounded-lg overflow-hidden relative" style={{ minHeight: 420 }}>
          <MapContainer
            center={[14.8527, 120.8160]}
            zoom={13}
            style={{ height: '100%', width: '100%', minHeight: 420 }}
            className="z-0"
          >
            <MapUpdater devices={mapDevices} />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {mapDevices.map(device => {
              if (device.location.kind === 'unavailable' || !isValidCoordinate(device.latitude, device.longitude)) return null;
              const locInfo = describeLocation(device.location, now);
              const icon = iconByStatus[device.status];
              const note = getStatusNote(device, device.status, now);
              return (
                <Marker key={device.id} position={[device.latitude as number, device.longitude as number]} icon={icon} opacity={markerOpacity(device.location.kind)}>
                  <Popup>
                    <div className="font-sans">
                      <strong className="block text-sm font-bold">{device.device_code}</strong>
                      <span className="text-xs text-gray-600 block mt-1">{displayAddress(device.location_desc)}</span>
                      <span className="text-xs font-bold mt-1 block" style={{ color: DEVICE_STATUS[device.status].color }}>
                        {DEVICE_STATUS[device.status].longLabel}{note ? ` · ${note}` : ''}
                      </span>
                      <span className="text-xs block mt-1" style={{ color: locInfo.approximate ? '#B45309' : '#047857' }}>
                        <strong>{locInfo.label}</strong> - {locInfo.detail}
                      </span>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>

          {devicesWithoutLocation.length > 0 && (
            <div role="status" className="absolute top-4 left-4 right-4 z-[1000] rounded-md bg-amber-50/95 border border-amber-300 px-3 py-2 text-xs text-amber-900">
              <strong>Location unavailable for {devicesWithoutLocation.length} device{devicesWithoutLocation.length > 1 ? 's' : ''}</strong> (not shown on the map): {devicesWithoutLocation.map(d => d.device_code).join(', ')}
            </div>
          )}

          {/* Map Legend */}
          <div className="absolute bottom-4 left-4 z-[1000] bg-[#1C1B1B]/80 backdrop-blur-sm rounded-md px-4 py-3 flex flex-col gap-2">
            {DEVICE_STATUS_ORDER.map(st => (
              <LegendDot key={st} color={DEVICE_STATUS[st].color} label={DEVICE_STATUS[st].longLabel} />
            ))}
          </div>
        </div>

        {/* Live Alert Feed (4/12) */}
        <div className="lg:col-span-4 bg-white border border-[#E5E2E1] rounded-lg flex flex-col overflow-hidden" style={{ maxHeight: 420 }}>
          <div className="px-5 py-4 border-b border-[#E5E2E1] flex items-center justify-between">
            <h3 className="text-[#1C1B1B] font-bold text-sm tracking-[0.02em] uppercase">Live Alert Feed</h3>
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#DC2626] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#DC2626]"></span>
            </span>
          </div>

          {/* Lives at feed level (not on a card) so the explanation survives the refresh that may remove the card. */}
          {actionError && (
            <div role="alert" className="flex items-start justify-between gap-2 px-5 py-2 text-[11px] font-bold text-red-700 bg-red-50 border-b border-red-200">
              <span>{actionError}</span>
              <button type="button" onClick={() => setActionError(null)} aria-label="Dismiss" className="shrink-0 text-red-700 hover:text-red-900">&times;</button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto divide-y divide-[#E5E2E1]">
            {feedAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-[#A1A1AA] py-12">
                <AlertTriangle className="w-10 h-10 mb-3 text-[#E5E2E1]" />
                <p className="text-sm font-bold text-[#5B403D]">No active alerts</p>
                <p className="text-xs text-[#5B403D] mt-1">All stations are on standby.</p>
              </div>
            ) : (
              feedAlerts.map(alert => {
                const device = (alert as any).devices || {};
                const deviceCode = device.device_code || 'Unknown';
                const deviceLabel = device.label || '';
                const loc = device.location_desc || '';
                const bfpContact = device.bfp_contact || '';

                const isFire = alert.alert_tier === 2;
                const badgeColor = isFire ? 'bg-red-600 text-white' : 'bg-amber-500 text-white';
                const badgeText = isFire ? 'CRITICAL FIRE' : 'ADVISORY';
                const textColor = isFire ? 'text-red-700' : 'text-amber-700';
                const bgLightColor = isFire ? 'bg-red-50' : 'bg-amber-50';

                return (
                  <div key={alert.id} className={`px-5 py-4 ${bgLightColor}`}>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex flex-col gap-1">
                        <span className={`text-[9px] font-bold tracking-wider uppercase px-2 py-0.5 rounded self-start ${badgeColor}`}>
                          {badgeText}
                        </span>
                        <h4 className={`font-bold text-sm ${textColor}`}>
                          {deviceCode}: {deviceLabel}
                        </h4>
                        <p className="text-[#5B403D] text-xs font-medium">{loc}</p>
                      </div>
                      <span className="text-[10px] font-bold tracking-wider uppercase text-gray-500 whitespace-nowrap">
                        <TickingTimer triggeredAt={alert.triggered_at} />
                      </span>
                    </div>
                    {/* Sensor Readings */}
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <div className="bg-white/60 border border-white rounded px-3 py-2">
                        <span className="text-[9px] text-[#5B403D] uppercase tracking-wider font-bold block">Peak Temp</span>
                        <span className={`font-bold text-sm ${textColor}`}>{alert.temp_celsius}°C</span>
                      </div>
                      <div className="bg-white/60 border border-white rounded px-3 py-2">
                        <span className="text-[9px] text-[#5B403D] uppercase tracking-wider font-bold block">CO Level</span>
                        <span className={`font-bold text-sm ${textColor}`}>{alert.co_ppm} ppm</span>
                      </div>
                    </div>

                    {/* Interactive Dispatch Actions */}
                    <div className="mt-4 flex flex-col gap-2">
                      <div className="grid grid-cols-2 gap-2">
                        {availableTransitions(alert.incident_status, 'bfp_responder').map(target => {
                          const busy = acknowledging === alert.id;
                          const spec = {
                            acknowledged: { label: 'Acknowledge Alarm', cls: 'bg-indigo-600 hover:bg-indigo-700 col-span-2' },
                            responding: { label: 'Dispatch Unit', cls: 'bg-blue-600 hover:bg-blue-700 col-span-2' },
                            resolved: { label: 'Resolve', cls: 'bg-emerald-600 hover:bg-emerald-700' },
                            false_alarm: { label: 'False Alarm', cls: 'bg-gray-600 hover:bg-gray-700' },
                          }[target];
                          return (
                            <button
                              key={target}
                              onClick={() => handleTransition(alert.id, target)}
                              disabled={busy}
                              className={`w-full ${spec.cls} text-white text-[10px] font-bold tracking-[0.05em] uppercase px-3 py-2 rounded transition-colors disabled:opacity-50`}
                            >
                              {busy && (target === 'acknowledged' || target === 'responding') ? 'Updating...' : spec.label}
                            </button>
                          );
                        })}
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-1">
                        <a
                          href={isValidCoordinate(alert.latitude, alert.longitude) ? `https://www.google.com/maps/dir/?api=1&destination=${alert.latitude},${alert.longitude}` : '#'}
                          target="_blank"
                          rel="noreferrer"
                          className={`flex items-center justify-center gap-1.5 w-full bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-[10px] font-bold tracking-[0.05em] uppercase px-3 py-2 rounded transition-colors ${!isValidCoordinate(alert.latitude, alert.longitude) && 'opacity-50 pointer-events-none'}`}
                        >
                          <Navigation className="w-3 h-3" /> Open Navigation
                        </a>
                        <a
                          href={bfpContact ? `tel:${bfpContact}` : '#'}
                          className={`flex items-center justify-center gap-1.5 w-full bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-[10px] font-bold tracking-[0.05em] uppercase px-3 py-2 rounded transition-colors ${!bfpContact && 'opacity-50 pointer-events-none'}`}
                        >
                          <PhoneCall className="w-3 h-3" /> Call Site Guard / Admin
                        </a>
                      </div>
                      {!isValidCoordinate(alert.latitude, alert.longitude) ? (
                        <p className="text-[10px] font-medium text-gray-500">Location unavailable for this alert.</p>
                      ) : !alert.gps_valid ? (
                        <p className="text-[10px] font-medium text-amber-700">Navigation target is a last-known position, not a live GPS fix.</p>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>

        </div>
      </div>
    </div>
  );
};

// ─── Helper Components ───

const StatCard = ({ label, value, subValue, color, icon, highlightClass = "" }: { label: string; value: string; subValue?: string; color: string; icon: React.ReactNode; highlightClass?: string }) => (
  <div className={`${highlightClass ? highlightClass : 'bg-[#F6F3F2]'} border border-[#E5E2E1] rounded-lg px-5 py-4 flex flex-col gap-1`}>
    <span className="text-[#5B403D] font-bold text-[10px] tracking-[0.1em] uppercase">{label}</span>
    <div className="flex items-end justify-between">
      <div className="flex flex-col">
        <span className="font-extrabold text-[36px] leading-[40px] tracking-[-0.05em]" style={{ color }}>
          {value}
        </span>
        {subValue && <span className="text-[11px] font-bold tracking-[0.02em]" style={{ color }}>{subValue}</span>}
      </div>
      <div className="pb-1" style={{ color }}>{icon}</div>
    </div>
  </div>
);

const LegendDot = ({ color, label }: { color: string; label: string }) => (
  <div className="flex items-center gap-2">
    <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }}></span>
    <span className="text-white/80 text-[10px] font-medium uppercase tracking-[0.05em]">{label}</span>
  </div>
);

const MapUpdater = ({ devices }: { devices: DeviceWithStatus[] }) => {
  const map = useMap();

  useEffect(() => {
    // Prevent Leaflet container re-render/initialization bugs when navigating between tabs
    setTimeout(() => {
      map.invalidateSize();
    }, 100);
  }, [map]);

  useEffect(() => {
    const validDevices = devices.filter(d => d.latitude != null && d.longitude != null);
    if (validDevices.length > 0) {
      const bounds = L.latLngBounds(validDevices.map(d => [d.latitude as number, d.longitude as number]));
      map.fitBounds(bounds, { maxZoom: 15, padding: [20, 20] });
    } else {
      map.flyTo([14.8527, 120.8160], 14, { duration: 1.5 });
    }
  }, [devices, map]);
  return null;
};
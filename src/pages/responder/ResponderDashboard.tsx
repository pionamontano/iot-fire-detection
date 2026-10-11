import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import type { Device, AlertEvent } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { ResponderDashboardSkeleton } from '../../components/SkeletonLoaders';
import {
  AlertTriangle,
  Wifi,
  WifiOff,
  Clock,
  Search,
  MapPin,
  Filter,
  Loader2,
  PhoneCall,
  Navigation,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';

// ─── Map Marker Icons ───
const createCustomIcon = (type: 'online' | 'alert' | 'fault' | 'offline') => {
  let color = '#10B981'; // Green (Online)
  let glow = 'rgba(16, 185, 129, 0.3)';
  let size = 10;

  if (type === 'alert') {
    color = '#DC2626'; // Red (Fire Alert)
    glow = 'rgba(220, 38, 38, 0.4)';
    size = 16;
  } else if (type === 'fault') {
    color = '#F59E0B'; // Amber (Fault)
    glow = 'rgba(245, 158, 11, 0.3)';
    size = 14;
  } else if (type === 'offline') {
    color = '#71717A'; // Gray (Offline)
    glow = 'transparent';
    size = 10;
  }

  const html = `
    <div style="position: relative; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">
      ${type === 'alert' ? `<div style="position: absolute; width: 48px; height: 48px; background: ${glow}; border-radius: 50%; animation: pulse 2s infinite;"></div>` : ''}
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

const fireIcon = createCustomIcon('alert');
const faultIcon = createCustomIcon('fault');
const normalIcon = createCustomIcon('online');
const offlineIcon = createCustomIcon('offline');

type DeviceWithStatus = Device & {
  status: 'fire' | 'fault' | 'normal' | 'offline';
  activeAlert?: AlertEvent;
  connectivity: number;
};

const timeAgo = (dateStr: string) => {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'JUST NOW';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} MIN AGO`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h AGO`;
  return `${Math.floor(hours / 24)}d AGO`;
};


export const ResponderDashboard = () => {
  const [devices, setDevices] = useState<DeviceWithStatus[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const [klaxonArmed, setKlaxonArmed] = useState(true);

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


  const handleAcknowledge = async (alertId: string) => {
    setAcknowledging(alertId);
    try {
      await supabase
        .from('alert_events')
        .update({
          incident_status: 'acknowledged',
          acknowledged_by: profile?.id,
          acknowledged_at: new Date().toISOString()
        })
        .eq('id', alertId);
      await fetchData();
    } catch (err) {
      console.error("Failed to acknowledge:", err);
    }
    setAcknowledging(null);
  };

  const handleUpdateStatus = async (alertId: string, newStatus: string) => {
    setAcknowledging(alertId);
    try {
      await supabase
        .from('alert_events')
        .update({
          incident_status: newStatus
        })
        .eq('id', alertId);
      await fetchData();
    } catch (err) {
      console.error("Failed to update status:", err);
    }
    setAcknowledging(null);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [devicesRes, alertsRes] = await Promise.all([
      supabase.from('devices_safe').select('*, sensor_readings(latitude, longitude, recorded_at)')
        .order('recorded_at', { foreignTable: 'sensor_readings', ascending: false })
        .limit(1, { foreignTable: 'sensor_readings' })
        .order('created_at', { ascending: false }),
      supabase.from('alert_events').select('*, devices(device_code, label, location_desc, bfp_contact)').order('triggered_at', { ascending: false }),
    ]);

    const allAlerts = (alertsRes.data || []) as unknown as AlertEvent[];
    const unresolvedAlerts = allAlerts.filter(a => !a.resolved_at);

    const enriched: DeviceWithStatus[] = (devicesRes.data || []).map((d: any) => {
      const alert = unresolvedAlerts.find(a => a.device_id === d.id);
      let status: DeviceWithStatus['status'] = 'normal';
      if (alert) {
        status = alert.alert_tier === 2 ? 'fire' : 'fault';
      } else if (!d.is_active) {
        status = 'offline';
      } else if (d.last_seen_at) {
        const lastSeen = new Date(d.last_seen_at).getTime();
        if (Date.now() - lastSeen > 5 * 60 * 1000) status = 'offline';
      } else {
        status = 'offline';
      }
      
      let lat = d.latitude;
      let lng = d.longitude;

      const readings = d.sensor_readings as any[] || [];
      if (readings.length > 0) {
        const latest = readings[0];
        if (latest.latitude != null && latest.longitude != null) {
          lat = latest.latitude;
          lng = latest.longitude;
        }
      }

      if (!lat || !lng) {
        let hash = 0;
        for (let j = 0; j < d.id.length; j++) {
          hash = ((hash << 5) - hash) + d.id.charCodeAt(j);
          hash |= 0;
        }
        lat = 14.8527 + ((hash & 0xFFFF) / 0xFFFF - 0.5) * 0.01;
        lng = 120.8160 + (((hash >> 16) & 0xFFFF) / 0xFFFF - 0.5) * 0.01;
      }

      // Simulate connectivity % based on status
      const connectivity = status === 'offline' ? 0 : status === 'fire' ? 98 : status === 'fault' ? 92 : 100;

      const { sensor_readings, ...deviceWithoutReadings } = d;

      return { ...deviceWithoutReadings, status, activeAlert: alert, connectivity, latitude: lat, longitude: lng };
    });

    setDevices(enriched);
    setActiveAlerts(unresolvedAlerts);
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

  // Counts
  const activeAlarmCount = devices.filter(d => d.status === 'fire').length;
  const preAlertsCount = devices.filter(d => d.status === 'fault').length;
  const devicesOnline = devices.filter(d => d.status !== 'offline').length;
  const totalDevices = devices.length;
  const coveragePercent = totalDevices > 0 ? ((devicesOnline / totalDevices) * 100).toFixed(1) : '0.0';
  const coverageText = `${devicesOnline} / ${totalDevices} Online (${coveragePercent}% Coverage)`;

  // Live feed alerts (top 5 unresolvedAlerts with device join data)
  const feedAlerts = activeAlerts.slice(0, 5);

  const mapBounds = useMemo(() => {
    const validDevices = devices.filter(d => d.latitude != null && d.longitude != null);
    if (validDevices.length === 0) return null;

    const bounds = L.latLngBounds(validDevices.map(d => [d.latitude as number, d.longitude as number]));
    return bounds;
  }, [devices]);

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

      {/* Zero Coverage Alert */}
      {totalDevices > 0 && devicesOnline === 0 && (
        <div className="bg-red-600 text-white font-bold px-4 py-3 rounded-lg flex items-center justify-center gap-2 mb-6">
          <AlertTriangle className="w-5 h-5" />
          CRITICAL: ALL TELEMETRY LOST (0 ONLINE DEVICES)
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
        <StatCard label="Monitored Coverage" value={totalDevices > 0 ? coverageText : "0 / 0 Online (0% Coverage)"} color="#10B981" icon={<Wifi className="w-5 h-5" />} isTextSmall />
        <StatCard label="Alerts Today" value={String(activeAlerts.length)} color="#DC2626" icon={<Clock className="w-5 h-5" />} />
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
            <MapUpdater devices={devices} />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {devices.map(device => {
              if (!device.latitude || !device.longitude) return null;
              const icon = device.status === 'fire' ? fireIcon : device.status === 'fault' ? faultIcon : device.status === 'offline' ? offlineIcon : normalIcon;
              return (
                <Marker key={device.id} position={[device.latitude as number, device.longitude as number]} icon={icon}>
                  <Popup>
                    <div className="font-sans">
                      <strong className="block text-sm font-bold">{device.device_code}</strong>
                      <span className="text-xs text-gray-600 block mt-1">{device.location_desc}</span>
                      <span className="text-xs font-bold mt-1 block capitalize" style={{ color: device.status === 'fire' ? '#DC2626' : device.status === 'fault' ? '#F59E0B' : device.status === 'offline' ? '#A1A1AA' : '#10B981' }}>
                        {device.status === 'fire' ? 'FIRE DETECTED' : device.status === 'fault' ? 'HIGH TEMP' : device.status === 'offline' ? 'OFFLINE' : 'HEALTHY'}
                      </span>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>

          {/* Map Legend */}
          <div className="absolute bottom-4 left-4 z-[1000] bg-[#1C1B1B]/80 backdrop-blur-sm rounded-md px-4 py-3 flex flex-col gap-2">
            <LegendDot color="#DC2626" label="Fire" />
            <LegendDot color="#F59E0B" label="Fault" />
            <LegendDot color="#10B981" label="Normal" />
            <LegendDot color="#A1A1AA" label="Offline" />
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
                        Triggered {timeAgo(alert.triggered_at).toLowerCase()}
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
                        {(!alert.incident_status || alert.incident_status === 'active') && (
                          <button
                            onClick={() => handleAcknowledge(alert.id)}
                            disabled={acknowledging === alert.id}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold tracking-[0.05em] uppercase px-3 py-2 rounded transition-colors disabled:opacity-50 col-span-2"
                          >
                            {acknowledging === alert.id ? 'Updating...' : 'Acknowledge Alarm'}
                          </button>
                        )}
                        {alert.incident_status === 'acknowledged' && (
                          <button
                            onClick={() => handleUpdateStatus(alert.id, 'responding')}
                            disabled={acknowledging === alert.id}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold tracking-[0.05em] uppercase px-3 py-2 rounded transition-colors disabled:opacity-50 col-span-2"
                          >
                            {acknowledging === alert.id ? 'Updating...' : 'Dispatch Unit'}
                          </button>
                        )}
                        {(alert.incident_status === 'acknowledged' || alert.incident_status === 'responding') && (
                          <>
                            <button
                              onClick={() => handleUpdateStatus(alert.id, 'resolved')}
                              disabled={acknowledging === alert.id}
                              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold tracking-[0.05em] uppercase px-3 py-2 rounded transition-colors disabled:opacity-50"
                            >
                              Resolve
                            </button>
                            <button
                              onClick={() => handleUpdateStatus(alert.id, 'false_alarm')}
                              disabled={acknowledging === alert.id}
                              className="w-full bg-gray-600 hover:bg-gray-700 text-white text-[10px] font-bold tracking-[0.05em] uppercase px-3 py-2 rounded transition-colors disabled:opacity-50"
                            >
                              False Alarm
                            </button>
                          </>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 mt-1">
                        <a
                          href={alert.latitude && alert.longitude ? `https://www.google.com/maps/dir/?api=1&destination=${alert.latitude},${alert.longitude}` : '#'}
                          target="_blank"
                          rel="noreferrer"
                          className={`flex items-center justify-center gap-1.5 w-full bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-[10px] font-bold tracking-[0.05em] uppercase px-3 py-2 rounded transition-colors ${!(alert.latitude && alert.longitude) && 'opacity-50 pointer-events-none'}`}
                        >
                          <Navigation className="w-3 h-3" /> Navigation
                        </a>
                        <a
                          href={bfpContact ? `tel:${bfpContact}` : '#'}
                          className={`flex items-center justify-center gap-1.5 w-full bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-[10px] font-bold tracking-[0.05em] uppercase px-3 py-2 rounded transition-colors ${!bfpContact && 'opacity-50 pointer-events-none'}`}
                        >
                          <PhoneCall className="w-3 h-3" /> Call Contact
                        </a>
                      </div>
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

const StatCard = ({ label, value, color, icon, highlightClass = "", isTextSmall = false }: { label: string; value: string; color: string; icon: React.ReactNode; highlightClass?: string; isTextSmall?: boolean }) => (
  <div className={`${highlightClass ? highlightClass : 'bg-[#F6F3F2]'} border border-[#E5E2E1] rounded-lg px-5 py-4 flex flex-col gap-1`}>
    <span className="text-[#5B403D] font-bold text-[10px] tracking-[0.1em] uppercase">{label}</span>
    <div className="flex items-end justify-between">
      <span className={`font-extrabold ${isTextSmall ? 'text-[24px]' : 'text-[36px]'} leading-[40px] tracking-[-0.05em]`} style={{ color }}>
        {value}
      </span>
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
      map.fitBounds(bounds, { maxZoom: 16, padding: [20, 20] });
    } else {
      map.flyTo([14.8527, 120.8160], 13, { duration: 1.5 });
    }
  }, [devices, map]);
  return null;
};
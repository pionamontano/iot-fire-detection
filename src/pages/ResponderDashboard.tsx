import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Device, AlertEvent } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { ResponderDashboardSkeleton } from '../components/SkeletonLoaders';
import {
  AlertTriangle,
  Wifi,
  WifiOff,
  Clock,
  Search,
  MapPin,
  Loader2,
  Filter,
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';

// ─── Map Marker Icons ───
const createIcon = (color: string, size = 14) =>
  new L.DivIcon({
    className: 'custom-leaflet-icon',
    html: `<div style="background:${color};width:${size}px;height:${size}px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px ${color}80;"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

const fireIcon = createIcon('#DC2626', 16);
const faultIcon = createIcon('#F59E0B', 14);
const normalIcon = createIcon('#10B981', 10);
const offlineIcon = createIcon('#A1A1AA', 10);

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
  const { profile } = useAuth();
  const [devices, setDevices] = useState<DeviceWithStatus[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [unitSearch, setUnitSearch] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<[number, number] | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [devicesRes, alertsRes] = await Promise.all([
      supabase.from('devices').select('*').order('created_at', { ascending: false }),
      supabase.from('alert_events').select('*, devices(device_code, label, location_desc)').order('triggered_at', { ascending: false }),
    ]);

    const allAlerts = (alertsRes.data || []) as unknown as AlertEvent[];
    const unresolvedAlerts = allAlerts.filter(a => !a.resolved_at);

    const enriched: DeviceWithStatus[] = (devicesRes.data || []).map(d => {
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
      if (!lat || !lng) {
        let hash = 0;
        for (let j = 0; j < d.id.length; j++) {
          hash = ((hash << 5) - hash) + d.id.charCodeAt(j);
          hash |= 0;
        }
        lat = 14.634 + ((hash & 0xFFFF) / 0xFFFF - 0.5) * 0.01;
        lng = 121.045 + (((hash >> 16) & 0xFFFF) / 0xFFFF - 0.5) * 0.01;
      }

      // Simulate connectivity % based on status
      const connectivity = status === 'offline' ? 0 : status === 'fire' ? 98 : status === 'fault' ? 92 : 100;
      return { ...d, status, activeAlert: alert, connectivity, latitude: lat, longitude: lng };
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
  const activeAlarmCount = devices.filter(d => d.status === 'fire' || d.status === 'fault').length;
  const devicesOnline = devices.filter(d => d.status !== 'offline').length;
  const devicesOffline = devices.filter(d => d.status === 'offline').length;
  const alertsToday = activeAlerts.length;

  // Filtered units for the bottom table
  const filteredUnits = devices.filter(d =>
    d.device_code.toLowerCase().includes(unitSearch.toLowerCase()) ||
    d.location_desc.toLowerCase().includes(unitSearch.toLowerCase())
  );

  // Live feed alerts (top 5 unresolvedAlerts with device join data)
  const feedAlerts = activeAlerts.slice(0, 5);

  if (loading) {
    return <ResponderDashboardSkeleton />;
  }

  return (
    <div className="space-y-8 pb-10">
      {/* ─── 4 Stat Cards ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard label="Active Alarms" value={String(activeAlarmCount).padStart(2, '0')} color="#DC2626" icon={<AlertTriangle className="w-5 h-5" />} />
        <StatCard label="Devices Online" value={devicesOnline.toLocaleString()} color="#10B981" icon={<Wifi className="w-5 h-5" />} />
        <StatCard label="Devices Offline" value={String(devicesOffline)} color="#A1A1AA" icon={<WifiOff className="w-5 h-5" />} />
        <StatCard label="Alerts Today" value={String(alertsToday)} color="#DC2626" icon={<Clock className="w-5 h-5" />} />
      </div>

      {/* ─── Map + Live Alert Feed ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Interactive Map (8/12) */}
        <div className="lg:col-span-8 bg-[#2D1F1E] rounded-lg overflow-hidden relative" style={{ minHeight: 420 }}>
          <MapContainer
            center={[14.634, 121.045]}
            zoom={16}
            style={{ height: '100%', width: '100%', minHeight: 420 }}
            className="z-0"
          >
            <MapUpdater center={selectedLocation} />
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
                const deviceCode = (alert as any).devices?.device_code || 'Unknown';
                const deviceLabel = (alert as any).devices?.label || '';
                const loc = (alert as any).devices?.location_desc || '';
                return (
                  <div key={alert.id} className="px-5 py-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h4 className="text-[#DC2626] font-bold text-sm">
                          {deviceCode} • {deviceLabel}
                        </h4>
                        <p className="text-[#5B403D] text-xs mt-0.5">{loc}</p>
                      </div>
                      <span className={`text-[9px] font-bold tracking-[0.05em] uppercase px-2 py-0.5 rounded ${
                        timeAgo(alert.triggered_at) === 'JUST NOW' ? 'bg-[#FEE2E2] text-[#DC2626]' : 'text-[#A1A1AA]'
                      }`}>
                        {timeAgo(alert.triggered_at)}
                      </span>
                    </div>
                    {/* Sensor Readings */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-[#FEF2F2] rounded px-3 py-2">
                        <span className="text-[9px] text-[#5B403D] uppercase tracking-[0.05em] font-bold block">Temp</span>
                        <span className="text-[#DC2626] font-bold text-sm">{alert.temp_celsius}°C</span>
                      </div>
                      <div className="bg-[#FEF2F2] rounded px-3 py-2">
                        <span className="text-[9px] text-[#5B403D] uppercase tracking-[0.05em] font-bold block">Smoke</span>
                        <span className="text-[#DC2626] font-bold text-sm">{alert.co_ppm > 0 ? `${Math.min(99, Math.round(alert.co_ppm / 5))}%` : '0%'}</span>
                      </div>
                    </div>
                    {alert.latitude && alert.longitude && (
                      <p className="text-[10px] text-[#A1A1AA] mt-2 flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {alert.latitude.toFixed(4)}° N, {alert.longitude.toFixed(4)}° E
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Dispatch CTA */}
          <div className="p-4 border-t border-[#E5E2E1]">
            <button className="w-full py-3 rounded text-white font-bold text-xs tracking-[0.05em] uppercase flex items-center justify-center gap-2 transition-all hover:shadow-md"
              style={{ background: 'linear-gradient(90deg, #AF101A 0%, #D32F2F 100%)' }}
            >
              Dispatch Response Team
            </button>
          </div>
        </div>
      </div>

      {/* ─── All Connected Units Table ─── */}
      <div className="bg-white border border-[#E5E2E1] rounded-lg overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
        {/* Table Header */}
        <div className="px-6 py-4 border-b border-[#E5E2E1] flex items-center justify-between">
          <h3 className="text-[#1C1B1B] font-bold text-sm tracking-[0.02em] uppercase">All Connected Units</h3>
          <div className="flex items-center gap-3">
            <div className="relative">
              <input
                type="text"
                placeholder="Search Device ID or Barangay..."
                value={unitSearch}
                onChange={e => setUnitSearch(e.target.value)}
                className="bg-[#F6F3F2] border border-[#E5E2E1] rounded pl-8 pr-3 py-1.5 text-xs w-56 focus:outline-none focus:border-[#DC2626]/40"
              />
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#A1A1AA]" />
            </div>
            <button className="p-1.5 border border-[#E5E2E1] rounded hover:bg-gray-50 transition-colors">
              <Filter className="w-3.5 h-3.5 text-[#5B403D]" />
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F6F3F2] border-b border-[#E5E2E1]">
                <th className="text-left px-6 py-3 text-[#5B403D] font-bold text-[10px] tracking-[0.05em] uppercase">Device ID</th>
                <th className="text-left px-6 py-3 text-[#5B403D] font-bold text-[10px] tracking-[0.05em] uppercase">Location</th>
                <th className="text-left px-6 py-3 text-[#5B403D] font-bold text-[10px] tracking-[0.05em] uppercase">Status</th>
                <th className="text-left px-6 py-3 text-[#5B403D] font-bold text-[10px] tracking-[0.05em] uppercase">Connectivity</th>
                <th className="text-left px-6 py-3 text-[#5B403D] font-bold text-[10px] tracking-[0.05em] uppercase">Internal Temp</th>
                <th className="text-left px-6 py-3 text-[#5B403D] font-bold text-[10px] tracking-[0.05em] uppercase">Last Signal</th>
                <th className="text-left px-6 py-3 text-[#5B403D] font-bold text-[10px] tracking-[0.05em] uppercase">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredUnits.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-[#A1A1AA] text-sm">No devices found.</td>
                </tr>
              ) : (
                filteredUnits.slice(0, 10).map(device => {
                  const statusLabel = device.status === 'fire' ? 'FIRE DETECTED' : device.status === 'fault' ? 'HIGH TEMP' : device.status === 'offline' ? 'OFFLINE' : 'HEALTHY';
                  const statusColor = device.status === 'fire' ? '#DC2626' : device.status === 'fault' ? '#F59E0B' : device.status === 'offline' ? '#A1A1AA' : '#10B981';
                  const statusBg = device.status === 'fire' ? 'bg-[#FEE2E2]' : device.status === 'fault' ? 'bg-[#FFEDD5]' : device.status === 'offline' ? 'bg-[#F3F4F6]' : 'bg-[#ECFDF5]';

                  return (
                    <tr 
                      key={device.id} 
                      className="border-b border-[#E5E2E1] last:border-0 hover:bg-[#FCF9F8] transition-colors cursor-pointer"
                      onClick={() => {
                        if (device.latitude && device.longitude) {
                          setSelectedLocation([device.latitude as number, device.longitude as number]);
                        }
                      }}
                    >
                      <td className="px-6 py-3.5">
                        <span className="font-bold text-xs text-[#1C1B1B]">{device.device_code}</span>
                      </td>
                      <td className="px-6 py-3.5">
                        <span className="text-[#5B403D] text-xs">{device.location_desc}</span>
                      </td>
                      <td className="px-6 py-3.5">
                        <span className={`inline-block px-2 py-0.5 rounded text-[9px] font-bold tracking-[0.03em] uppercase ${statusBg}`} style={{ color: statusColor }}>
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-6 py-3.5">
                        <span className="text-xs font-bold" style={{ color: statusColor }}>
                          ▲ {device.connectivity}%
                        </span>
                      </td>
                      <td className="px-6 py-3.5">
                        <span className="text-xs font-mono text-[#1C1B1B]">
                          {device.activeAlert?.temp_celsius ? `${device.activeAlert.temp_celsius}°C` : `${device.temp_threshold}°C`}
                        </span>
                      </td>
                      <td className="px-6 py-3.5">
                        <span className="text-xs text-[#5B403D]">
                          {device.last_seen_at ? timeAgo(device.last_seen_at) : 'N/A'}
                        </span>
                      </td>
                      <td className="px-6 py-3.5">
                        <button className="text-[#DC2626] font-bold text-xs hover:underline">Details</button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ─── Helper Components ───

const StatCard = ({ label, value, color, icon }: { label: string; value: string; color: string; icon: React.ReactNode }) => (
  <div className="bg-[#F6F3F2] border border-[#E5E2E1] rounded-lg px-5 py-4 flex flex-col gap-1">
    <span className="text-[#5B403D] font-bold text-[10px] tracking-[0.1em] uppercase">{label}</span>
    <div className="flex items-end justify-between">
      <span className="font-extrabold text-[36px] leading-[40px] tracking-[-0.05em]" style={{ color }}>
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

const MapUpdater = ({ center }: { center: [number, number] | null }) => {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.flyTo(center, 16, { duration: 1.5 });
    }
  }, [center, map]);
  return null;
};
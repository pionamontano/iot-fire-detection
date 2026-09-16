import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Device, AlertEvent } from '../lib/supabase';
import { 
  Search, 
  MapPin, 
  AlertTriangle, 
  Clock, 
  Activity,
  Layers,
  ZoomIn,
  ZoomOut,
  Crosshair
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Default center: arbitrary coords for campus (e.g. Quezon City area)
const DEFAULT_CENTER: [number, number] = [14.634, 121.045];
const DEFAULT_ZOOM = 16;

// Custom Icons
const createCustomIcon = (type: 'online' | 'alert' | 'fault' | 'offline') => {
  let color = '#10B981'; // Green (Online)
  let glow = 'rgba(16, 185, 129, 0.3)';
  
  if (type === 'alert') {
    color = '#DC2626'; // Red (Fire Alert)
    glow = 'rgba(220, 38, 38, 0.4)';
  } else if (type === 'fault') {
    color = '#F59E0B'; // Amber (Fault)
    glow = 'rgba(245, 158, 11, 0.3)';
  } else if (type === 'offline') {
    color = '#71717A'; // Gray (Offline)
    glow = 'transparent';
  }

  const html = `
    <div style="position: relative; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">
      ${type === 'alert' ? `<div style="position: absolute; width: 48px; height: 48px; background: ${glow}; border-radius: 50%; animation: pulse 2s infinite;"></div>` : ''}
      <div style="width: 16px; height: 16px; background: ${color}; border: 2px solid white; border-radius: 50%; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); position: relative; z-index: 10;"></div>
    </div>
  `;

  return L.divIcon({
    html,
    className: 'custom-leaflet-marker',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12]
  });
};

const iconCache = {
  online: createCustomIcon('online'),
  alert: createCustomIcon('alert'),
  fault: createCustomIcon('fault'),
  offline: createCustomIcon('offline')
};

const getDeviceStatus = (device: Device, activeAlerts: AlertEvent[]): 'online' | 'alert' | 'fault' | 'offline' => {
  const alert = activeAlerts.find(a => a.device_id === device.id);
  if (alert) {
    return alert.alert_tier === 1 ? 'alert' : 'fault';
  }
  if (!device.is_active) return 'offline';
  if (device.last_seen_at) {
    const lastSeen = new Date(device.last_seen_at).getTime();
    if (Date.now() - lastSeen > 5 * 60 * 1000) return 'offline';
  } else {
    return 'offline';
  }
  return 'online';
};

const timeAgo = (dateStr: string) => {
  const seconds = Math.floor((new Date().getTime() - new Date(dateStr).getTime()) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + "y ago";
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + "mo ago";
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + "d ago";
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + "h ago";
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + "m ago";
  return Math.floor(seconds) + "s ago";
};

export const InteractiveMap = () => {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<Device[]>([]);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  
  // Controls
  const [hideOffline, setHideOffline] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'fires' | 'faults'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchData();

    const deviceSub = supabase.channel('map_devices')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, fetchData)
      .subscribe();

    const alertSub = supabase.channel('map_alerts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alert_events' }, fetchData)
      .subscribe();

    return () => {
      supabase.removeChannel(deviceSub);
      supabase.removeChannel(alertSub);
    };
  }, []);

  const fetchData = async () => {
    try {
      // Fetch devices and all recent alerts for the feed (limit 50)
      const [devicesRes, alertsRes] = await Promise.all([
        supabase.from('devices').select('*'),
        supabase.from('alert_events').select('*, devices(device_code, location_desc)').order('triggered_at', { ascending: false }).limit(50)
      ]);

      if (devicesRes.data) {
        // Generate stable coordinates from device ID so markers don't jump on re-render
        const withCoords = devicesRes.data.map((d, i) => {
          if (!d.latitude || !d.longitude) {
            // Simple deterministic hash from device ID to generate consistent offsets
            let hash = 0;
            for (let j = 0; j < d.id.length; j++) {
              hash = ((hash << 5) - hash) + d.id.charCodeAt(j);
              hash |= 0; // Convert to 32-bit integer
            }
            const latOffset = ((hash & 0xFFFF) / 0xFFFF - 0.5) * 0.01;
            const lngOffset = (((hash >> 16) & 0xFFFF) / 0xFFFF - 0.5) * 0.01;
            return {
              ...d,
              latitude: DEFAULT_CENTER[0] + latOffset,
              longitude: DEFAULT_CENTER[1] + lngOffset
            };
          }
          return d;
        });
        setDevices(withCoords);
      }
      if (alertsRes.data) setAlerts(alertsRes.data as unknown as AlertEvent[]);
    } catch (error) {
      console.error('Error fetching map data', error);
    }
  };

  const activeAlerts = alerts.filter(a => !a.resolved_at);
  const activeFireCount = activeAlerts.filter(a => a.alert_tier === 1).length;

  // Filter devices to display
  const displayedDevices = devices.filter(d => {
    const status = getDeviceStatus(d, activeAlerts);
    if (hideOffline && status === 'offline') return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!d.device_code.toLowerCase().includes(q) && !d.location_desc.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Filter feed alerts
  const feedAlerts = alerts.filter(a => {
    if (filterType === 'fires') return a.alert_tier === 1;
    if (filterType === 'faults') return a.alert_tier === 2;
    return true;
  });

  return (
    <div className="flex w-full h-full relative overflow-hidden bg-[#E5E2E1]" style={{ isolation: 'isolate' }}>
      {/* ─── MAP LAYER ─── */}
      <div className="flex-1 h-full relative" style={{ zIndex: 0 }}>
        <MapContainer 
          center={DEFAULT_CENTER} 
          zoom={DEFAULT_ZOOM} 
          className="w-full h-full"
          zoomControl={false}
          ref={setMapInstance}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ZoomControl position="bottomright" />
          
          {displayedDevices.map(device => {
            const status = getDeviceStatus(device, activeAlerts);
            const activeAlertForDevice = activeAlerts.find(a => a.device_id === device.id);
            
            return (
              <Marker 
                key={device.id} 
                position={[device.latitude as number, device.longitude as number]}
                icon={iconCache[status]}
              >
                <Popup className="custom-popup" closeButton={false} minWidth={240}>
                  <div className="flex flex-col bg-white/70 backdrop-blur-md rounded-lg overflow-hidden border border-[#DC2626]/30 shadow-xl">
                    <div className={`flex items-center justify-between px-4 py-2 text-white ${status === 'alert' ? 'bg-[#DC2626]' : status === 'fault' ? 'bg-[#F59E0B]' : 'bg-[#005F7B]'}`}>
                      <span className="font-extrabold text-[10px] tracking-widest uppercase">
                        {status === 'alert' ? 'FIRE DETECTED' : status === 'fault' ? 'FAULT DETECTED' : 'SYSTEM NORMAL'}
                      </span>
                      <Activity className="w-3 h-3" />
                    </div>
                    <div className="p-4 flex flex-col gap-3 bg-[#FCF9F8]/80">
                      <div>
                        <h3 className="font-bold text-sm text-[#18181B]">{device.device_code}</h3>
                        <p className="text-xs text-[#71717A] mt-0.5">{device.location_desc}</p>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-white/50 border border-gray-100 rounded p-2">
                          <span className="block text-[9px] font-bold text-[#A1A1AA] uppercase">Temp</span>
                          <span className="block font-extrabold text-sm text-[#DC2626]">
                            {activeAlertForDevice ? activeAlertForDevice.temp_celsius : 24.5}°C
                          </span>
                        </div>
                        <div className="bg-white/50 border border-gray-100 rounded p-2">
                          <span className="block text-[9px] font-bold text-[#A1A1AA] uppercase">CO Level</span>
                          <span className="block font-extrabold text-sm text-[#DC2626]">
                            {activeAlertForDevice ? activeAlertForDevice.co_ppm : 15}ppm
                          </span>
                        </div>
                      </div>

                      <button 
                        className={`w-full py-2 rounded text-[10px] font-extrabold uppercase tracking-widest text-white mt-1 transition-colors ${status === 'alert' ? 'bg-[#AF101A] hover:bg-[#8F0C14]' : 'bg-[#00799C] hover:bg-[#005F7B]'}`}
                      >
                        {status === 'alert' ? 'Dispatch Details' : 'View Sensor Log'}
                      </button>
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>

        {/* ─── FLOATING OVERLAYS (TOP) ─── */}
        <div className="absolute top-6 left-6 right-6 flex justify-between pointer-events-none" style={{ zIndex: 1000 }}>
          {/* Top Left Controls */}
          <div className="flex gap-3 pointer-events-auto">
            {/* Search */}
            <div className="bg-white/80 backdrop-blur-md border border-white/40 shadow-sm rounded-lg flex items-center h-[42px] px-3">
              <Search className="w-4 h-4 text-[#A1A1AA] mr-2" />
              <input 
                type="text" 
                placeholder="Search device ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent border-none outline-none text-sm w-48 text-[#3F3F46] placeholder:text-[#A1A1AA]"
              />
            </div>
            
            {/* Toggles */}
            <div className="bg-white/80 backdrop-blur-md border border-white/40 shadow-sm rounded-lg flex items-center h-[42px] overflow-hidden p-1">
              <button 
                onClick={() => setHideOffline(!hideOffline)}
                className={`px-4 h-full rounded text-xs font-bold uppercase transition-colors ${hideOffline ? 'bg-[#AF101A] text-white' : 'text-[#AF101A] hover:bg-[#AF101A]/10'}`}
              >
                Hide Offline
              </button>
              <div className="w-px h-6 bg-gray-200 mx-1"></div>
              <button className="px-4 h-full rounded text-xs font-bold uppercase text-[#71717A] hover:bg-gray-100 transition-colors">
                Clustering: ON
              </button>
            </div>
          </div>

          {/* Top Right Latency Widget */}
          <div className="bg-white/80 backdrop-blur-md border border-white/40 shadow-sm rounded-lg p-2 px-4 flex items-center gap-3 pointer-events-auto h-[42px]">
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] leading-tight">Signal</span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#71717A] leading-tight">Latency</span>
            </div>
            <span className="font-semibold text-sm text-[#005F7B]">42ms</span>
            <div className="flex gap-0.5 items-end h-3">
              <div className="w-1 h-1.5 bg-[#005F7B] rounded-full"></div>
              <div className="w-1 h-2 bg-[#005F7B] rounded-full"></div>
              <div className="w-1 h-2.5 bg-[#005F7B] rounded-full"></div>
              <div className="w-1 h-3 bg-gray-300 rounded-full"></div>
            </div>
          </div>
        </div>

        {/* ─── LEGEND OVERLAY (BOTTOM LEFT) ─── */}
        <div className="absolute bottom-6 left-6 pointer-events-auto" style={{ zIndex: 1000 }}>
          <div className="bg-white/80 backdrop-blur-md border border-white/40 shadow-sm rounded-lg py-2 px-4 flex items-center gap-6">
            <LegendItem color="bg-[#DC2626]" label="Active Fire" />
            <LegendItem color="bg-[#10B981]" label="Normal" />
            <LegendItem color="bg-[#F59E0B]" label="Fault" />
            <LegendItem color="bg-[#71717A]" label="Offline" />
          </div>
        </div>

        {/* CSS for custom popup styling */}
        <style dangerouslySetInnerHTML={{__html: `
          .custom-popup .leaflet-popup-content-wrapper { background: transparent; box-shadow: none; padding: 0; }
          .custom-popup .leaflet-popup-tip-container { display: none; }
          .custom-popup .leaflet-popup-content { margin: 0; width: 240px !important; }
        `}} />
      </div>

      {/* ─── RIGHT PANEL: LIVE ALERT FEED ─── */}
      <div className="w-[320px] bg-white/70 backdrop-blur-md border-l border-white/50 shadow-2xl flex flex-col relative h-full" style={{ zIndex: 1 }}>
        <div className="p-6 pb-4 flex flex-col gap-6 shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-[#18181B] font-extrabold text-sm uppercase tracking-widest">Live Alert Feed</h2>
            <div className="bg-[#FEE2E2] px-2 py-0.5 rounded-full">
              <span className="text-[#B91C1C] font-extrabold text-[10px]">{activeFireCount} Active</span>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-2">
            <FilterBtn label="All" active={filterType === 'all'} onClick={() => setFilterType('all')} />
            <FilterBtn label="Fires" active={filterType === 'fires'} onClick={() => setFilterType('fires')} />
            <FilterBtn label="Faults" active={filterType === 'faults'} onClick={() => setFilterType('faults')} />
          </div>
        </div>

        {/* Feed List */}
        <div className="flex-1 overflow-y-auto px-6 pb-6 flex flex-col gap-4">
          {feedAlerts.map(alert => {
            const isResolved = !!alert.resolved_at;
            const isFire = alert.alert_tier === 1;
            const deviceLabel = alert.devices?.device_code || 'Unknown';
            const locLabel = alert.devices?.location_desc || 'Unknown Location';
            
            // Base styles based on type/state
            let bgClass = isFire ? 'bg-[#FEF2F2]' : 'bg-[#FFFBEB]';
            let borderClass = isFire ? 'border-l-4 border-[#DC2626]' : 'border-l-4 border-[#F59E0B]';
            let iconClass = isFire ? 'text-[#DC2626]' : 'text-[#D97706]';
            let titleClass = isFire ? 'text-[#B91C1C]' : 'text-[#B45309]';
            let title = isFire ? 'Fire Alert' : 'Fault';
            let subtitle = isFire ? 'Critical Heat/CO Rise' : 'Sensor Calibration Error';
            
            if (isResolved) {
              bgClass = 'bg-white/50';
              borderClass = 'border border-gray-200';
              iconClass = 'text-[#A1A1AA]';
              titleClass = 'text-[#71717A]';
              title = 'Resolved';
            }

            return (
              <div key={alert.id} className={`${bgClass} ${borderClass} rounded-lg p-4 shadow-sm relative transition-opacity ${isResolved ? 'opacity-60' : 'opacity-100'}`}>
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <Activity className={`w-3 h-3 ${iconClass}`} />
                    <span className={`font-extrabold text-xs uppercase ${titleClass}`}>{title}</span>
                  </div>
                  <span className="text-[9px] font-bold text-[#A1A1AA]">{timeAgo(isResolved ? (alert.resolved_at as string) : alert.triggered_at)}</span>
                </div>
                <h4 className="font-bold text-sm text-[#18181B] mb-0.5">{deviceLabel}</h4>
                <p className="text-xs text-[#71717A] mb-2 truncate" title={locLabel}>{locLabel}</p>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] font-bold uppercase tracking-widest ${iconClass}`}>{subtitle}</span>
                </div>
              </div>
            );
          })}

          {feedAlerts.length === 0 && (
            <div className="text-center py-8 text-[#A1A1AA] text-xs font-bold uppercase">
              No alerts found
            </div>
          )}
          
          {feedAlerts.length > 0 && (
            <div className="py-4 flex justify-center border-t border-dashed border-gray-300 mt-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">End of Recent Feed</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 bg-white/30 border-t border-white/50 shrink-0">
          <button 
            onClick={() => navigate('/admin/logs')}
            className="w-full bg-[#18181B] text-white py-3 rounded text-xs font-extrabold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-black transition-colors"
          >
            <Layers className="w-4 h-4" />
            View Full Log
          </button>
        </div>
      </div>
    </div>
  );
};

// Helper Components
const LegendItem = ({ color, label }: { color: string, label: string }) => (
  <div className="flex items-center gap-2">
    <div className={`w-2 h-2 rounded-full ${color}`}></div>
    <span className="text-[10px] font-bold uppercase tracking-widest text-[#71717A]">{label}</span>
  </div>
);

const FilterBtn = ({ label, active, onClick }: { label: string, active: boolean, onClick: () => void }) => (
  <button 
    onClick={onClick}
    className={`px-3 py-2 rounded text-[10px] font-extrabold uppercase tracking-widest transition-colors ${active ? 'bg-[#18181B] text-white' : 'text-[#71717A] hover:bg-gray-100'}`}
  >
    {label}
  </button>
);

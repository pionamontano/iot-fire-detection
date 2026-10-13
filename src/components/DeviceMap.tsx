import React, { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, ZoomControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Activity } from 'lucide-react';
import { describeLocation, isValidCoordinate, markerOpacity, formatAge } from '../lib/location';
import { getMapStatus } from '../lib/deviceStatus';
import type { MapStatus } from '../lib/deviceStatus';
import type { Device, AlertEvent } from '../lib/supabase';
import { MAP_DEFAULT_CENTER as DEFAULT_CENTER, MAP_DEFAULT_ZOOM as DEFAULT_ZOOM, MAP_STATUS_STYLE } from '../lib/mapDevices';
import type { DeviceOnMap } from '../lib/mapDevices';

// Shared live device map, used both as the Dashboard preview and as the
// full-screen Live Map page. This is a status map (one pin per device,
// colored by alert/connectivity state), not an interpolated heatmap: with a
// handful of point sensors an interpolated surface would invent readings
// for places nobody is measuring.

const createIcon = (status: MapStatus) => {
  const { color } = MAP_STATUS_STYLE[status];
  const pulse = status === 'fire'
    ? `<div style="position: absolute; width: 48px; height: 48px; background: rgba(220, 38, 38, 0.4); border-radius: 50%; animation: pulse 2s infinite;"></div>`
    : '';
  const html = `
    <div style="position: relative; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">
      ${pulse}
      <div style="width: 16px; height: 16px; background: ${color}; border: 2px solid white; border-radius: 50%; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); position: relative; z-index: 10;"></div>
    </div>
  `;
  return L.divIcon({ html, className: 'custom-leaflet-marker', iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12] });
};

const iconCache: Record<MapStatus, L.DivIcon> = {
  fire: createIcon('fire'),
  warning: createIcon('warning'),
  normal: createIcon('normal'),
  offline: createIcon('offline'),
};

export const MapLegend = () => (
  <div className="bg-white/80 backdrop-blur-md border border-white/40 shadow-sm rounded-lg py-2 px-4 flex flex-wrap items-center gap-x-6 gap-y-1">
    {(Object.keys(MAP_STATUS_STYLE) as MapStatus[]).map(s => (
      <div key={s} className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full" style={{ background: MAP_STATUS_STYLE[s].color }}></div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#52525B]">{MAP_STATUS_STYLE[s].label}</span>
      </div>
    ))}
  </div>
);

interface DeviceMapProps {
  devices: DeviceOnMap[];
  activeAlerts: AlertEvent[];
  now: number;
  onViewDetails: (device: DeviceOnMap) => void;
  /** Dashboard preview: no scroll-wheel zoom so the page still scrolls past it. */
  compact?: boolean;
  selectedDeviceId?: string | null;
  onSelectionHandled?: () => void;
  children?: React.ReactNode;
}

export const DeviceMap = ({
  devices,
  activeAlerts,
  now,
  onViewDetails,
  compact = false,
  selectedDeviceId = null,
  onSelectionHandled,
  children,
}: DeviceMapProps) => {
  const markerRefs = useRef<Record<string, L.Marker | null>>({});

  return (
    <div className="w-full h-full relative" style={{ zIndex: 0, isolation: 'isolate' }}>
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        className="w-full h-full"
        zoomControl={false}
        scrollWheelZoom={!compact}
      >
        <MapBoundsUpdater devices={devices} />
        {onSelectionHandled && (
          <MapFocusController
            selectedDeviceId={selectedDeviceId}
            devices={devices}
            markerRefs={markerRefs}
            onDone={onSelectionHandled}
          />
        )}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ZoomControl position="bottomright" />

        {devices.map(device => {
          if (device.location.kind === 'unavailable' || !isValidCoordinate(device.latitude, device.longitude)) return null;
          const status = getMapStatus(device, activeAlerts, now);
          return (
            <Marker
              key={device.id}
              position={[device.latitude as number, device.longitude as number]}
              icon={iconCache[status]}
              opacity={markerOpacity(device.location.kind)}
              ref={(el) => { markerRefs.current[device.id] = el; }}
            >
              <Popup className="custom-popup" closeButton={false} minWidth={240}>
                <DevicePopup
                  device={device}
                  status={status}
                  activeAlert={activeAlerts.find(a => a.device_id === device.id)}
                  now={now}
                  onViewDetails={() => onViewDetails(device)}
                />
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {children}

      <style dangerouslySetInnerHTML={{__html: `
        .custom-popup .leaflet-popup-content-wrapper { background: transparent; box-shadow: none; padding: 0; }
        .custom-popup .leaflet-popup-tip-container { display: none; }
        .custom-popup .leaflet-popup-content { margin: 0; width: 240px !important; }
      `}} />
    </div>
  );
};

const DevicePopup = ({
  device,
  status,
  activeAlert,
  now,
  onViewDetails,
}: {
  device: DeviceOnMap;
  status: MapStatus;
  activeAlert: AlertEvent | undefined;
  now: number;
  onViewDetails: () => void;
}) => {
  const style = MAP_STATUS_STYLE[status];
  const locInfo = describeLocation(device.location, now);
  const isAlerting = status === 'fire' || status === 'warning';
  // An active alert's trigger values take precedence; otherwise show the
  // device's latest reading (previously this popup showed "—" for every
  // non-alerting device even when readings existed).
  const latest = device.sensor_readings?.[0];
  const temp = activeAlert?.temp_celsius ?? latest?.temp_celsius;
  const co = activeAlert?.co_ppm ?? latest?.co_ppm;
  const readingAt = activeAlert?.triggered_at ?? latest?.recorded_at;
  const valueColor = isAlerting ? 'text-[#DC2626]' : 'text-[#18181B]';

  return (
    <div className="flex flex-col bg-white/90 backdrop-blur-md rounded-lg overflow-hidden border border-black/10 shadow-xl">
      <div className={`flex items-center justify-between px-4 py-2 text-white ${style.headerBg}`}>
        <span className="font-extrabold text-[10px] tracking-widest uppercase">{style.header}</span>
        <Activity className="w-3 h-3" />
      </div>
      <div className="p-4 flex flex-col gap-3 bg-[#FCF9F8]/80">
        <div>
          <h3 className="font-bold text-sm text-[#18181B]">
            {device.device_code}
            {device.label && <span className="font-medium text-[#71717A]"> · {device.label}</span>}
          </h3>
          <p className="text-xs text-[#71717A] mt-0.5">{device.location_desc}</p>
          <p className="text-[10px] mt-1 font-bold" style={{ color: locInfo.approximate ? '#B45309' : '#047857' }}>
            {locInfo.label} - {locInfo.detail}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="bg-white/60 border border-gray-100 rounded p-2">
            <span className="block text-[9px] font-bold text-[#71717A] uppercase">Temp</span>
            <span className={`block font-extrabold text-sm ${valueColor}`}>{temp != null ? `${temp}°C` : '—'}</span>
          </div>
          <div className="bg-white/60 border border-gray-100 rounded p-2">
            <span className="block text-[9px] font-bold text-[#71717A] uppercase">CO Level</span>
            <span className={`block font-extrabold text-sm ${valueColor}`}>{co != null ? `${co} ppm` : '—'}</span>
          </div>
        </div>
        <p className="text-[10px] text-[#71717A] -mt-1">
          {readingAt
            ? `${activeAlert ? 'At alert trigger' : 'Latest reading'} · ${formatAge(readingAt, now)}`
            : 'No readings received yet'}
        </p>

        <button
          onClick={onViewDetails}
          className={`w-full py-2 rounded text-[10px] font-extrabold uppercase tracking-widest text-white transition-colors ${status === 'fire' ? 'bg-[#AF101A] hover:bg-[#8F0C14]' : 'bg-[#00799C] hover:bg-[#005F7B]'}`}
        >
          {status === 'fire' ? 'Dispatch Details' : 'View Device Alerts'}
        </button>
      </div>
    </div>
  );
};

// Flies to a device selected from outside the map (e.g. the Live Alert Feed)
// and opens its popup. The caller clears selectedDeviceId in onDone so
// re-selecting the same device works.
const MapFocusController = ({
  selectedDeviceId,
  devices,
  markerRefs,
  onDone,
}: {
  selectedDeviceId: string | null;
  devices: DeviceOnMap[];
  markerRefs: React.MutableRefObject<Record<string, L.Marker | null>>;
  onDone: () => void;
}) => {
  const map = useMap();
  useEffect(() => {
    if (!selectedDeviceId) return;
    const device = devices.find(d => d.id === selectedDeviceId);
    if (device && isValidCoordinate(device.latitude, device.longitude)) {
      map.flyTo([device.latitude as number, device.longitude as number], 17, { duration: 1 });
      const timer = setTimeout(() => {
        markerRefs.current[selectedDeviceId]?.openPopup();
        onDone();
      }, 600);
      return () => clearTimeout(timer);
    }
    onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDeviceId]);
  return null;
};

const MapBoundsUpdater = ({ devices }: { devices: Device[] }) => {
  const map = useMap();
  // `devices` is a freshly filtered array on every parent render (e.g. every
  // useNowTick tick), so depending on it directly re-fits bounds constantly
  // and cancels any in-progress flyTo from MapFocusController. Depend on a
  // string of actual positions instead, which only changes when a device's
  // coordinates do.
  const positionsKey = devices
    .filter(d => d.latitude != null && d.longitude != null)
    .map(d => `${d.id}:${d.latitude},${d.longitude}`)
    .join('|');
  useEffect(() => {
    const validDevices = devices.filter(d => d.latitude != null && d.longitude != null);
    if (validDevices.length > 0) {
      const bounds = L.latLngBounds(validDevices.map(d => [d.latitude as number, d.longitude as number]));
      map.fitBounds(bounds, { maxZoom: 16, padding: [30, 30] });
    } else {
      map.flyTo(DEFAULT_CENTER, DEFAULT_ZOOM, { duration: 1.5 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionsKey, map]);
  return null;
};

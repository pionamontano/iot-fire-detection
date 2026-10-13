import React, { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, ZoomControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Activity } from 'lucide-react';
import { describeLocation, isValidCoordinate, markerOpacity, formatAge } from '../lib/location';
import { getDeviceStatus, DEVICE_STATUS, DEVICE_STATUS_ORDER } from '../lib/deviceStatus';
import type { DeviceStatus } from '../lib/deviceStatus';
import type { Device, AlertEvent } from '../lib/supabase';
import { MAP_DEFAULT_CENTER as DEFAULT_CENTER, MAP_DEFAULT_ZOOM as DEFAULT_ZOOM, MAP_POPUP_HEADER, formatTemp } from '../lib/mapDevices';
import type { DeviceOnMap } from '../lib/mapDevices';

// Shared live device map, used both as the Dashboard preview and as the
// full-screen Live Map page. This is a status map (one pin per device,
// colored by alert/connectivity state), not an interpolated heatmap: with a
// handful of point sensors an interpolated surface would invent readings
// for places nobody is measuring.

const createIcon = (status: DeviceStatus) => {
  const { color } = DEVICE_STATUS[status];
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

// Zoom used when focusing a single device (feed card click, ?device=).
const FOCUS_ZOOM = 17;

// Keep auto-panned popups clear of the floating overlays (children) the Live
// Map draws on top of the map (search/toggle bar at the top, legend at the bottom);
// otherwise the popup's header and device name end up hidden under them.
const POPUP_PAD_TOP_LEFT: L.PointExpression = [24, 96];
const POPUP_PAD_BOTTOM_RIGHT: L.PointExpression = [24, 72];

const iconCache:Record<DeviceStatus, L.DivIcon> = {
  fire: createIcon('fire'),
  warning: createIcon('warning'),
  online: createIcon('online'),
  reconnecting: createIcon('reconnecting'),
  offline: createIcon('offline'),
};

export const MapLegend = () => (
  <div className="bg-white/80 backdrop-blur-md border border-white/40 shadow-sm rounded-lg py-2 px-3 sm:px-4 flex flex-wrap items-center gap-x-4 sm:gap-x-6 gap-y-1">
    {DEVICE_STATUS_ORDER.map(s => (
      <div key={s} className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full" style={{ background: DEVICE_STATUS[s].color }}></div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-[#52525B]">{DEVICE_STATUS[s].longLabel}</span>
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
          const status = getDeviceStatus(device, activeAlerts, now);
          return (
            <Marker
              key={device.id}
              position={[device.latitude as number, device.longitude as number]}
              icon={iconCache[status]}
              opacity={markerOpacity(device.location.kind)}
              ref={(el) => { markerRefs.current[device.id] = el; }}
            >
              <Popup
                className="custom-popup"
                closeButton={false}
                minWidth={240}
                autoPanPaddingTopLeft={children ? POPUP_PAD_TOP_LEFT : undefined}
                autoPanPaddingBottomRight={children ? POPUP_PAD_BOTTOM_RIGHT : undefined}
              >
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
  status: DeviceStatus;
  activeAlert: AlertEvent | undefined;
  now: number;
  onViewDetails: () => void;
}) => {
  const header = MAP_POPUP_HEADER[status];
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
      <div className={`flex items-center justify-between px-4 py-2 text-white ${header.bg}`}>
        <span className="font-extrabold text-[10px] tracking-widest uppercase">{header.text}</span>
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
            <span className={`block font-extrabold text-sm ${valueColor}`}>{formatTemp(temp)}</span>
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
          className={`w-full py-2 rounded text-[10px] font-extrabold uppercase tracking-widest text-white transition-colors ${status === 'fire' ? 'bg-primary hover:bg-primary-dark' : 'bg-[#00799C] hover:bg-[#005F7B]'}`}
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
    if (!device || !isValidCoordinate(device.latitude, device.longitude)) {
      onDone();
      return;
    }
    const target = L.latLng(device.latitude as number, device.longitude as number);
    const zoom = Math.max(map.getZoom(), FOCUS_ZOOM);
    const open = () => {
      markerRefs.current[selectedDeviceId]?.openPopup();
      onDone();
    };

    // Open the popup only once the camera has settled. Opening it mid-flight
    // (the old fixed 600ms timer) let the popup's autoPan abort the flyTo at
    // a fractional zoom and pan from there, which made the map and popup
    // visibly jump. Already there → no animation at all.
    map.closePopup();
    if (map.getZoom() === zoom && map.getCenter().distanceTo(target) < 1) {
      open();
      return;
    }
    map.once('moveend', open);
    map.flyTo(target, zoom, { duration: 0.8 });
    return () => { map.off('moveend', open); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDeviceId]);
  return null;
};

const MapBoundsUpdater = ({ devices }: { devices: Device[] }) => {
  const map = useMap();
  // `devices` is a freshly filtered array on every parent render (e.g. every
  // useNowTick tick), so depending on it directly re-fits bounds constantly
  // and cancels any in-progress flyTo from MapFocusController. Depend on the
  // set of devices that have a position instead. Coordinates are deliberately
  // left out: GPS jitter between readings (or a realtime refetch) used to
  // re-fit the whole map, which threw away the view the user had zoomed to
  // and closed any open popup. Markers still move; only the camera stays.
  const positionsKey = devices
    .filter(d => d.latitude != null && d.longitude != null)
    .map(d => d.id)
    .join('|');
  const fit = () => {
    const validDevices = devices.filter(d => d.latitude != null && d.longitude != null);
    if (validDevices.length > 0) {
      const bounds = L.latLngBounds(validDevices.map(d => [d.latitude as number, d.longitude as number]));
      map.fitBounds(bounds, { maxZoom: 16, padding: [30, 30] });
    } else {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    }
  };
  const fitRef = useRef(fit);
  fitRef.current = fit;

  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionsKey, map]);

  // Leaflet only measures its container on window resize. When the container
  // changes size for other reasons (grid reflow after data loads, sidebar
  // toggle, breakpoint change) the fitted view ends up off-centre and pins
  // get clipped at the edges. Re-measure and re-fit whenever it resizes.
  useEffect(() => {
    const container = map.getContainer();
    let last = `${container.clientWidth}x${container.clientHeight}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      const size = `${container.clientWidth}x${container.clientHeight}`;
      if (size === last) return;
      last = size;
      clearTimeout(timer);
      timer = setTimeout(() => {
        map.invalidateSize();
        fitRef.current();
      }, 150);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [map]);
  return null;
};

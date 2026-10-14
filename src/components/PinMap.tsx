import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { isValidCoordinate, roundCoord } from '../lib/location';
import { MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM } from '../lib/mapDevices';

const markerIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

const PIN_ZOOM = 17;

const ClickToPlace = ({ onPick }: { onPick: (lat: number, lng: number) => void }) => {
  useMapEvents({ click: e => onPick(roundCoord(e.latlng.lat), roundCoord(e.latlng.lng)) });
  return null;
};

// Brings a pin that was set from outside the map (GPS button, typed coordinates) into view,
// without jumping around while the user is clicking or dragging inside the visible area.
const KeepPinInView = ({ pos }: { pos: [number, number] | null }) => {
  const map = useMap();
  const hadPin = useRef(pos !== null);
  useEffect(() => {
    if (!pos) return;
    if (!hadPin.current) map.setView(pos, PIN_ZOOM);
    else if (!map.getBounds().contains(pos)) map.setView(pos, Math.max(map.getZoom(), 15));
    hadPin.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pos?.[0], pos?.[1]]);
  return null;
};

/**
 * A single install pin on an OpenStreetMap base layer. With `onChange` the pin can be placed by
 * clicking the map and moved by dragging it; without, it is read-only.
 */
export const PinMap = ({
  lat,
  lng,
  onChange,
  heightClass = 'h-56',
}: {
  lat: number | null;
  lng: number | null;
  onChange?: (lat: number, lng: number) => void;
  heightClass?: string;
}) => {
  const pos: [number, number] | null = isValidCoordinate(lat, lng) ? [lat, lng as number] : null;

  return (
    <div className={`${heightClass} relative z-0 overflow-hidden rounded border border-[#E5E2E1]`}>
      <MapContainer
        center={pos ?? MAP_DEFAULT_CENTER}
        zoom={pos ? PIN_ZOOM : MAP_DEFAULT_ZOOM}
        style={{ height: '100%', width: '100%' }}
        className={onChange ? 'cursor-crosshair' : undefined}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {onChange && <ClickToPlace onPick={onChange} />}
        <KeepPinInView pos={pos} />
        {pos && (
          <Marker
            position={pos}
            icon={markerIcon}
            draggable={!!onChange}
            eventHandlers={onChange ? {
              dragend: e => {
                const p = (e.target as L.Marker).getLatLng();
                onChange(roundCoord(p.lat), roundCoord(p.lng));
              },
            } : undefined}
          />
        )}
      </MapContainer>
    </div>
  );
};

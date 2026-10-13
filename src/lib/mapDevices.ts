// Data helpers for the shared live device map (src/components/DeviceMap.tsx).
import { resolveDeviceLocation } from './location';
import type { ReadingLocationInput, ResolvedLocation } from './location';
import type { MapStatus } from './deviceStatus';
import type { Device } from './supabase';

// Malolos City, Bulacan — where the deployed units are.
export const MAP_DEFAULT_CENTER: [number, number] = [14.8527, 120.8160];
export const MAP_DEFAULT_ZOOM = 13;

// Columns of each device's latest sensor reading the map needs: position for
// the pin, plus the values shown in its popup.
export const MAP_READING_COLUMNS = 'latitude, longitude, gps_valid, recorded_at, temp_celsius, co_ppm, on_battery';

export type MapReading = ReadingLocationInput & {
  temp_celsius?: number | null;
  co_ppm?: number | null;
  on_battery?: boolean | null;
};
export type DeviceWithReadings = Device & { sensor_readings?: MapReading[] };
export type DeviceOnMap = DeviceWithReadings & { location: ResolvedLocation };

// Resolve each device's location (live / last-known / registered / unavailable).
// Call on every render so the 15-minute live-fix window is re-evaluated with
// the clock tick. Nothing is invented: no usable position → null coordinates.
export const toMapDevices = (devices: DeviceWithReadings[], now: number): DeviceOnMap[] =>
  devices.map(d => {
    const location = resolveDeviceLocation({ readings: d.sensor_readings, device: d, now });
    return { ...d, latitude: location.lat, longitude: location.lng, location };
  });

export const MAP_STATUS_STYLE: Record<MapStatus, { color: string; label: string; header: string; headerBg: string }> = {
  fire: { color: '#DC2626', label: 'Fire (Tier 2)', header: 'Fire detected', headerBg: 'bg-[#DC2626]' },
  warning: { color: '#F59E0B', label: 'Warning (Tier 1)', header: 'Warning — threshold breached', headerBg: 'bg-[#D97706]' },
  normal: { color: '#10B981', label: 'Normal', header: 'System normal', headerBg: 'bg-[#005F7B]' },
  offline: { color: '#71717A', label: 'Offline', header: 'Offline', headerBg: 'bg-[#52525B]' },
};

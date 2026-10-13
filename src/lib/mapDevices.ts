// Data helpers for the shared live device map (src/components/DeviceMap.tsx).
import { resolveDeviceLocation } from './location';
import type { ReadingLocationInput, ResolvedLocation } from './location';
import type { DeviceStatus } from './deviceStatus';
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

// One temperature format for the map popup and the alert feed: at most one
// decimal (28.38 → "28.4°C", 30 → "30°C").
export const formatTemp = (celsius: number | null | undefined): string =>
  celsius == null ? '—' : `${Number(celsius.toFixed(1))}°C`;

// Popup header text and color per status; colors and labels come from the
// shared DEVICE_STATUS so the map matches every other status display.
export const MAP_POPUP_HEADER: Record<DeviceStatus, { text: string; bg: string }> = {
  fire: { text: 'Fire detected', bg: 'bg-[#DC2626]' },
  warning: { text: 'Warning — threshold breached', bg: 'bg-[#D97706]' },
  online: { text: 'Online — system normal', bg: 'bg-[#047857]' },
  reconnecting: { text: 'Reconnecting', bg: 'bg-[#1D4ED8]' },
  offline: { text: 'Offline', bg: 'bg-[#52525B]' },
};

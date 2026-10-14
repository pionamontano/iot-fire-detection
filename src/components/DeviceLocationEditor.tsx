import { useState } from 'react';
import { AlertTriangle, Crosshair, Loader2, Save } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { isValidCoordinate, roundCoord } from '../lib/location';
import { PinMap } from './PinMap';

export interface SavedDeviceLocation {
  location_desc: string;
  latitude: number;
  longitude: number;
  location_verified: boolean;
}

/**
 * Lets a resident set their device's install address and map pin. Saves through
 * update_own_device_location (20261102000000), which only ever touches the caller's own device
 * and leaves the result unverified until an admin confirms it.
 */
export const DeviceLocationEditor = ({
  initialAddress,
  initialLat,
  initialLng,
  onSaved,
  onCancel,
  saveLabel = 'Save location',
}: {
  initialAddress: string | null;
  initialLat: number | null;
  initialLng: number | null;
  onSaved: (saved: SavedDeviceLocation) => void;
  onCancel?: () => void;
  saveLabel?: string;
}) => {
  const [address, setAddress] = useState(initialAddress ?? '');
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(
    isValidCoordinate(initialLat, initialLng) ? { lat: initialLat, lng: initialLng as number } : null,
  );
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      setError('This browser cannot share its location. Tap the map to place the pin instead.');
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setPin({ lat: roundCoord(pos.coords.latitude), lng: roundCoord(pos.coords.longitude) });
        setAccuracy(Math.round(pos.coords.accuracy));
        setLocating(false);
      },
      err => {
        setError(err.code === err.PERMISSION_DENIED
          ? 'Location permission was denied. Tap the map to place the pin instead.'
          : 'Could not get your location. Tap the map to place the pin instead.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const save = async () => {
    const trimmed = address.trim();
    if (!trimmed) {
      setError('Enter the address where the device is installed.');
      return;
    }
    if (!pin) {
      setError('Place the pin on the map where the device is installed.');
      return;
    }
    setSaving(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('update_own_device_location', {
      p_location_desc: trimmed,
      p_latitude: pin.lat,
      p_longitude: pin.lng,
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message || 'Failed to save the location.');
      return;
    }
    onSaved(data as SavedDeviceLocation);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="device-location-address" className="text-[#857371] text-xs font-bold tracking-[0.1em] uppercase">
          Install address
        </label>
        <input
          id="device-location-address"
          type="text"
          maxLength={200}
          value={address}
          onChange={e => setAddress(e.target.value)}
          placeholder="House/Unit No., Street, Barangay, City"
          className="w-full bg-[#FCF9F8] border border-[#E5E2E1] rounded-md px-4 py-3 text-sm text-[#231918] placeholder-[rgba(83,67,65,0.5)] focus:outline-none focus:ring-2 focus:ring-[#D32F2F]/30 focus:border-[#D32F2F]"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[#857371] text-xs font-bold tracking-[0.1em] uppercase">Map pin</span>
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#E5E2E1] text-[#534341] text-[11px] font-bold uppercase tracking-wide hover:bg-[#FCF9F8] disabled:opacity-60"
          >
            {locating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Crosshair className="w-3.5 h-3.5" />}
            Use my location
          </button>
        </div>
        <PinMap
          lat={pin?.lat ?? null}
          lng={pin?.lng ?? null}
          onChange={(lat, lng) => { setPin({ lat, lng }); setAccuracy(null); }}
          heightClass="h-64"
        />
        <p className="text-[11px] text-[#534341]">
          {pin
            ? <>Pin at <span className="font-mono">{pin.lat}, {pin.lng}</span>{accuracy !== null && <> (phone accuracy about {accuracy} m)</>}. Drag it or tap the map to adjust.</>
            : 'Tap the map where the device is installed, or use your phone\'s location while you are next to it.'}
        </p>
        {accuracy !== null && accuracy > 30 && (
          <p className="text-[11px] font-bold text-[#B45309]">
            Your phone's location is only accurate to about {accuracy} m. Check the pin is on the right building.
          </p>
        )}
      </div>

      <p className="text-[11px] text-[#534341] bg-[#FCF9F8] border border-[#E5E2E1] rounded px-3 py-2">
        Responders are sent to this pin when your device has no GPS signal. An administrator checks it after you
        save; until then it is marked as unverified.
      </p>

      {error && (
        <p className="text-[#D32F2F] text-[11px] font-bold flex items-start gap-1">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-primary text-white font-bold text-xs tracking-[0.1em] uppercase rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving...' : saveLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-3 border border-[#E5E2E1] text-[#534341] font-bold text-xs tracking-[0.1em] uppercase rounded-lg hover:bg-[#FCF9F8] disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};

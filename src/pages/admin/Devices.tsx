import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { PageHeader } from '../../components/PageHeader';
import { supabase } from '../../lib/supabase';
import { DEVICE_COLUMNS } from '../../lib/deviceColumns';
import { LoadErrorBanner } from '../../components/LoadErrorBanner';
import type { LoadErrorInfo } from '../../components/LoadErrorBanner';
import type { Device, FirmwareRelease } from '../../lib/supabase';
import { isValidCoordinate, displayAddress } from '../../lib/location';
import { Cpu, ChevronRight, Info, Loader2, AlertTriangle, Pencil, BatteryWarning, X, KeyRound, Copy, Check, Rocket, MapPin, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { CardListSkeleton } from '../../components/SkeletonLoaders';
import { PinMap } from '../../components/PinMap';

// Fleet-wide firmware push. Safe because device ID / API key are stored per node (NVS) rather than compiled
// into the image (docs/FIRMWARE_GUIDE.md, 5.1 and 8.6). Set to false to disable it again (e.g. while nodes still
// run firmware with a compiled-in identity).
const FLEET_PUSH_ENABLED = true;
const FLEET_PUSH_DISABLED_REASON =
  'Fleet push is disabled. See docs/FIRMWARE_GUIDE.md, section 8.6.';


// Where a device's install location stands (20261102000000): the resident sets the address and
// pin, an admin confirms them. Only a pin with both coordinates counts as set.
type LocationState = 'not_set' | 'unverified' | 'verified';
const locationState = (d: Pick<Device, 'latitude' | 'longitude' | 'location_verified'>): LocationState =>
  !isValidCoordinate(d.latitude, d.longitude) ? 'not_set' : d.location_verified ? 'verified' : 'unverified';

const LocationStateBadge = ({ state }: { state: LocationState }) => {
  if (state === 'verified') return null;
  return state === 'unverified' ? (
    <span title="The resident set this pin; confirm it in Edit device" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#B45309] text-[9px] font-bold uppercase tracking-wide shrink-0">
      <MapPin className="w-3 h-3" /> Unverified pin
    </span>
  ) : (
    <span title="Waiting for the resident to set the address and pin" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#F4F4F5] text-[#52525B] text-[9px] font-bold uppercase tracking-wide shrink-0">
      <MapPin className="w-3 h-3" /> No pin
    </span>
  );
};

const timeAgo = (dateStr: string) => {
  const seconds = Math.floor((new Date().getTime() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export const Devices = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<LoadErrorInfo | null>(null);
  // device_id -> latest on_battery (spec HW-1.5.2/SW-2.4.4)
  const [batteryByDevice, setBatteryByDevice] = useState<Record<string, boolean>>({});

  // Editing an already-registered device's thresholds + BFP contact
  // (spec HW-1.1.5 / SW-2.5.5) — previously only settable at creation.
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [editForm, setEditForm] = useState({
    label: '',
    location_desc: '',
    location_verified: false,
    latitude: '',
    longitude: '',
    temp_threshold: 65,
    co_threshold: 200,
    bfp_contact: '',
    firmware_version: '',
    firmware_url: '',
    firmware_md5: '',
  });
  const [savingEdit, setSavingEdit] = useState(false);

  // API key regeneration (spec SW-2.6.3) — shown once, right after
  // regenerating, since the raw key otherwise only appears in `devices`
  // rows the admin already has (devices_safe masks it for other roles).
  const [regeneratingKey, setRegeneratingKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);

  // Fleet-wide firmware release log — independent of any one device's
  // firmware_version target, this is what "latest" means for the whole
  // fleet (see 20261025000000_firmware_releases.sql).
  const [latestRelease, setLatestRelease] = useState<FirmwareRelease | null>(null);
  const [releaseForm, setReleaseForm] = useState({ version: '', url: '', md5: '', notes: '' });
  const [publishingRelease, setPublishingRelease] = useState(false);
  const [pushingFleet, setPushingFleet] = useState(false);

  // Registration only asks for an optional name. The code, API key and thresholds come from
  // register_device() / column defaults; the resident sets the address and pin later.
  const [newLabel, setNewLabel] = useState('');
  const [registerError, setRegisterError] = useState<string | null>(null);
  // Shown once after registering: the API key cannot be read back afterwards (devices.api_key has
  // no SELECT grant), only regenerated.
  const [registered, setRegistered] = useState<{ device_code: string; api_key: string } | null>(null);
  const [copiedField, setCopiedField] = useState<'code' | 'key' | null>(null);

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    const [devicesRes, batteryRes] = await Promise.all([
      supabase.from('devices').select<string, Device>(DEVICE_COLUMNS).order('created_at', { ascending: false }),
      // Latest readings across devices, to derive each device's current
      // on_battery state (no per-device "latest reading" view exists, so
      // the most recent batch is reduced client-side below).
      supabase.from('sensor_readings')
        .select('device_id, on_battery, recorded_at')
        .order('recorded_at', { ascending: false })
        .limit(300),
    ]);

    // A failed read must be visible, not look like an empty fleet.
    setLoadError(devicesRes.error ? { message: devicesRes.error.message, code: devicesRes.error.code } : null);
    if (!devicesRes.error && devicesRes.data) {
      setDevices(devicesRes.data);
    }
    if (batteryRes.data) {
      const latestByDevice: Record<string, boolean> = {};
      for (const r of batteryRes.data) {
        if (!(r.device_id in latestByDevice)) latestByDevice[r.device_id] = r.on_battery;
      }
      setBatteryByDevice(latestByDevice);
    }
    setLoading(false);
  }, []);

  const fetchLatestRelease = useCallback(async () => {
    const { data } = await supabase
      .from('firmware_releases')
      .select('id, version, url, md5, notes, created_by, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setLatestRelease(data ?? null);
  }, []);

  useEffect(() => {
    fetchDevices();
    fetchLatestRelease();
  }, [fetchDevices, fetchLatestRelease]);

  const publishRelease = async (e: React.FormEvent) => {
    e.preventDefault();
    const md5 = releaseForm.md5.trim();
    if (md5 && !/^[0-9a-fA-F]{32}$/.test(md5)) {
      alert('Firmware MD5 must be exactly 32 hex characters, or left blank.');
      return;
    }

    setPublishingRelease(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('firmware_releases').insert({
      version: releaseForm.version.trim(),
      url: releaseForm.url.trim(),
      md5: md5 || null,
      notes: releaseForm.notes.trim() || null,
      created_by: user?.id,
    });

    if (error) {
      alert('Failed to publish release: ' + error.message);
    } else {
      setReleaseForm({ version: '', url: '', md5: '', notes: '' });
      fetchLatestRelease();
    }
    setPublishingRelease(false);
  };

  const pushReleaseToFleet = async () => {
    if (!FLEET_PUSH_ENABLED || !latestRelease) return;
    const activeCount = devices.filter(d => d.is_active).length;
    if (!window.confirm(
      `Push firmware ${latestRelease.version} to all ${activeCount} active device(s)? Each device picks it up on its next config sync (within 10 minutes).`
    )) return;

    setPushingFleet(true);
    const { error } = await supabase
      .from('devices')
      .update({
        firmware_version: latestRelease.version,
        firmware_url: latestRelease.url,
        firmware_md5: latestRelease.md5,
      })
      .eq('is_active', true);

    if (error) {
      alert('Failed to push to fleet: ' + error.message);
    } else {
      fetchDevices();
    }
    setPushingFleet(false);
  };

  const openEditDevice = (device: Device) => {
    setEditingDevice(device);
    setEditForm({
      label: device.label || '',
      location_desc: device.location_desc || '',
      location_verified: device.location_verified,
      latitude: device.latitude != null ? String(device.latitude) : '',
      longitude: device.longitude != null ? String(device.longitude) : '',
      temp_threshold: device.temp_threshold,
      co_threshold: device.co_threshold,
      bfp_contact: device.bfp_contact || '',
      firmware_version: device.firmware_version || '',
      firmware_url: device.firmware_url || '',
      firmware_md5: device.firmware_md5 || '',
    });
    setNewApiKey(null);
    setKeyCopied(false);
  };

  const handleRegenerateKey = async () => {
    if (!editingDevice) return;
    if (!window.confirm(
      `Regenerate the API key for ${editingDevice.device_code}? The device will be unable to authenticate with the old key immediately — it must be reflashed or reconfigured with the new key.`
    )) return;

    setRegeneratingKey(true);
    const { data, error } = await supabase.rpc('regenerate_device_api_key', { p_device_id: editingDevice.id });
    if (error) {
      alert('Failed to regenerate API key: ' + error.message);
    } else {
      setNewApiKey(data as string);
      setKeyCopied(false);
    }
    setRegeneratingKey(false);
  };

  const copyNewApiKey = async () => {
    if (!newApiKey) return;
    try {
      await navigator.clipboard.writeText(newApiKey);
      setKeyCopied(true);
    } catch {
      // Clipboard API can be unavailable (e.g. insecure context) — the
      // key is still selectable/copyable by hand from the input below.
    }
  };

  const saveEditDevice = async () => {
    if (!editingDevice) return;

    const md5 = editForm.firmware_md5.trim();
    if (md5 && !/^[0-9a-fA-F]{32}$/.test(md5)) {
      alert('Firmware MD5 must be exactly 32 hex characters, or left blank.');
      return;
    }

    const label = editForm.label.trim();
    if (!label) {
      alert('Device name cannot be empty.');
      return;
    }

    const locationDesc = editForm.location_desc.trim();

    // Registered coordinates are the install position (not a GPS fix — see
    // lib/location.ts), so they must either both be present and valid, or
    // both be blank. A one-sided edit here would silently desync lat/lng.
    const latRaw = editForm.latitude.trim();
    const lngRaw = editForm.longitude.trim();
    if (!!latRaw !== !!lngRaw) {
      alert('Enter both GPS latitude and longitude, or leave both blank.');
      return;
    }
    let latitude: number | null = null;
    let longitude: number | null = null;
    if (latRaw && lngRaw) {
      latitude = parseFloat(latRaw);
      longitude = parseFloat(lngRaw);
      if (!isValidCoordinate(latitude, longitude)) {
        alert('GPS coordinates must be valid latitude (-90 to 90) and longitude (-180 to 180) values.');
        return;
      }
    }

    if (editForm.location_verified && (!locationDesc || latitude === null)) {
      alert('A location can only be confirmed once it has both an address and a map pin.');
      return;
    }

    setSavingEdit(true);
    const { error } = await supabase
      .from('devices')
      .update({
        label,
        location_desc: locationDesc || null,
        latitude,
        longitude,
        // Stamped with who/when by the devices_location_verification trigger.
        location_verified: editForm.location_verified,
        temp_threshold: editForm.temp_threshold,
        co_threshold: editForm.co_threshold,
        bfp_contact: editForm.bfp_contact || null,
        firmware_version: editForm.firmware_version.trim() || null,
        firmware_url: editForm.firmware_url.trim() || null,
        firmware_md5: md5 || null,
      })
      .eq('id', editingDevice.id);

    if (error) {
      alert('Failed to update device: ' + error.message);
    } else {
      setEditingDevice(null);
      fetchDevices();
    }
    setSavingEdit(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setRegisterError(null);

    // The next AGS-NNN code and the API key (CSPRNG via pgcrypto) are generated server-side.
    const { data, error } = await supabase.rpc('register_device', { p_label: newLabel.trim() || null });

    if (error) {
      setRegisterError(error.message);
    } else {
      const r = data as { device_code: string; api_key: string };
      setRegistered({ device_code: r.device_code, api_key: r.api_key });
      setCopiedField(null);
      setNewLabel('');
      fetchDevices();
    }
    setSubmitting(false);
  };

  const copyRegistered = async (which: 'code' | 'key') => {
    if (!registered) return;
    try {
      await navigator.clipboard.writeText(which === 'code' ? registered.device_code : registered.api_key);
      setCopiedField(which);
    } catch {
      // Clipboard API unavailable (e.g. insecure context): the fields stay selectable by hand.
    }
  };

  // A device counts as outdated only once it's told us what it's running —
  // one that has never reported (firmware_version_reported === null, e.g.
  // older firmware predating this field, or never seen online) is unknown,
  // not assumed current.
  const activeDevices = devices.filter(d => d.is_active);
  // All of them, not just the five most recent: a resident can move an old device's pin at any time.
  const awaitingConfirmation = devices.filter(d => locationState(d) === 'unverified');
  const outdatedDevices = latestRelease
    ? activeDevices.filter(d => d.firmware_version_reported && d.firmware_version_reported !== latestRelease.version)
    : [];

  return (
    <div className="space-y-10">
      {loadError && (
        <LoadErrorBanner what="devices" error={loadError} onRetry={fetchDevices} />
      )}
      {/* Page Header */}
      <PageHeader
        title="Device Registration"
        description="Register AgapSense units and confirm the install locations residents set. Confirmed pins matter: they are where responders are sent when a device has no GPS fix."
      />

      {/* Main Grid: 12-col → 7-col Left + 5-col Right */}
      <div className="grid grid-cols-12 gap-8">
        {/* ─── LEFT PANEL: Registration Form ─── */}
        <div className="col-span-12 lg:col-span-7 flex flex-col gap-6">
          {registered ? (
            <div className="bg-[#F6F3F2] rounded-lg p-8 flex flex-col gap-6">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-[#047857] shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-[#1C1B1B] font-bold text-lg">{registered.device_code} registered</h3>
                  <p className="text-[#5B403D] text-sm mt-1">
                    Enter the device code and API key in the device's Wi-Fi setup portal. Give the device code to the
                    resident: they enter it when they create their account.
                  </p>
                </div>
              </div>

              <CopyField label="Device Code" value={registered.device_code} copied={copiedField === 'code'} onCopy={() => copyRegistered('code')} />
              <CopyField label="API Key" value={registered.api_key} copied={copiedField === 'key'} onCopy={() => copyRegistered('key')} />

              <div className="flex items-start gap-1.5 text-[#B45309]">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span className="text-xs font-bold">
                  Copy the API key now. It won't be shown again; if it's lost, regenerate it from Edit device.
                </span>
              </div>

              <button
                type="button"
                onClick={() => setRegistered(null)}
                className="w-full py-3 rounded border border-[#D6D1D0] text-[#5B403D] font-bold text-sm tracking-[0.025em] uppercase hover:bg-white transition-colors"
              >
                Register another device
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="bg-[#F6F3F2] rounded-lg p-8 flex flex-col gap-6">
              <FormField label="Device Name (optional)" htmlFor="new-device-label">
                <input
                  id="new-device-label"
                  type="text"
                  maxLength={100}
                  placeholder="e.g. Unit 6 — Barangay Hall"
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  className="form-input-field"
                />
                <span className="text-[11px] text-[#5B403D]">
                  Shown on the dashboard and map. Leave blank to use the device code.
                </span>
              </FormField>

              <ul className="text-xs text-[#5B403D] leading-5 flex flex-col gap-1.5 border-t border-[#E5E2E1] pt-5">
                <li><span className="font-bold text-[#1C1B1B]">Device code and API key</span> are generated for you and shown once after registering.</li>
                <li><span className="font-bold text-[#1C1B1B]">Alert thresholds</span> start at 60 °C and 200 ppm CO. Change them later in Edit device.</li>
                <li><span className="font-bold text-[#1C1B1B]">Address and map pin</span> are set by the resident once their account is linked. You confirm them before they count as verified.</li>
              </ul>

              {registerError && (
                <div className="flex items-start gap-1.5 text-[#B91C1C]">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span className="text-xs font-bold">Failed to register device: {registerError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-4 rounded text-white font-bold text-base tracking-[0.025em] uppercase flex items-center justify-center gap-2 transition-all disabled:opacity-60"
                style={{ background: 'linear-gradient(90deg, #AF101A 0%, #D32F2F 100%)' }}
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cpu className="w-4 h-4" />}
                {submitting ? 'Registering...' : 'Register Device'}
              </button>
            </form>
          )}

          {/* Sensor warm-up (firmware sensors.cpp: alerts held until the MQ-7's first heat + measure cycle). */}
          <div
            className="rounded-lg p-6 flex gap-4"
            style={{
              background: 'rgba(0, 121, 156, 0.1)',
              borderLeft: '4px solid #00799C',
            }}
          >
            <div className="shrink-0 mt-0.5">
              <Info className="w-5 h-5 text-[#005F7B]" />
            </div>
            <div>
              <h4 className="text-[#005F7B] font-bold text-sm tracking-[0.05em] uppercase">
                Sensor Warm-up
              </h4>
              <p className="text-[#5B403D] text-xs leading-[19.5px] mt-1">
                Each time the device powers on, its CO sensor needs one heat-and-measure cycle (about 2.5 minutes)
                before its readings count. Alerts are held until then.
              </p>
            </div>
          </div>
        </div>

        {/* ─── RIGHT PANEL: Recently Registered ─── */}
        <div className="col-span-12 lg:col-span-5 flex flex-col gap-6">
          {/* Pins residents have set or moved that no admin has checked yet. */}
          {awaitingConfirmation.length > 0 && (
            <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-lg p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[#1C1B1B] font-bold text-sm tracking-[0.1em] uppercase">
                  Locations to Confirm
                </h3>
                <span className="bg-[rgba(245,158,11,0.15)] text-[#B45309] font-bold text-[9.6px] uppercase px-2 py-1 rounded-sm">
                  {awaitingConfirmation.length} Waiting
                </span>
              </div>
              <p className="text-[#5B403D] text-xs -mt-2">
                Residents set these pins. Until you confirm them, alerts label them as unverified.
              </p>
              <div className="flex flex-col gap-2">
                {awaitingConfirmation.map(device => (
                  <button
                    key={device.id}
                    type="button"
                    onClick={() => openEditDevice(device)}
                    className="bg-white rounded flex items-center gap-3 p-3 text-left hover:shadow-sm transition-shadow group"
                  >
                    <MapPin className="w-4 h-4 text-[#B45309] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="block font-bold text-xs text-[#1C1B1B]">{device.device_code}</span>
                      <span className="block text-[#5B403D] text-[11px] truncate">{displayAddress(device.location_desc)}</span>
                    </div>
                    <span className="text-[#AF101A] font-bold text-[10px] uppercase tracking-wide shrink-0 group-hover:underline">Review</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Recently Registered Card */}
          <div className="bg-[#EBE7E7] rounded-lg p-6 flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <h3 className="text-[#1C1B1B] font-bold text-sm tracking-[0.1em] uppercase">
                Recently Registered
              </h3>
              {devices.length > 5 && (
                <span className="text-[#5B403D] font-bold text-[9.6px] uppercase">
                  Latest 5 of {devices.length}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-4">
              {loading ? (
                <div className="py-8">
                  <CardListSkeleton count={4} />
                </div>
              ) : devices.length === 0 ? (
                <div className="bg-white rounded py-8 px-4 text-center">
                  <Cpu className="w-10 h-10 mx-auto mb-3 text-[#E5E2E1]" />
                  <p className="text-[#5B403D] font-medium text-sm">No devices registered yet.</p>
                  <p className="text-[#5B403D] text-xs mt-1">Use the form to register your first device.</p>
                </div>
              ) : (
                devices.slice(0, 5).map(device => (
                  <div
                    key={device.id}
                    onClick={() => openEditDevice(device)}
                    className="bg-white rounded flex items-center gap-4 p-4 group hover:shadow-sm transition-shadow cursor-pointer"
                  >
                    {/* Icon */}
                    <div className="w-12 h-12 bg-[#EBE7E7] rounded-sm flex items-center justify-center shrink-0">
                      <Cpu className="w-5 h-5 text-[#AF101A]" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-end justify-between gap-2">
                        <span className="font-bold text-xs text-[#1C1B1B] truncate">
                          {device.device_code}
                          {device.label && device.label !== device.device_code && (
                            <span className="font-medium text-[#5B403D]"> · {device.label}</span>
                          )}
                        </span>
                        <span className="text-[#5B403D] font-medium text-[9.6px] whitespace-nowrap shrink-0">
                          {timeAgo(device.created_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-[#5B403D] text-[11px] leading-[16.5px] truncate">
                          {displayAddress(device.location_desc)}
                        </p>
                        <LocationStateBadge state={locationState(device)} />
                        {batteryByDevice[device.id] && (
                          <span title="Running on backup battery" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#B45309] text-[9px] font-bold uppercase tracking-wide shrink-0">
                            <BatteryWarning className="w-3 h-3" /> Battery
                          </span>
                        )}
                        {device.local_ip && (
                          <span title="Device local IP" className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#E0F2FE] text-[#0369A1] text-[9px] font-mono tracking-wide shrink-0 ml-auto">
                            {device.local_ip}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Edit (the whole row opens it too) */}
                    <button
                      onClick={e => { e.stopPropagation(); openEditDevice(device); }}
                      title="Edit device"
                      className="text-[#A1A1AA] hover:text-[#AF101A] transition-colors shrink-0"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>

                    {/* Chevron */}
                    <ChevronRight className="w-3 h-3 text-[#E5E2E1] shrink-0 group-hover:text-[#AF101A] transition-colors" />
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Firmware Releases Card — fleet-wide "latest" independent of any
              one device's target (see firmware_releases migration). */}
          <div className="bg-[#EBE7E7] rounded-lg p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <h3 className="text-[#1C1B1B] font-bold text-sm tracking-[0.1em] uppercase">
                Firmware Releases
              </h3>
              {latestRelease && (
                outdatedDevices.length > 0 ? (
                  <span className="bg-[rgba(245,158,11,0.15)] text-[#B45309] font-bold text-[9.6px] uppercase px-2 py-1 rounded-sm">
                    {outdatedDevices.length} Outdated
                  </span>
                ) : (
                  <span className="bg-[rgba(16,185,129,0.15)] text-[#047857] font-bold text-[9.6px] uppercase px-2 py-1 rounded-sm">
                    Fleet Up To Date
                  </span>
                )
              )}
            </div>

            {latestRelease ? (
              <div className="bg-white rounded p-4">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-[#1C1B1B] font-mono">v{latestRelease.version}</span>
                  <span className="text-[#5B403D] font-medium text-[9.6px]">{timeAgo(latestRelease.created_at)}</span>
                </div>
                {latestRelease.notes && (
                  <p className="text-[#5B403D] text-[11px] leading-[16.5px] mt-1">{latestRelease.notes}</p>
                )}
                <p className="text-[#5B403D] text-[11px] mt-2">
                  {activeDevices.length - outdatedDevices.length} of {activeDevices.length} active device(s) on this version
                </p>
                {activeDevices.some(d => !d.firmware_version_reported) && (
                  <p className="text-[#5B403D] text-[10px] italic mt-0.5">
                    Some devices have never reported a running version.
                  </p>
                )}
                <button
                  type="button"
                  onClick={pushReleaseToFleet}
                  disabled={!FLEET_PUSH_ENABLED || pushingFleet || activeDevices.length === 0}
                  title={FLEET_PUSH_ENABLED ? undefined : FLEET_PUSH_DISABLED_REASON}
                  className="w-full mt-3 py-2.5 rounded text-white font-bold text-xs tracking-[0.025em] uppercase flex items-center justify-center gap-2 transition-all disabled:opacity-60 bg-[#00799C] hover:bg-[#005F7B]"
                >
                  {pushingFleet ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
                  {pushingFleet ? 'Pushing...' : `Push to ${activeDevices.length} Active Device(s)`}
                </button>
                {!FLEET_PUSH_ENABLED && (
                  <p className="text-[#5B403D] text-[10px] italic mt-1.5">{FLEET_PUSH_DISABLED_REASON}</p>
                )}
              </div>
            ) : (
              <div className="bg-white rounded py-6 px-4 text-center">
                <p className="text-[#5B403D] text-xs">No firmware release published yet.</p>
              </div>
            )}

            <form onSubmit={publishRelease} className="border-t border-[#D6D1D0] pt-5 flex flex-col gap-3">
              <span className="text-[#5B403D] font-semibold text-[11px] tracking-[0.05em] uppercase">
                Publish New Release
              </span>
              <input
                type="text"
                required
                placeholder="Version (e.g. 2.2.0)"
                value={releaseForm.version}
                onChange={e => setReleaseForm({ ...releaseForm, version: e.target.value })}
                className="w-full border border-[#E5E2E1] rounded px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#AF101A]/30 focus:border-[#AF101A]"
              />
              <input
                type="text"
                required
                placeholder="Binary URL (Supabase Storage)"
                value={releaseForm.url}
                onChange={e => setReleaseForm({ ...releaseForm, url: e.target.value })}
                className="w-full border border-[#E5E2E1] rounded px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#AF101A]/30 focus:border-[#AF101A]"
              />
              <input
                type="text"
                placeholder="MD5 (optional, 32 hex chars)"
                value={releaseForm.md5}
                onChange={e => setReleaseForm({ ...releaseForm, md5: e.target.value })}
                className="w-full border border-[#E5E2E1] rounded px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#AF101A]/30 focus:border-[#AF101A]"
              />
              <input
                type="text"
                placeholder="Notes (optional)"
                value={releaseForm.notes}
                onChange={e => setReleaseForm({ ...releaseForm, notes: e.target.value })}
                className="w-full border border-[#E5E2E1] rounded px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#AF101A]/30 focus:border-[#AF101A]"
              />
              <button
                type="submit"
                disabled={publishingRelease}
                className="w-full py-2.5 rounded text-[#5B403D] font-bold text-xs tracking-[0.025em] uppercase flex items-center justify-center gap-2 transition-all disabled:opacity-60 border border-[#D6D1D0] hover:bg-white"
              >
                {publishingRelease ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                {publishingRelease ? 'Publishing...' : 'Publish Release'}
              </button>
            </form>
          </div>

        </div>
      </div>

      {/* Edit Device Modal — name, thresholds, BFP contact, location, firmware, API key */}
      {/* Portalled to <body>: inside the page's scroll container it would sit under the app header. */}
      {editingDevice && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={() => setEditingDevice(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[#1C1B1B] font-extrabold text-xl">Edit Device Settings</h3>
              <button onClick={() => setEditingDevice(null)} className="text-[#A1A1AA] hover:text-[#1C1B1B] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-[#5B403D] text-sm mb-6">
              Update the name, alert thresholds, BFP contact, install location and firmware target for <span className="font-bold">{editingDevice.device_code}</span>. Threshold and firmware changes take effect on the device's next config sync (within 10 minutes).
            </p>

            <div className="flex flex-col gap-6">
              <FormField label="Device Name" htmlFor="edit-device-label">
                <input
                  id="edit-device-label"
                  type="text"
                  maxLength={100}
                  value={editForm.label}
                  onChange={e => setEditForm({ ...editForm, label: e.target.value })}
                  className="w-full border border-[#E5E2E1] rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#AF101A]/30 focus:border-[#AF101A]"
                />
              </FormField>

              <ThresholdSlider
                label="Temperature Alert Threshold"
                value={editForm.temp_threshold}
                onChange={val => setEditForm({ ...editForm, temp_threshold: val })}
                min={20}
                max={120}
                unit="°C"
                minLabel="20 °C"
                maxLabel="120 °C"
                warning={editForm.temp_threshold < 40 ? 'Very low — may cause frequent false alarms' : editForm.temp_threshold > 80 ? 'Dangerously high — fire may go undetected' : undefined}
              />
              <ThresholdSlider
                label="CO Alert Threshold"
                value={editForm.co_threshold}
                onChange={val => setEditForm({ ...editForm, co_threshold: val })}
                min={0}
                max={1000}
                unit="ppm"
                minLabel="0 ppm"
                maxLabel="1000 ppm"
                warning={editForm.co_threshold < 100 ? 'Very sensitive — expect frequent alerts' : editForm.co_threshold > 800 ? 'Very high — a fire may go undetected' : undefined}
              />

              <FormField label="BFP Responder Contact">
                <input
                  type="tel"
                  placeholder="+639XXXXXXXXX"
                  value={editForm.bfp_contact}
                  onChange={e => setEditForm({ ...editForm, bfp_contact: e.target.value })}
                  className="w-full border border-[#E5E2E1] rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#AF101A]/30 focus:border-[#AF101A]"
                />
              </FormField>

              {/* Install location — set by the resident (update_own_device_location), confirmed here.
                  The address text and the pin are independent fields (lib/location.ts), so check both.
                  Any change the resident makes later withdraws the confirmation (DB trigger). */}
              <div className="border-t border-[#E5E2E1] pt-6 flex flex-col gap-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#5B403D] font-semibold text-[11px] tracking-[0.05em] uppercase">
                    Install Location
                  </span>
                  {(() => {
                    const saved = locationState(editingDevice);
                    if (saved === 'verified') return (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#047857]">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Confirmed{editingDevice.location_verified_at ? ` ${new Date(editingDevice.location_verified_at).toLocaleDateString()}` : ''}
                      </span>
                    );
                    return <LocationStateBadge state={saved} />;
                  })()}
                </div>

                <FormField label="Address" htmlFor="edit-location-desc">
                  <input
                    id="edit-location-desc"
                    type="text"
                    maxLength={200}
                    placeholder="Not set by the resident yet"
                    value={editForm.location_desc}
                    onChange={e => setEditForm({ ...editForm, location_desc: e.target.value })}
                    className="w-full border border-[#E5E2E1] rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#AF101A]/30 focus:border-[#AF101A]"
                  />
                </FormField>

                <PinMap
                  lat={editForm.latitude.trim() ? parseFloat(editForm.latitude) : null}
                  lng={editForm.longitude.trim() ? parseFloat(editForm.longitude) : null}
                  onChange={(lat, lng) => setEditForm({ ...editForm, latitude: String(lat), longitude: String(lng) })}
                  heightClass="h-48"
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Latitude" htmlFor="edit-latitude">
                    <input
                      id="edit-latitude"
                      type="text"
                      inputMode="decimal"
                      placeholder="14.8447"
                      value={editForm.latitude}
                      onChange={e => setEditForm({ ...editForm, latitude: e.target.value })}
                      className="w-full border border-[#E5E2E1] rounded px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#AF101A]/30 focus:border-[#AF101A]"
                    />
                  </FormField>
                  <FormField label="Longitude" htmlFor="edit-longitude">
                    <input
                      id="edit-longitude"
                      type="text"
                      inputMode="decimal"
                      placeholder="120.8112"
                      value={editForm.longitude}
                      onChange={e => setEditForm({ ...editForm, longitude: e.target.value })}
                      className="w-full border border-[#E5E2E1] rounded px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#AF101A]/30 focus:border-[#AF101A]"
                    />
                  </FormField>
                </div>
                <p className="text-[10px] text-[#5B403D] -mt-2">
                  Decimal degrees; west and south are negative. Click the map or drag the pin to move it. Used only
                  when the device has no GPS fix of its own. Clear both to remove the pin.
                </p>

                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editForm.location_verified}
                    onChange={e => setEditForm({ ...editForm, location_verified: e.target.checked })}
                    className="mt-0.5 accent-[#047857]"
                  />
                  <span className="text-xs text-[#1C1B1B]">
                    <span className="font-bold">Location confirmed.</span> I've checked that the address and pin
                    match where this device is installed.
                  </span>
                </label>
              </div>

              {/* Firmware (OTA) — target version/URL/MD5 the admin sets vs
                  what the device last reported actually running (via its
                  telemetry POST) — see firmware/agapsense-firmware's
                  connectivity.cpp fetchRemoteConfig()/performOtaUpdate(). */}
              <div className="border-t border-[#E5E2E1] pt-6 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span className="text-[#5B403D] font-semibold text-[11px] tracking-[0.05em] uppercase">
                    Firmware (OTA)
                  </span>
                  <span className="text-[11px] font-mono text-[#5B403D]">
                    Running: {editingDevice.firmware_version_reported || 'Unknown'}
                  </span>
                </div>

                {editForm.firmware_version &&
                  editForm.firmware_version !== (editingDevice.firmware_version_reported || '') && (
                  <div className="flex items-center gap-1.5 text-[#F59E0B]">
                    <AlertTriangle size={12} />
                    <span className="text-[10px] font-bold">
                      Device hasn't reported running the target version yet — it syncs on its next config poll.
                    </span>
                  </div>
                )}

                <FormField label="Target Firmware Version">
                  <input
                    type="text"
                    placeholder="e.g. 2.1.0 — leave blank to opt the device out of OTA"
                    value={editForm.firmware_version}
                    onChange={e => setEditForm({ ...editForm, firmware_version: e.target.value })}
                    className="w-full border border-[#E5E2E1] rounded px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#AF101A]/30 focus:border-[#AF101A]"
                  />
                </FormField>

                <FormField label="Firmware Binary URL">
                  <input
                    type="text"
                    placeholder="https://<project>.supabase.co/storage/v1/object/public/firmware/....bin"
                    value={editForm.firmware_url}
                    onChange={e => setEditForm({ ...editForm, firmware_url: e.target.value })}
                    className="w-full border border-[#E5E2E1] rounded px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#AF101A]/30 focus:border-[#AF101A]"
                  />
                </FormField>

                <FormField label="Firmware MD5 (optional)">
                  <input
                    type="text"
                    placeholder="32-char hex — leave blank to skip the integrity check"
                    value={editForm.firmware_md5}
                    onChange={e => setEditForm({ ...editForm, firmware_md5: e.target.value })}
                    className="w-full border border-[#E5E2E1] rounded px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#AF101A]/30 focus:border-[#AF101A]"
                  />
                </FormField>
              </div>

              {/* API Key Regeneration (spec SW-2.6.3) */}
              <div className="border-t border-[#E5E2E1] pt-6">
                <FormField label="Device API Key">
                  {newApiKey ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          readOnly
                          value={newApiKey}
                          onFocus={e => e.target.select()}
                          className="flex-1 border border-[#E5E2E1] rounded px-4 py-2.5 text-xs font-mono bg-[#F6F3F2] focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={copyNewApiKey}
                          title="Copy to clipboard"
                          className="px-3 rounded border border-[#E5E2E1] text-[#5B403D] hover:bg-[#F6F3F2] transition-colors shrink-0"
                        >
                          {keyCopied ? <Check className="w-4 h-4 text-[#10B981]" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                      <div className="flex items-start gap-1.5 text-[#F59E0B]">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                        <span className="text-[10px] font-bold">Copy this now — it won't be shown again. Reconfigure the device with this key before it goes offline.</span>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleRegenerateKey}
                      disabled={regeneratingKey}
                      className="flex items-center gap-2 px-4 py-2.5 rounded border border-[#E5E2E1] text-[#5B403D] text-sm font-bold hover:bg-[#F6F3F2] transition-colors disabled:opacity-60 w-fit"
                    >
                      <KeyRound className="w-4 h-4" />
                      {regeneratingKey ? 'Regenerating...' : 'Regenerate API Key'}
                    </button>
                  )}
                </FormField>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-8">
              <button
                onClick={() => setEditingDevice(null)}
                className="px-4 py-2 text-sm font-bold text-[#5B403D] hover:bg-[#F6F3F2] rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveEditDevice}
                disabled={savingEdit}
                className="px-4 py-2 text-sm font-bold text-white bg-primary hover:bg-primary-dark rounded transition-colors disabled:opacity-60"
              >
                {savingEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Inline style for form inputs */}
      <style dangerouslySetInnerHTML={{__html: `
        .form-input-field {
          width: 100%;
          background: #FFFFFF;
          border: none;
          border-radius: 4px 4px 0 0;
          padding: 14px 16px;
          font-family: Inter, sans-serif;
          font-size: 16px;
          color: #1C1B1B;
          outline: none;
          transition: box-shadow 0.2s;
        }
        .form-input-field::placeholder {
          color: #A1A1AA;
        }
        .form-input-field:focus {
          box-shadow: 0 2px 0 0 #AF101A;
        }
      `}} />
    </div>
  );
};

// ─── Helper: Form Field ───
const FormField = ({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-2">
    <label htmlFor={htmlFor} className="text-[#5B403D] font-semibold text-[11px] tracking-[0.05em] uppercase">
      {label}
    </label>
    {children}
  </div>
);

// ─── Helper: read-only value with a copy button (shown once after registering) ───
const CopyField = ({ label, value, copied, onCopy }: { label: string; value: string; copied: boolean; onCopy: () => void }) => (
  <FormField label={label}>
    <div className="flex gap-2">
      <input
        type="text"
        readOnly
        value={value}
        onFocus={e => e.target.select()}
        aria-label={label}
        className="flex-1 min-w-0 bg-white rounded px-4 py-3 text-sm font-mono text-[#1C1B1B] focus:outline-none"
      />
      <button
        type="button"
        onClick={onCopy}
        title={`Copy ${label.toLowerCase()}`}
        className="px-3 rounded border border-[#E5E2E1] bg-white text-[#5B403D] hover:bg-[#F6F3F2] transition-colors shrink-0"
      >
        {copied ? <Check className="w-4 h-4 text-[#10B981]" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  </FormField>
);

// ─── Helper: Threshold Slider ───
const ThresholdSlider = ({
  label,
  value,
  onChange,
  min,
  max,
  unit,
  minLabel,
  maxLabel,
  warning,
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
  min: number;
  max: number;
  unit: string;
  minLabel: string;
  maxLabel: string;
  warning?: string;
}) => {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="flex flex-col gap-2">
      {/* Label row */}
      <div className="flex items-center justify-between">
        <span className="text-[#5B403D] font-semibold text-[11px] tracking-[0.05em] uppercase">
          {label}
        </span>
        <span className="text-[#AF101A] font-bold text-sm">
          {value} {unit}
        </span>
      </div>

      {/* Slider track */}
      <div className="relative h-2 w-full">
        {/* Background track */}
        <div className="absolute inset-0 bg-[#E5E2E1] rounded"></div>
        {/* Filled track */}
        <div
          className="absolute top-0 left-0 h-full bg-[#AF101A] rounded"
          style={{ width: `${percentage}%` }}
        ></div>
        {/* Range input (transparent, on top for interaction) */}
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        {/* Thumb indicator */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-[#AF101A] rounded-full shadow-sm pointer-events-none"
          style={{ left: `calc(${percentage}% - 8px)` }}
        ></div>
      </div>

      {/* Min/Max labels */}
      <div className="flex items-center justify-between">
        <span className="text-[#5B403D] text-[9.6px] leading-[14.4px]">
          {minLabel}
        </span>
        <span className="text-[#5B403D] text-[9.6px] leading-[14.4px]">
          {maxLabel}
        </span>
      </div>
      
      {warning && (
        <div className="flex items-center gap-1.5 mt-1 text-[#F59E0B]">
          <AlertTriangle size={12} />
          <span className="text-[10px] font-bold">{warning}</span>
        </div>
      )}
    </div>
  );
};
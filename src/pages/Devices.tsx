import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Device } from '../lib/supabase';
import { Cpu, ChevronRight, Info, Loader2, AlertTriangle, Pencil, BatteryWarning, X, KeyRound, Copy, Check } from 'lucide-react';
import { CardListSkeleton } from '../components/SkeletonLoaders';

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
  // device_id -> latest on_battery (spec HW-1.5.2/SW-2.4.4)
  const [batteryByDevice, setBatteryByDevice] = useState<Record<string, boolean>>({});

  // Editing an already-registered device's thresholds + BFP contact
  // (spec HW-1.1.5 / SW-2.5.5) — previously only settable at creation.
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [editForm, setEditForm] = useState({ temp_threshold: 65, co_threshold: 15, bfp_contact: '' });
  const [savingEdit, setSavingEdit] = useState(false);

  // API key regeneration (spec SW-2.6.3) — shown once, right after
  // regenerating, since the raw key otherwise only appears in `devices`
  // rows the admin already has (devices_safe masks it for other roles).
  const [regeneratingKey, setRegeneratingKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);

  // Form state matching Figma fields
  const [form, setForm] = useState({
    device_code: '',
    label: '',        // "Assigned Owner" maps to label
    location_desc: '', // "Location Reference"
    latitude: '',
    longitude: '',
    temp_threshold: 65,
    co_threshold: 15,   // stored as obscuration % in UI, but ppm in DB
    bfp_contact: '',
  });

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    const [devicesRes, batteryRes] = await Promise.all([
      supabase.from('devices').select('*').order('created_at', { ascending: false }),
      // Latest readings across devices, to derive each device's current
      // on_battery state (no per-device "latest reading" view exists, so
      // the most recent batch is reduced client-side below).
      supabase.from('sensor_readings')
        .select('device_id, on_battery, recorded_at')
        .order('recorded_at', { ascending: false })
        .limit(300),
    ]);

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

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  const openEditDevice = (device: Device) => {
    setEditingDevice(device);
    setEditForm({
      temp_threshold: device.temp_threshold,
      co_threshold: device.co_threshold,
      bfp_contact: device.bfp_contact || '',
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
    setSavingEdit(true);
    const { error } = await supabase
      .from('devices')
      .update({
        temp_threshold: editForm.temp_threshold,
        co_threshold: editForm.co_threshold,
        bfp_contact: editForm.bfp_contact || null,
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

    // api_key is generated server-side (devices.api_key column default,
    // a CSPRNG via pgcrypto) - not set here.
    const { error } = await supabase.from('devices').insert([{
      device_code: form.device_code,
      label: form.label || form.device_code,
      location_desc: form.location_desc,
      latitude: form.latitude ? parseFloat(form.latitude) : null,
      longitude: form.longitude ? parseFloat(form.longitude) : null,
      co_threshold: form.co_threshold,
      temp_threshold: form.temp_threshold,
      bfp_contact: form.bfp_contact || null,
    }]);

    if (!error) {
      setForm({
        device_code: '',
        label: '',
        location_desc: '',
        latitude: '',
        longitude: '',
        temp_threshold: 65,
        co_threshold: 15,
        bfp_contact: '',
      });
      fetchDevices();
    } else {
      alert(error.message);
    }
    setSubmitting(false);
  };

  return (
    <div className="space-y-10">
      {/* Page Header */}
      <div>
        <h2 className="text-[#1C1B1B] font-extrabold text-[40px] leading-9 tracking-[-0.019em]">
          Device Registration
        </h2>
        <p className="text-[#5B403D] text-base leading-6 mt-3 max-w-[656px]">
          Provision hardware nodes for the thermal monitoring mesh. Ensure all GPS coordinates
          are calibrated to within 2 meters for accurate emergency dispatch.
        </p>
      </div>

      {/* Main Grid: 12-col → 7-col Left + 5-col Right */}
      <div className="grid grid-cols-12 gap-8">
        {/* ─── LEFT PANEL: Registration Form ─── */}
        <div className="col-span-12 lg:col-span-7">
          <form onSubmit={handleSubmit} className="bg-[#F6F3F2] rounded-lg p-8 pb-12 flex flex-col gap-8">
            {/* Form Fields Grid: 2-col */}
            <div className="grid grid-cols-2 gap-6">
              {/* Device UID */}
              <FormField label="Device UID">
                <input
                  type="text"
                  required
                  placeholder="VG-IOT-XXXXX"
                  value={form.device_code}
                  onChange={e => setForm({ ...form, device_code: e.target.value })}
                  className="form-input-field"
                />
              </FormField>

              {/* Assigned Owner */}
              <FormField label="Assigned Owner">
                <input
                  type="text"
                  placeholder="Industrial Safety Div."
                  value={form.label}
                  onChange={e => setForm({ ...form, label: e.target.value })}
                  className="form-input-field"
                />
              </FormField>

              {/* Location Reference — full width */}
              <div className="col-span-2">
                <FormField label="Location Reference">
                  <input
                    type="text"
                    required
                    placeholder="e.g. Server Room 402 - East Wing"
                    value={form.location_desc}
                    onChange={e => setForm({ ...form, location_desc: e.target.value })}
                    className="form-input-field"
                  />
                </FormField>
              </div>

              {/* GPS Latitude */}
              <FormField label="GPS Latitude">
                <input
                  type="text"
                  placeholder="40.7128° N"
                  value={form.latitude}
                  onChange={e => setForm({ ...form, latitude: e.target.value })}
                  className="form-input-field"
                />
              </FormField>

              {/* GPS Longitude */}
              <FormField label="GPS Longitude">
                <input
                  type="text"
                  placeholder="74.0060° W"
                  value={form.longitude}
                  onChange={e => setForm({ ...form, longitude: e.target.value })}
                  className="form-input-field"
                />
              </FormField>
            </div>

            {/* Threshold Sliders — separated by divider */}
            <div className="border-t border-[#E5E2E1] pt-4 flex flex-col gap-6">
              {/* Temperature Alert Threshold */}
              <ThresholdSlider
                label="Temperature Alert Threshold"
                value={form.temp_threshold}
                onChange={val => setForm({ ...form, temp_threshold: val })}
                min={20}
                max={120}
                unit="°C"
                minLabel="Safe (20°C)"
                maxLabel="Critical (120°C)"
                warning={form.temp_threshold < 40 ? 'Very low — may cause frequent false alarms' : form.temp_threshold > 80 ? 'Dangerously high — fire may go undetected' : undefined}
              />

              {/* Smoke Particulate Threshold */}
              <ThresholdSlider
                label="Smoke Particulate Threshold"
                value={form.co_threshold}
                onChange={val => setForm({ ...form, co_threshold: val })}
                min={0}
                max={100}
                unit="% Obscuration"
                minLabel="Clear"
                maxLabel="Hazardous"
                warning={form.co_threshold < 10 ? 'Very sensitive — expect frequent alerts' : form.co_threshold > 80 ? 'Very high — smoke may go undetected' : undefined}
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-4 rounded text-white font-bold text-base tracking-[0.025em] uppercase flex items-center justify-center gap-2 transition-all disabled:opacity-60"
              style={{ background: 'linear-gradient(90deg, #AF101A 0%, #D32F2F 100%)' }}
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Cpu className="w-4 h-4" />
              )}
              {submitting ? 'Registering...' : 'Initialize & Register Device'}
            </button>
          </form>
        </div>

        {/* ─── RIGHT PANEL: Recently Registered ─── */}
        <div className="col-span-12 lg:col-span-5 flex flex-col gap-6">
          {/* Recently Registered Card */}
          <div className="bg-[#EBE7E7] rounded-lg p-6 flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <h3 className="text-[#1C1B1B] font-bold text-sm tracking-[0.1em] uppercase">
                Recently Registered
              </h3>
              <span className="bg-[rgba(211,47,47,0.1)] text-[#D32F2F] font-bold text-[9.6px] uppercase px-2 py-1 rounded-sm">
                System Real-time
              </span>
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
                  <p className="text-[#5B403D] text-xs mt-1">Use the form to provision your first device.</p>
                </div>
              ) : (
                devices.slice(0, 5).map(device => (
                  <div
                    key={device.id}
                    className="bg-white rounded flex items-center gap-4 p-4 group hover:shadow-sm transition-shadow"
                  >
                    {/* Icon */}
                    <div className="w-12 h-12 bg-[#EBE7E7] rounded-sm flex items-center justify-center shrink-0">
                      <Cpu className="w-5 h-5 text-[#AF101A]" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-end justify-between">
                        <span className="font-bold text-xs text-[#1C1B1B]">{device.device_code}</span>
                        <span className="text-[#5B403D] font-medium text-[9.6px]">
                          {timeAgo(device.created_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-[#5B403D] text-[11px] leading-[16.5px] truncate">
                          {device.location_desc}
                        </p>
                        {batteryByDevice[device.id] && (
                          <span title="Running on backup battery" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#B45309] text-[9px] font-bold uppercase tracking-wide shrink-0">
                            <BatteryWarning className="w-3 h-3" /> Battery
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Edit */}
                    <button
                      onClick={() => openEditDevice(device)}
                      title="Edit thresholds and BFP contact"
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

          {/* Calibration Protocol Info Card */}
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
                Calibration Protocol
              </h4>
              <p className="text-[#5B403D] text-xs leading-[19.5px] mt-1">
                Once registered, the device will enter a 10-minute
                baseline calibration period. Alerts will be
                suppressed until atmospheric normalization is
                complete.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Device Modal — thresholds + BFP contact for an existing device */}
      {editingDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditingDevice(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[#1C1B1B] font-extrabold text-xl">Edit Device Settings</h3>
              <button onClick={() => setEditingDevice(null)} className="text-[#A1A1AA] hover:text-[#1C1B1B] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-[#5B403D] text-sm mb-6">
              Update alert thresholds and BFP contact for <span className="font-bold">{editingDevice.device_code}</span>. Changes take effect on the device's next config sync.
            </p>

            <div className="flex flex-col gap-6">
              <ThresholdSlider
                label="Temperature Alert Threshold"
                value={editForm.temp_threshold}
                onChange={val => setEditForm({ ...editForm, temp_threshold: val })}
                min={20}
                max={120}
                unit="°C"
                minLabel="Safe (20°C)"
                maxLabel="Critical (120°C)"
                warning={editForm.temp_threshold < 40 ? 'Very low — may cause frequent false alarms' : editForm.temp_threshold > 80 ? 'Dangerously high — fire may go undetected' : undefined}
              />
              <ThresholdSlider
                label="Smoke Particulate Threshold"
                value={editForm.co_threshold}
                onChange={val => setEditForm({ ...editForm, co_threshold: val })}
                min={0}
                max={100}
                unit="% Obscuration"
                minLabel="Clear"
                maxLabel="Hazardous"
                warning={editForm.co_threshold < 10 ? 'Very sensitive — expect frequent alerts' : editForm.co_threshold > 80 ? 'Very high — smoke may go undetected' : undefined}
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
                className="px-4 py-2 text-sm font-bold text-white bg-[#AF101A] hover:bg-[#8F0C14] rounded transition-colors disabled:opacity-60"
              >
                {savingEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
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
          color: #6B7280;
        }
        .form-input-field:focus {
          box-shadow: 0 2px 0 0 #AF101A;
        }
      `}} />
    </div>
  );
};

// ─── Helper: Form Field ───
const FormField = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-2">
    <label className="text-[#5B403D] font-semibold text-[11px] tracking-[0.05em] uppercase">
      {label}
    </label>
    {children}
  </div>
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
          {value}{unit}
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
        <span className="text-[#5B403D] uppercase text-[9.6px] leading-[14.4px]">
          {minLabel}
        </span>
        <span className="text-[#5B403D] uppercase text-[9.6px] leading-[14.4px]">
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
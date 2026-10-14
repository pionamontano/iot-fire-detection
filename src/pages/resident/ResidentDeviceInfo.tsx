import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { DeviceInfoSkeleton } from '../../components/SkeletonLoaders';
import { TABLE_CARD, TABLE_TOOLBAR, TABLE, THEAD_ROW, TH, TR, TD, TableScroll, TableEmpty, TablePager, TABLE_PAGE_SIZE } from '../../components/Table';
import { usePagedRows } from '../../hooks/usePagedRows';
import type { Device, SensorReading } from '../../lib/supabase';
import { MapPin, Thermometer, Wind, Clock, Wifi, WifiOff, CheckCircle2, XCircle, RefreshCw, Pencil, ShieldCheck } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { resolveDeviceLocation, markerOpacity, displayAddress, isValidCoordinate } from '../../lib/location';
import { LocationBadge, LocationUnavailablePanel } from '../../components/LocationBadge';
import { DeviceLocationEditor } from '../../components/DeviceLocationEditor';

const markerIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

export const ResidentDeviceInfo = () => {
  const { profile } = useAuth();
  const [device, setDevice] = useState<Device | null>(null);
  const [readings, setReadings] = useState<SensorReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // The resident sets the install address and pin themselves; an admin then confirms them
  // (update_own_device_location, 20261102000000).
  const [editingLocation, setEditingLocation] = useState(false);
  const [locationMsg, setLocationMsg] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.device_id) {
      fetchData(profile.device_id);
    } else if (profile) {
      setLoading(false);
    }
  }, [profile]);

  const fetchData = async (deviceId: string) => {
    try {
      const [deviceRes, readingsRes] = await Promise.all([
        supabase.from('devices_safe').select('*').eq('id', deviceId).single(),
        supabase.from('sensor_readings').select('*').eq('device_id', deviceId).order('recorded_at', { ascending: false }).limit(20),
      ]);
      if (deviceRes.data) setDevice(deviceRes.data);
      if (readingsRes.data) setReadings(readingsRes.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!profile?.device_id || refreshing) return;
    setRefreshing(true);
    await fetchData(profile.device_id);
    setRefreshing(false);
  };

  const { page, setPage, pageRows } = usePagedRows(readings);

  if (loading) return <DeviceInfoSkeleton />;
  if (!device) return <div className="p-8 font-bold text-[#DC2626]">No device registered to your account.</div>;

  const isOnline = device.last_seen_at && (Date.now() - new Date(device.last_seen_at).getTime() < 5 * 60 * 1000);

  // Live GPS / last-known GPS / registered install coordinates / unavailable - never an invented position.
  // `readings` is newest first (the 20 most recent), so a last-known position can come from an earlier one.
  const location = resolveDeviceLocation({ readings, device });

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[#DC2626]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#DC2626]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.1em]">Hardware Profile</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-[#18181B]">Device Information</h1>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-[#18181B] text-white text-[10px] font-bold uppercase tracking-widest rounded hover:bg-black transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Info (2/3) */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Device Card */}
          <div className="bg-white border border-[#E4E4E7] rounded-lg p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${isOnline ? 'bg-[#E0F2FE] text-[#00799C]' : 'bg-[#FEE2E2] text-[#DC2626]'}`}>
                {isOnline ? <Wifi className="w-6 h-6" /> : <WifiOff className="w-6 h-6" />}
              </div>
              <div>
                <h2 className="text-xl font-black text-[#18181B]">{device.device_code}</h2>
                <p className="text-xs text-[#52525B]">{device.label}</p>
              </div>
              <span className={`ml-auto text-[9px] font-bold px-3 py-1 rounded-full uppercase ${isOnline ? 'bg-[#E0F2FE] text-[#00799C]' : 'bg-[#FEE2E2] text-[#DC2626]'}`}>
                {isOnline ? 'ONLINE' : 'OFFLINE'}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-[#F4F4F5] p-3 rounded col-span-2">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-[#A1A1AA] block">Location</span>
                  {!editingLocation && (
                    <button
                      onClick={() => { setLocationMsg(null); setEditingLocation(true); }}
                      title="Edit address and pin"
                      className="text-[#A1A1AA] hover:text-[#18181B] transition-colors"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <span className="text-xs font-bold text-[#18181B] flex items-center gap-1 mt-1"><MapPin className="w-3 h-3" />{displayAddress(device.location_desc)}</span>
                {locationMsg && (
                  <p className="text-[10px] font-bold mt-1.5 text-[#00799C]">{locationMsg}</p>
                )}
              </div>
              <div className="bg-[#F4F4F5] p-3 rounded">
                <span className="text-[9px] font-bold uppercase tracking-wider text-[#A1A1AA] block">Temp Threshold</span>
                <span className="text-xs font-bold text-[#DC2626] flex items-center gap-1 mt-1"><Thermometer className="w-3 h-3" />{device.temp_threshold}°C</span>
              </div>
              <div className="bg-[#F4F4F5] p-3 rounded">
                <span className="text-[9px] font-bold uppercase tracking-wider text-[#A1A1AA] block">CO Threshold</span>
                <span className="text-xs font-bold text-[#DC2626] flex items-center gap-1 mt-1"><Wind className="w-3 h-3" />{device.co_threshold} ppm</span>
              </div>
              <div className="bg-[#F4F4F5] p-3 rounded">
                <span className="text-[9px] font-bold uppercase tracking-wider text-[#A1A1AA] block">Last Seen</span>
                <span className="text-xs font-bold text-[#18181B] flex items-center gap-1 mt-1"><Clock className="w-3 h-3" />{device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : 'Never'}</span>
              </div>
            </div>
          </div>

          {editingLocation && (
            <div className="bg-white border border-[#E4E4E7] rounded-lg p-6">
              <h2 className="text-lg font-black tracking-tight text-[#18181B]">Install Location</h2>
              <p className="text-xs text-[#52525B] mt-1 mb-5">
                Where is the device installed? Changing it sends the new pin to an administrator to confirm.
              </p>
              <DeviceLocationEditor
                initialAddress={device.location_desc}
                initialLat={device.latitude}
                initialLng={device.longitude}
                onCancel={() => setEditingLocation(false)}
                onSaved={saved => {
                  setDevice(prev => prev ? { ...prev, ...saved, location_verified_at: null } : prev);
                  setEditingLocation(false);
                  setLocationMsg('Location saved. An administrator will confirm it.');
                }}
              />
            </div>
          )}

          {/* Recent Readings Table */}
          <div className={TABLE_CARD}>
            <div className={TABLE_TOOLBAR}>
              <div>
                <h2 className="text-lg font-black tracking-tight text-[#18181B]">Recent Sensor Readings</h2>
                <p className="text-[10px] text-[#A1A1AA] uppercase tracking-wider mt-1">Last {readings.length} readings</p>
              </div>
            </div>
            <TableScroll>
              <table className={TABLE}>
                <thead>
                  <tr className={THEAD_ROW}>
                    <th className={TH}>Timestamp</th>
                    <th className={TH}>Temp</th>
                    <th className={TH}>CO</th>
                    <th className={TH}>GPS</th>
                    <th className={TH}>Power</th>
                    <th className={TH}>Sensor</th>
                  </tr>
                </thead>
                <tbody>
                  {readings.length > 0 ? pageRows.map(r => (
                    <tr key={r.id} className={TR}>
                      <td className={`${TD} text-xs text-[#52525B]`}>{new Date(r.recorded_at).toLocaleString()}</td>
                      <td className={`${TD} text-xs font-bold ${r.temp_celsius >= device.temp_threshold ? 'text-[#DC2626]' : 'text-[#18181B]'}`}>{r.temp_celsius.toFixed(1)}°C</td>
                      <td className={`${TD} text-xs font-bold ${r.co_ppm >= device.co_threshold ? 'text-[#DC2626]' : 'text-[#18181B]'}`}>{r.co_ppm.toFixed(0)} ppm</td>
                      <td className={`${TD} text-xs`}>{r.gps_valid ? <CheckCircle2 className="w-4 h-4 text-[#00799C]" /> : <XCircle className="w-4 h-4 text-[#A1A1AA]" />}</td>
                      <td className={`${TD} text-xs text-[#18181B]`}>{r.on_battery ? 'Battery' : 'Mains'}</td>
                      <td className={`${TD} text-xs`}>{r.sensor_ready ? <CheckCircle2 className="w-4 h-4 text-[#00799C]" /> : <XCircle className="w-4 h-4 text-[#DC2626]" />}</td>
                    </tr>
                  )) : (
                    <TableEmpty colSpan={6}>No sensor readings available.</TableEmpty>
                  )}
                </tbody>
              </table>
            </TableScroll>
            <TablePager page={page} pageSize={TABLE_PAGE_SIZE} total={readings.length} onPageChange={setPage} />
          </div>
        </div>

        {/* Sidebar (1/3) */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          {/* Map */}
          <div className="bg-white border border-[#E4E4E7] rounded-lg p-4">
            <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-[#52525B] mb-3">Device Location</h3>
            {location.lat !== null && location.lng !== null ? (
              <div className="h-56 rounded overflow-hidden relative z-0">
                <MapContainer key={`${location.lat},${location.lng}`} center={[location.lat, location.lng]} zoom={14} style={{ height: '100%', width: '100%' }} zoomControl={false}>
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <Marker position={[location.lat, location.lng]} icon={markerIcon} opacity={markerOpacity(location.kind)}>
                    <Popup><strong>{device.device_code}</strong><br />{displayAddress(device.location_desc)}</Popup>
                  </Marker>
                </MapContainer>
              </div>
            ) : (
              <LocationUnavailablePanel heightClass="h-56" />
            )}
            <LocationBadge location={location} />
            <div className="mt-3 flex items-center justify-between gap-2 text-[11px]">
              {!isValidCoordinate(device.latitude, device.longitude) ? (
                <span className="font-bold text-[#B45309] flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />Install pin not set</span>
              ) : device.location_verified ? (
                <span className="font-bold text-[#047857] flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" />Install pin confirmed</span>
              ) : (
                <span className="font-bold text-[#B45309] flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />Install pin waiting for confirmation</span>
              )}
              {!editingLocation && (
                <button
                  onClick={() => { setLocationMsg(null); setEditingLocation(true); }}
                  className="font-bold uppercase tracking-wide text-[#00799C] hover:underline shrink-0"
                >
                  {isValidCoordinate(device.latitude, device.longitude) ? 'Move pin' : 'Set pin'}
                </button>
              )}
            </div>
          </div>

          {/* Device Specs */}
          <div className="bg-[#F4F4F5] border border-[#E4E4E7] rounded-lg p-6">
            <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-[#52525B] mb-4">Device Specs</h3>
            <div className="flex flex-col gap-3">
              {[
                { label: 'Device Code', value: device.device_code },
                { label: 'Active', value: device.is_active ? 'Yes' : 'No' },
                { label: 'Registered', value: new Date(device.created_at).toLocaleDateString() },
                { label: 'BFP Contact', value: device.bfp_contact || 'Not set' },
              ].map((item, i) => (
                <div key={i} className="flex justify-between bg-white p-3 rounded shadow-sm">
                  <span className="text-xs text-[#52525B]">{item.label}</span>
                  <span className="text-xs font-bold text-[#18181B]">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

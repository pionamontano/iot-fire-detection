import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { DeviceInfoSkeleton } from '../../components/SkeletonLoaders';
import { TABLE_CARD, TABLE_TOOLBAR, TABLE, THEAD_ROW, TH, TR, TD, TableScroll, TableEmpty, TablePager, TABLE_PAGE_SIZE } from '../../components/Table';
import { usePagedRows } from '../../hooks/usePagedRows';
import type { Device, SensorReading } from '../../lib/supabase';
import { Wifi, WifiOff, Power, RefreshCw, ShieldCheck, MapPin, ArrowRight } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { resolveDeviceLocation, markerOpacity, displayAddress, isValidCoordinate } from '../../lib/location';
import { LocationBadge, LocationUnavailablePanel } from '../../components/LocationBadge';
import { DeviceLocationEditor } from '../../components/DeviceLocationEditor';
import { PageHeader } from '../../components/PageHeader';
import { BTN_SECONDARY } from '../../components/ui';
import { StatusBadge } from '../../components/StatusBadge';
import { NoDeviceLinked } from '../../components/NoDeviceLinked';
import { DEVICE_STATUS, getDeviceStatus, formatAgo } from '../../lib/deviceStatus';
import { formatEventTime } from '../../lib/alertText';

const CARD = 'bg-white border border-border rounded-lg p-5 sm:p-6';
const CARD_TITLE = 'text-lg font-bold tracking-[-0.01em] text-text';

// Label / value pair in the device card.
const Fact = ({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) => (
  <div className="min-w-0">
    <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-text-body">{label}</dt>
    <dd className="text-sm font-bold text-text mt-1 break-words">{children}</dd>
    {sub && <dd className="text-[11px] text-text-subtle mt-0.5">{sub}</dd>}
  </div>
);

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
  if (!device) return <NoDeviceLinked />;

  // Shared status vocabulary and 2 / 15 minute rule (same as the Dashboard and admin
  // pages); an admin-disabled device shows as Disabled, not merely offline.
  const status = getDeviceStatus(device, []);
  const hasPin = isValidCoordinate(device.latitude, device.longitude);

  // Live GPS / last-known GPS / registered install coordinates / unavailable - never an invented position.
  // `readings` is newest first (the 20 most recent), so a last-known position can come from an earlier one.
  const location = resolveDeviceLocation({ readings, device });

  const startEditing = () => { setLocationMsg(null); setEditingLocation(true); };

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        title="Device Information"
        description="Your device's details, install location and recent sensor readings."
        actions={
          <button type="button" onClick={handleRefresh} disabled={refreshing} className={BTN_SECONDARY}>
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main column (2/3) */}
        <div className="lg:col-span-2 flex flex-col gap-6 min-w-0">
          {/* Device */}
          <section className={CARD}>
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${DEVICE_STATUS[status].badgeBg} ${DEVICE_STATUS[status].badgeText}`}>
                {status === 'disabled' ? <Power className="w-6 h-6" /> : status === 'offline' ? <WifiOff className="w-6 h-6" /> : <Wifi className="w-6 h-6" />}
              </div>
              <div className="min-w-0">
                <h2 className="text-xl font-extrabold text-text">{device.device_code}</h2>
                {device.label && <p className="text-xs text-text-body">{device.label}</p>}
              </div>
              <span className="ml-auto"><StatusBadge status={status} /></span>
            </div>

            <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-5 mt-6 pt-5 border-t border-border-warm">
              <Fact label="Last report" sub={device.last_seen_at ? formatEventTime(device.last_seen_at) : undefined}>
                {device.last_seen_at ? formatAgo(device.last_seen_at) : 'Never'}
              </Fact>
              <Fact label="Alert levels" sub={<Link to="/home/settings" className="text-primary-dark font-bold hover:underline">Change</Link>}>
                {device.temp_threshold} °C · {device.co_threshold} ppm
              </Fact>
              <Fact label="Firmware">{device.firmware_version_reported || 'Not reported'}</Fact>
              <Fact label="Registered">{new Date(device.created_at).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}</Fact>
              <Fact label="BFP SMS" sub="Set by an administrator">{device.bfp_contact ? 'Set' : 'Not set'}</Fact>
            </dl>
          </section>

          {editingLocation && (
            <section className={CARD}>
              <h2 className={CARD_TITLE}>Edit Install Location</h2>
              <p className="text-xs text-text-subtle mt-0.5 mb-5">
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
            </section>
          )}

          {/* Recent readings */}
          <div className={TABLE_CARD}>
            <div className={TABLE_TOOLBAR}>
              <div>
                <h2 className={CARD_TITLE}>Recent Readings</h2>
                <p className="text-xs text-text-subtle mt-0.5">Last {readings.length} readings · values at or over an alert level are red</p>
              </div>
            </div>
            <TableScroll>
              <table className={TABLE}>
                <thead>
                  <tr className={THEAD_ROW}>
                    <th className={TH}>Time</th>
                    <th className={`${TH} !text-right`}>Temp</th>
                    <th className={`${TH} !text-right`}>CO</th>
                    <th className={TH}>GPS</th>
                    <th className={TH}>Power</th>
                    <th className={TH}>Sensors</th>
                  </tr>
                </thead>
                <tbody>
                  {readings.length > 0 ? pageRows.map(r => (
                    <tr key={r.id} className={TR}>
                      <td className={`${TD} text-xs text-text-body whitespace-nowrap`}>{formatEventTime(r.recorded_at)}</td>
                      <td className={`${TD} text-right font-mono text-xs font-bold whitespace-nowrap ${r.temp_celsius >= device.temp_threshold ? 'text-primary' : 'text-text'}`}>{r.temp_celsius.toFixed(1)}°C</td>
                      <td className={`${TD} text-right font-mono text-xs font-bold whitespace-nowrap ${r.co_ppm >= device.co_threshold ? 'text-primary' : 'text-text'}`}>{r.co_ppm.toFixed(0)} ppm</td>
                      <td className={`${TD} text-xs whitespace-nowrap ${r.gps_valid ? 'text-text' : 'text-text-subtle'}`}>{r.gps_valid ? 'Fix' : 'No fix'}</td>
                      <td className={`${TD} text-xs whitespace-nowrap ${r.on_battery ? 'text-[#B45309] font-semibold' : 'text-text'}`}>{r.on_battery ? 'Battery' : 'Mains'}</td>
                      <td className={`${TD} text-xs whitespace-nowrap ${r.sensor_ready ? 'text-text' : 'text-[#B45309] font-semibold'}`}>{r.sensor_ready ? 'Ready' : 'Warming up'}</td>
                    </tr>
                  )) : (
                    <TableEmpty colSpan={6}>No sensor readings yet.</TableEmpty>
                  )}
                </tbody>
              </table>
            </TableScroll>
            <TablePager page={page} pageSize={TABLE_PAGE_SIZE} total={readings.length} onPageChange={setPage} />
          </div>
        </div>

        {/* Side column (1/3): the one place for the install location */}
        <div className="lg:col-span-1 flex flex-col gap-6 min-w-0">
          <section className={CARD}>
            <h2 className={CARD_TITLE}>Install Location</h2>
            <p className="text-sm font-semibold text-text mt-3">{displayAddress(device.location_desc)}</p>
            <div className="mt-4">
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
            </div>
            <LocationBadge location={location} />
            <p className={`mt-4 flex items-center gap-1.5 text-xs font-bold ${hasPin && device.location_verified ? 'text-success-dark' : 'text-[#B45309]'}`}>
              {hasPin && device.location_verified ? <ShieldCheck className="w-3.5 h-3.5" /> : <MapPin className="w-3.5 h-3.5" />}
              {!hasPin ? 'Install pin not set' : device.location_verified ? 'Install pin confirmed by an administrator' : 'Install pin waiting for confirmation'}
            </p>
            {locationMsg && <p role="status" className="text-xs font-semibold text-success-dark mt-2">{locationMsg}</p>}
            {!editingLocation && (
              <button type="button" onClick={startEditing} className="mt-4 inline-flex items-center gap-1 text-primary-dark font-bold text-xs hover:underline">
                {hasPin ? 'Edit address or move pin' : 'Set address and pin'} <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

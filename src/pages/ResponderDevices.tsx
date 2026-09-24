import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Device, SensorReading } from '../lib/supabase';
import { Cpu, Search, Wifi, WifiOff, MapPin, Thermometer, Wind, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { CardListSkeleton } from '../components/SkeletonLoaders';

export const ResponderDevices = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedReading, setExpandedReading] = useState<SensorReading | null>(null);
  const [loadingReading, setLoadingReading] = useState(false);

  useEffect(() => {
    fetchDevices();
  }, []);

  const fetchDevices = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('devices_safe')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) setDevices(data);
    if (error) console.error(error);
    setLoading(false);
  };

  const toggleExpand = async (deviceId: string) => {
    if (expandedId === deviceId) {
      setExpandedId(null);
      setExpandedReading(null);
      return;
    }
    setExpandedId(deviceId);
    setLoadingReading(true);
    const { data } = await supabase
      .from('sensor_readings')
      .select('*')
      .eq('device_id', deviceId)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    setExpandedReading(data);
    setLoadingReading(false);
  };

  const filtered = devices.filter(d =>
    d.device_code.toLowerCase().includes(search.toLowerCase()) ||
    d.location_desc.toLowerCase().includes(search.toLowerCase()) ||
    d.label.toLowerCase().includes(search.toLowerCase())
  );

  const isOnline = (d: Device) => d.last_seen_at && (Date.now() - new Date(d.last_seen_at).getTime() < 5 * 60 * 1000);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-primary">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          <span className="text-[10px] font-bold uppercase tracking-[0.1em]">Hardware Inventory</span>
        </div>
        <h1 className="text-3xl font-black tracking-tight text-text-heading">Device Registry</h1>
        <p className="text-sm text-text-muted mt-1">View all fire detection units deployed in the field.</p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-surface-card border border-border rounded-lg p-4">
          <span className="text-[9px] font-bold uppercase tracking-wider text-text-faint">Total Devices</span>
          <p className="text-2xl font-black text-text-heading mt-1">{devices.length}</p>
        </div>
        <div className="bg-surface-card border border-border rounded-lg p-4">
          <span className="text-[9px] font-bold uppercase tracking-wider text-text-faint">Online</span>
          <p className="text-2xl font-black text-[#00799C] mt-1">{devices.filter(isOnline).length}</p>
        </div>
        <div className="bg-surface-card border border-border rounded-lg p-4">
          <span className="text-[9px] font-bold uppercase tracking-wider text-text-faint">Offline</span>
          <p className="text-2xl font-black text-[#DC2626] mt-1">{devices.filter(d => !isOnline(d)).length}</p>
        </div>
        <div className="bg-surface-card border border-border rounded-lg p-4">
          <span className="text-[9px] font-bold uppercase tracking-wider text-text-faint">Inactive</span>
          <p className="text-2xl font-black text-text-muted mt-1">{devices.filter(d => !d.is_active).length}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
        <input
          type="text"
          placeholder="Search by device code, label, or location..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-surface-alt border border-border rounded-md pl-10 pr-4 py-2.5 text-sm text-text placeholder-text-faint focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
        />
      </div>

      {/* Device List */}
      <div className="flex flex-col gap-3">
        {loading ? (
          <div className="p-6 bg-surface-card border border-border rounded-lg">
            <CardListSkeleton count={4} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-surface-card border border-border rounded-lg p-8 text-center">
            <Cpu className="w-12 h-12 mx-auto mb-3 text-border" />
            <p className="font-medium text-text-muted">No devices found.</p>
          </div>
        ) : filtered.map(device => (
          <div key={device.id} className="bg-surface-card border border-border rounded-lg overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
            {/* Device Row */}
            <button
              onClick={() => toggleExpand(device.id)}
              className="w-full flex items-center justify-between p-5 hover:bg-surface-alt/50 transition-colors text-left"
            >
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isOnline(device) ? 'bg-[#E0F2FE] text-[#00799C]' : 'bg-[#FEE2E2] text-[#DC2626]'}`}>
                  {isOnline(device) ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
                </div>
                <div>
                  <p className="font-bold text-text-heading text-sm">{device.device_code}</p>
                  <p className="text-[10px] text-text-faint">{device.label}</p>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="hidden md:flex items-center gap-1.5 text-xs text-text-body">
                  <MapPin className="w-3.5 h-3.5 text-text-faint" />
                  <span className="max-w-[200px] truncate">{device.location_desc}</span>
                </div>
                <div className="hidden md:flex items-center gap-1.5 text-xs text-text-body">
                  <Clock className="w-3.5 h-3.5 text-text-faint" />
                  <span>{device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : 'Never'}</span>
                </div>
                <span className={`text-[9px] font-bold px-2 py-1 rounded uppercase ${isOnline(device) ? 'bg-[#E0F2FE] text-[#00799C]' : 'bg-[#FEE2E2] text-[#DC2626]'}`}>
                  {isOnline(device) ? 'ONLINE' : 'OFFLINE'}
                </span>
                {expandedId === device.id ? <ChevronUp className="w-4 h-4 text-text-faint" /> : <ChevronDown className="w-4 h-4 text-text-faint" />}
              </div>
            </button>

            {/* Expanded Detail */}
            {expandedId === device.id && (
              <div className="border-t border-border bg-surface-alt p-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-text-faint block">Location</span>
                    <span className="text-sm font-bold text-text-heading">{device.location_desc}</span>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-text-faint block">Temp Threshold</span>
                    <span className="text-sm font-bold text-text-heading flex items-center gap-1">
                      <Thermometer className="w-3.5 h-3.5 text-[#DC2626]" />{device.temp_threshold}°C
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-text-faint block">Smoke Threshold</span>
                    <span className="text-sm font-bold text-text-heading flex items-center gap-1">
                      <Wind className="w-3.5 h-3.5 text-[#DC2626]" />{device.co_threshold} PPM
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-text-faint block">BFP Contact</span>
                    <span className="text-sm font-bold text-text-heading">{device.bfp_contact || 'Not set'}</span>
                  </div>
                </div>

                {loadingReading ? (
                  <p className="text-xs text-text-faint">Loading latest reading...</p>
                ) : expandedReading ? (
                  <div className="bg-surface-card border border-border rounded-md p-4">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-text-faint block mb-2">Latest Sensor Reading</span>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                      <div><span className="text-text-faint">Temp:</span> <strong>{expandedReading.temp_celsius.toFixed(1)}°C</strong></div>
                      <div><span className="text-text-faint">CO/Smoke:</span> <strong>{expandedReading.co_ppm.toFixed(0)} PPM</strong></div>
                      <div><span className="text-text-faint">GPS:</span> <strong>{expandedReading.gps_valid ? 'Fixed' : 'N/A'}</strong></div>
                      <div><span className="text-text-faint">Power:</span> <strong>{expandedReading.on_battery ? 'Battery' : 'Mains'}</strong></div>
                      <div><span className="text-text-faint">At:</span> <strong>{new Date(expandedReading.recorded_at).toLocaleString()}</strong></div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-text-faint">No sensor readings available for this device.</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

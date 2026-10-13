import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { DEVICE_COLUMNS } from '../../lib/deviceColumns';
import { LoadErrorBanner } from '../../components/LoadErrorBanner';
import type { LoadErrorInfo } from '../../components/LoadErrorBanner';
import type { AlertEvent } from '../../lib/supabase';
import { Search, Activity, Layers } from 'lucide-react';
import { getDeviceStatus } from '../../lib/deviceStatus';
import { useNowTick } from '../../hooks/useNowTick';
import { formatAge } from '../../lib/location';
import { DeviceMap, MapLegend } from '../../components/DeviceMap';
import { MAP_READING_COLUMNS, toMapDevices, formatTemp } from '../../lib/mapDevices';
import type { DeviceWithReadings } from '../../lib/mapDevices';

export const InteractiveMap = () => {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<DeviceWithReadings[]>([]);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [loadError, setLoadError] = useState<LoadErrorInfo | null>(null);
  const now = useNowTick();

  // Controls
  const [hideOffline, setHideOffline] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'fires' | 'warnings'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  // selectedDeviceId is a one-shot request for the map to fly to a device
  // (cleared once handled); selectedAlertId is the feed card the user picked
  // and stays highlighted. Highlighting off selectedDeviceId made the ring
  // flash on and off within ~600ms, and on every card for that device.
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);

  // ?device=<id> (from the header search's "Show on map") focuses that
  // device once the devices have loaded.
  const [searchParams, setSearchParams] = useSearchParams();
  const focusParam = searchParams.get('device');
  useEffect(() => {
    if (!focusParam || devices.length === 0) return;
    setHideOffline(false);
    setSearchQuery('');
    setSelectedDeviceId(focusParam);
    const next = new URLSearchParams(searchParams);
    next.delete('device');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusParam, devices.length]);

  useEffect(() => {
    fetchData();

    const deviceSub = supabase.channel('map_devices')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, fetchData)
      .subscribe();

    const alertSub = supabase.channel('map_alerts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alert_events' }, fetchData)
      .subscribe();

    return () => {
      supabase.removeChannel(deviceSub);
      supabase.removeChannel(alertSub);
    };
  }, []);

  const fetchData = async () => {
    try {
      // Fetch devices (with their latest reading) and recent alerts for the feed (limit 50)
      const [devicesRes, alertsRes] = await Promise.all([
        supabase.from('devices').select<string, DeviceWithReadings>(`${DEVICE_COLUMNS}, sensor_readings(${MAP_READING_COLUMNS})`)
          .order('recorded_at', { foreignTable: 'sensor_readings', ascending: false })
          .limit(1, { foreignTable: 'sensor_readings' }),
        supabase.from('alert_events').select('*, devices(device_code, location_desc)').order('triggered_at', { ascending: false }).limit(50)
      ]);

      // A failed read must be visible, not look like a map with no devices.
      const readError = devicesRes.error ?? alertsRes.error;
      setLoadError(readError ? { message: readError.message, code: readError.code } : null);

      // Keep the raw readings; each device's location is resolved at render time (toMapDevices) so a
      // fix older than 15 minutes stops being shown as live without needing new data.
      if (devicesRes.data) setDevices(devicesRes.data);
      if (alertsRes.data) setAlerts(alertsRes.data as unknown as AlertEvent[]);
    } catch (error) {
      console.error('Error fetching map data', error);
    }
  };

  const activeAlerts = alerts.filter(a => !a.resolved_at);

  const mapDevices = toMapDevices(devices, now);
  const devicesWithoutLocation = mapDevices.filter(d => d.location.kind === 'unavailable');

  // Filter devices to display
  const displayedDevices = mapDevices.filter(d => {
    const status = getDeviceStatus(d, activeAlerts, now);
    if (hideOffline && status === 'offline') return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const haystack = [d.device_code, d.label, d.location_desc].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // Filter feed alerts. Tier 2 = dual-sensor confirmed fire; Tier 1 =
  // single-sensor warning (spec SW-2.3.1). Tier 1 was previously labeled
  // "Fault / Sensor Calibration Error", which it is not.
  const feedAlerts = alerts.filter(a => {
    if (filterType === 'fires') return a.alert_tier === 2;
    if (filterType === 'warnings') return a.alert_tier === 1;
    return true;
  });

  // Clicking a feed card locates that device on the map: clear filters that
  // could be hiding its marker (offline toggle, stale search text), then
  // hand off to the map to fly to it and open its popup.
  const handleFeedCardClick = (alertId: string, deviceId: string | null | undefined) => {
    if (!deviceId) return;
    setSelectedAlertId(alertId);
    setHideOffline(false);
    setSearchQuery('');
    setSelectedDeviceId(deviceId);
  };

  return (
    // Phones: map on top, feed below (page scrolls). md+: map fills, feed docked right.
    <div className="flex flex-col md:flex-row w-full md:h-full relative md:overflow-hidden bg-[#E5E2E1]" style={{ isolation: 'isolate' }}>
      {loadError && (
        <div className="absolute left-1/2 top-4 z-[1100] w-[min(92%,640px)] -translate-x-1/2">
          <LoadErrorBanner what="devices and alerts" error={loadError} onRetry={fetchData} />
        </div>
      )}
      {devicesWithoutLocation.length > 0 && (
        <div role="status" className="absolute top-20 md:top-auto md:bottom-20 left-1/2 z-[1100] w-[min(92%,640px)] -translate-x-1/2 rounded-md border border-amber-300 bg-amber-50/95 px-3 py-2 text-xs text-amber-900">
          <strong>Location unavailable for {devicesWithoutLocation.length} device{devicesWithoutLocation.length > 1 ? 's' : ''}</strong> (not shown on the map): {devicesWithoutLocation.map(d => d.device_code).join(', ')}
        </div>
      )}
      {/* ─── MAP LAYER ─── */}
      <div className="h-[65vh] min-h-[360px] md:h-full md:min-h-0 md:flex-1 relative" style={{ zIndex: 0 }}>
        <DeviceMap
          devices={displayedDevices}
          activeAlerts={activeAlerts}
          now={now}
          onViewDetails={(d) => navigate(`/admin/alerts?q=${encodeURIComponent(d.device_code)}&device=${d.id}`)}
          selectedDeviceId={selectedDeviceId}
          onSelectionHandled={() => setSelectedDeviceId(null)}
        >
          {/* ─── FLOATING OVERLAYS (TOP) ─── */}
          <div className="absolute top-3 left-3 right-3 sm:top-6 sm:left-6 sm:right-6 flex justify-between pointer-events-none" style={{ zIndex: 1000 }}>
            <div className="flex flex-wrap gap-2 sm:gap-3 pointer-events-auto w-full sm:w-auto">
              {/* Search */}
              <div className="bg-white/80 backdrop-blur-md border border-white/40 shadow-sm rounded-lg flex items-center h-[42px] px-3 flex-1 min-w-0 sm:flex-none">
                <Search className="w-4 h-4 text-[#A1A1AA] mr-2" />
                <input
                  type="text"
                  placeholder="Search device ID or location..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent border-none outline-none text-sm w-full sm:w-56 min-w-0 text-[#3F3F46] placeholder:text-[#A1A1AA]"
                />
              </div>

              {/* Toggles */}
              <div className="bg-white/80 backdrop-blur-md border border-white/40 shadow-sm rounded-lg flex items-center h-[42px] overflow-hidden p-1">
                <button
                  onClick={() => setHideOffline(!hideOffline)}
                  aria-pressed={hideOffline}
                  className={`px-4 h-full rounded text-xs font-bold uppercase transition-colors ${hideOffline ? 'bg-primary text-white' : 'text-[#AF101A] hover:bg-primary-dark/10'}`}
                >
                  Hide Offline
                </button>
              </div>
            </div>
          </div>

          {/* ─── LEGEND OVERLAY (BOTTOM LEFT) ─── */}
          <div className="absolute bottom-3 left-3 right-14 sm:bottom-6 sm:left-6 sm:right-auto pointer-events-auto" style={{ zIndex: 1000 }}>
            <MapLegend />
          </div>
        </DeviceMap>
      </div>

      {/* ─── RIGHT PANEL: LIVE ALERT FEED ─── */}
      <div className="w-full md:w-[320px] md:shrink-0 bg-white/70 backdrop-blur-md border-t md:border-t-0 md:border-l border-white/50 shadow-2xl flex flex-col relative md:h-full" style={{ zIndex: 1 }}>
        <div className="p-4 md:p-6 pb-4 flex flex-col gap-4 md:gap-6 shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-[#18181B] font-extrabold text-sm uppercase tracking-widest">Live Alert Feed</h2>
            {/* Red only when something is actually active */}
            <div className={`px-2 py-0.5 rounded-full ${activeAlerts.length > 0 ? 'bg-[#FEE2E2]' : 'bg-[#F4F4F5]'}`}>
              <span className={`font-extrabold text-[10px] ${activeAlerts.length > 0 ? 'text-[#B91C1C]' : 'text-[#52525B]'}`}>
                {activeAlerts.length} Active
              </span>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-2">
            <FilterBtn label="All" active={filterType === 'all'} onClick={() => setFilterType('all')} />
            <FilterBtn label="Fires" active={filterType === 'fires'} onClick={() => setFilterType('fires')} />
            <FilterBtn label="Warnings" active={filterType === 'warnings'} onClick={() => setFilterType('warnings')} />
          </div>
        </div>

        {/* Feed List */}
        <div className="md:flex-1 md:overflow-y-auto px-4 md:px-6 pb-6 flex flex-col gap-3 md:gap-4">
          {feedAlerts.map(alert => {
            const isResolved = !!alert.resolved_at;
            const isFire = alert.alert_tier === 2;
            const deviceLabel = alert.devices?.device_code || 'Unknown';
            const locLabel = alert.devices?.location_desc || 'Unknown Location';

            // Base styles based on type/state
            let bgClass = isFire ? 'bg-[#FEF2F2]' : 'bg-[#FFFBEB]';
            let borderClass = isFire ? 'border-l-4 border-[#DC2626]' : 'border-l-4 border-[#F59E0B]';
            let iconClass = isFire ? 'text-[#DC2626]' : 'text-[#D97706]';
            let titleClass = isFire ? 'text-[#B91C1C]' : 'text-[#B45309]';
            let title = isFire ? 'Fire Alert · Tier 2' : 'Warning · Tier 1';

            if (isResolved) {
              bgClass = 'bg-white/60';
              borderClass = 'border border-gray-200';
              iconClass = 'text-[#71717A]';
              titleClass = 'text-[#52525B]';
              title = `Resolved · ${isFire ? 'Fire' : 'Warning'}`;
            }

            const eventAt = isResolved ? (alert.resolved_at as string) : alert.triggered_at;
            const deviceId = alert.device_id;
            const isSelected = selectedAlertId === alert.id;

            return (
              <div
                key={alert.id}
                role="button"
                tabIndex={0}
                onClick={() => handleFeedCardClick(alert.id, deviceId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleFeedCardClick(alert.id, deviceId);
                  }
                }}
                className={`${bgClass} ${borderClass} rounded-lg p-4 shadow-sm relative transition-shadow cursor-pointer hover:shadow-md ${isSelected ? 'ring-2 ring-[#00799C]' : ''}`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <Activity className={`w-3 h-3 ${iconClass}`} />
                    <span className={`font-extrabold text-xs uppercase ${titleClass}`}>{title}</span>
                  </div>
                  <span className="text-[9px] font-bold text-[#71717A]" title={new Date(eventAt).toLocaleString()}>
                    {formatAge(eventAt, now)}
                  </span>
                </div>
                <h4 className="font-bold text-sm text-[#18181B] mb-0.5">{deviceLabel}</h4>
                <p className="text-xs text-[#71717A] mb-2 truncate" title={locLabel}>{locLabel}</p>
                <span className={`text-[10px] font-bold uppercase tracking-widest ${iconClass}`}>
                  CO {alert.co_ppm} ppm · {formatTemp(alert.temp_celsius)} at trigger
                </span>
              </div>
            );
          })}

          {feedAlerts.length === 0 && (
            <div className="text-center py-8 text-[#A1A1AA] text-xs font-bold uppercase">
              No alerts found
            </div>
          )}

          {feedAlerts.length > 0 && (
            <div className="py-4 flex justify-center border-t border-dashed border-gray-300 mt-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#A1A1AA]">End of Recent Feed</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 md:p-6 bg-white/30 border-t border-white/50 shrink-0">
          <button
            onClick={() => navigate('/admin/logs')}
            className="w-full bg-[#18181B] text-white py-3 rounded text-xs font-extrabold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-black transition-colors"
          >
            <Layers className="w-4 h-4" />
            View Full Log
          </button>
        </div>
      </div>
    </div>
  );
};

const FilterBtn = ({ label, active, onClick }: { label: string, active: boolean, onClick: () => void }) => (
  <button
    onClick={onClick}
    aria-pressed={active}
    className={`px-3 py-2 rounded text-[10px] font-extrabold uppercase tracking-widest transition-colors ${active ? 'bg-[#18181B] text-white' : 'text-[#71717A] hover:bg-gray-100'}`}
  >
    {label}
  </button>
);

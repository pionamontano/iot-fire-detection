import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { DEVICE_COLUMNS } from '../../lib/deviceColumns';
import { LoadErrorBanner } from '../../components/LoadErrorBanner';
import type { LoadErrorInfo } from '../../components/LoadErrorBanner';
import type { AlertEvent } from '../../lib/supabase';
import { Activity, Layers, MapPinOff, X } from 'lucide-react';
import { getDeviceStatus } from '../../lib/deviceStatus';
import { useNowTick } from '../../hooks/useNowTick';
import { alertTitle, alertActor, alertEventAt, formatEventTime } from '../../lib/alertText';
import { DeviceMap, MapLegend } from '../../components/DeviceMap';
import { MAP_READING_COLUMNS, toMapDevices, formatTemp, countByStatus } from '../../lib/mapDevices';
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
  // Short-lived message over the map, e.g. when a feed card's device has no
  // position to fly to (otherwise the click looks like it did nothing).
  const mapAreaRef = useRef<HTMLDivElement>(null);
  const [mapNotice, setMapNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!mapNotice) return;
    const id = setTimeout(() => setMapNotice(null), 6000);
    return () => clearTimeout(id);
  }, [mapNotice]);
  // selectedDeviceId is a one-shot request for the map to fly to a device
  // (cleared once handled); selectedAlertId is the feed card the user picked
  // and stays highlighted. Highlighting off selectedDeviceId made the ring
  // flash on and off within ~600ms, and on every card for that device.
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);

  // ?device=<id> (header search "Show on map", Dashboard rows and activity)
  // focuses that device once the devices have loaded.
  const [searchParams, setSearchParams] = useSearchParams();
  const focusParam = searchParams.get('device');
  useEffect(() => {
    if (!focusParam || devices.length === 0) return;
    setHideOffline(false);
    const target = toMapDevices(devices, Date.now()).find(d => d.id === focusParam);
    if (target?.location.kind === 'unavailable') {
      setMapNotice(`${target.device_code} has no known location yet, so it can't be shown on the map.`);
    } else {
      setSelectedDeviceId(focusParam);
    }
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
    return !(hideOffline && status === 'offline');
  });
  const locatedDevices = mapDevices.filter(d => d.location.kind !== 'unavailable');
  const shownCount = displayedDevices.filter(d => d.location.kind !== 'unavailable').length;
  const legendCounts = countByStatus(mapDevices, activeAlerts, now);
  const offlineCount = legendCounts.offline ?? 0;

  // Filter feed alerts. Tier 2 = dual-sensor confirmed fire; Tier 1 =
  // single-sensor warning (spec SW-2.3.1). Tier 1 was previously labeled
  // "Fault / Sensor Calibration Error", which it is not.
  const feedAlerts = alerts.filter(a => {
    if (filterType === 'fires') return a.alert_tier === 2;
    if (filterType === 'warnings') return a.alert_tier === 1;
    return true;
  });

  // Clicking a feed card locates that device on the map: clear the offline
  // filter that could be hiding its marker, then hand off to the map to fly
  // to it and open its popup. No position → say so instead of doing nothing.
  const handleFeedCardClick = (alert: AlertEvent) => {
    setSelectedAlertId(alert.id);
    // Phones stack the feed under the map; bring the map back into view so
    // the result of the click (fly-to or notice) is actually visible.
    const mapTop = mapAreaRef.current?.getBoundingClientRect().top;
    if (mapTop != null && mapTop < 0) mapAreaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const device = mapDevices.find(d => d.id === alert.device_id);
    if (!device) {
      setMapNotice('This alert\'s device is no longer registered, so it can\'t be shown on the map.');
      return;
    }
    if (device.location.kind === 'unavailable') {
      setMapNotice(`${device.device_code} has no known location yet, so it can't be shown on the map.`);
      return;
    }
    setMapNotice(null);
    setHideOffline(false);
    setSelectedDeviceId(device.id);
  };

  return (
    // Phones: map on top, feed below (page scrolls). md+: map fills, feed docked right.
    <div className="flex flex-col md:flex-row w-full md:h-full relative md:overflow-hidden bg-[#E5E2E1]" style={{ isolation: 'isolate' }}>
      {loadError && (
        <div className="absolute left-1/2 top-4 z-[1100] w-[min(92%,640px)] -translate-x-1/2">
          <LoadErrorBanner what="devices and alerts" error={loadError} onRetry={fetchData} />
        </div>
      )}
      {/* ─── MAP LAYER ─── */}
      <div ref={mapAreaRef} className="h-[65vh] min-h-[360px] md:h-full md:min-h-0 md:flex-1 relative" style={{ zIndex: 0 }}>
        <DeviceMap
          devices={displayedDevices}
          activeAlerts={activeAlerts}
          now={now}
          onViewDetails={(d) => navigate(`/admin/alerts?q=${encodeURIComponent(d.device_code)}&device=${d.id}`)}
          selectedDeviceId={selectedDeviceId}
          onSelectionHandled={() => setSelectedDeviceId(null)}
        >
          {/* ─── FLOATING OVERLAYS (TOP) ─── */}
          {/* Search lives in the header only; the map just has the offline filter. */}
          <div className="absolute top-3 left-3 right-3 sm:top-6 sm:left-6 sm:right-auto sm:max-w-[420px] flex flex-col items-start gap-2 pointer-events-none" style={{ zIndex: 1000 }}>
            {/* Offline devices: an explicit Show / Hide choice, so the current
                state is always readable (a lone "Hide Offline" button didn't
                say whether offline pins were currently on the map). */}
            <div className={`${OVERLAY_CARD} flex flex-wrap items-center gap-x-2 gap-y-1 p-1 pl-3 pointer-events-auto`}>
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#52525B] whitespace-nowrap">
                Offline devices ({offlineCount})
              </span>
              <div role="group" aria-label="Offline devices" className="flex items-center h-8 rounded bg-[#F4F4F5] p-0.5">
                <OverlayToggle label="Show" active={!hideOffline} onClick={() => setHideOffline(false)} />
                <OverlayToggle label="Hide" active={hideOffline} onClick={() => setHideOffline(true)} />
              </div>
            </div>

            {hideOffline && (
              <div role="status" className={`${OVERLAY_CARD} flex items-center gap-2 pl-3 pr-1 py-1 text-xs text-[#52525B] pointer-events-auto`}>
                <span className="flex-1">
                  {shownCount === 0
                    ? <><strong className="text-[#18181B]">All {locatedDevices.length} devices are offline</strong>, so no pins are shown.</>
                    : <>Showing <strong className="text-[#18181B]">{shownCount} of {locatedDevices.length}</strong> devices · {offlineCount} offline hidden</>}
                </span>
                <button
                  onClick={() => setHideOffline(false)}
                  className="h-7 px-2 flex items-center gap-1 rounded text-[10px] font-extrabold uppercase tracking-widest text-[#18181B] hover:bg-gray-100 transition-colors"
                >
                  <X className="w-3.5 h-3.5" /> Show all
                </button>
              </div>
            )}

            {mapNotice && (
              <div role="status" className={`${OVERLAY_CARD} flex items-start gap-2 px-3 py-2 text-xs text-[#18181B] pointer-events-auto`}>
                <MapPinOff className="w-4 h-4 shrink-0 text-[#B45309]" />
                <span className="flex-1">{mapNotice}</span>
                <button onClick={() => setMapNotice(null)} aria-label="Dismiss" className="text-[#71717A] hover:text-[#18181B] transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {devicesWithoutLocation.length > 0 && (
              <div role="status" className={`${OVERLAY_CARD} flex items-start gap-2 px-3 py-2 text-xs text-[#52525B] pointer-events-auto`}>
                <MapPinOff className="w-4 h-4 shrink-0 text-[#B45309]" />
                <span>
                  <strong className="text-[#18181B]">No location for {devicesWithoutLocation.map(d => d.device_code).join(', ')}</strong> — not shown on the map.
                </span>
              </div>
            )}
          </div>

          {/* ─── LEGEND OVERLAY (BOTTOM LEFT) ─── */}
          <div className="absolute bottom-3 left-3 right-14 sm:bottom-6 sm:left-6 sm:right-auto pointer-events-auto" style={{ zIndex: 1000 }}>
            <MapLegend counts={legendCounts} />
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

            if (isResolved) {
              bgClass = 'bg-white/60';
              borderClass = 'border border-gray-200';
              iconClass = 'text-[#71717A]';
              titleClass = 'text-[#52525B]';
            }

            const eventAt = alertEventAt(alert);
            const isSelected = selectedAlertId === alert.id;

            return (
              <div
                key={alert.id}
                role="button"
                tabIndex={0}
                onClick={() => handleFeedCardClick(alert)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleFeedCardClick(alert);
                  }
                }}
                className={`${bgClass} ${borderClass} rounded-lg p-4 shadow-sm relative transition-shadow cursor-pointer hover:shadow-md ${isSelected ? 'ring-2 ring-inset ring-[#18181B]' : ''}`}
              >
                {/* Same title, readings and time line as the Dashboard's Recent Activity. */}
                <div className="flex items-center gap-2 mb-2">
                  <Activity className={`w-3 h-3 shrink-0 ${iconClass}`} />
                  <span className={`font-extrabold text-[13px] ${titleClass}`}>{alertTitle(alert)}</span>
                </div>
                <h4 className="font-bold text-sm text-[#18181B] mb-0.5">{deviceLabel}</h4>
                <p className="text-xs text-[#71717A] mb-2 truncate" title={locLabel}>{locLabel}</p>
                <p className="text-xs text-[#52525B]">
                  CO {alert.co_ppm} ppm · {formatTemp(alert.temp_celsius)} at trigger
                </p>
                <p className="text-[11px] font-medium text-[#71717A] mt-1" title={new Date(eventAt).toLocaleString()}>
                  {formatEventTime(eventAt, now)} · {alertActor(alert)}
                </p>
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

// Shared look for everything floating over the map (toolbar, notices, legend).
const OVERLAY_CARD = 'bg-white/80 backdrop-blur-md border border-white/40 shadow-sm rounded-lg';

// Same active (black) style as the feed's FilterBtn so all toggles on the
// page read as one control family.
const OverlayToggle = ({ label, active, onClick }: { label: string, active: boolean, onClick: () => void }) => (
  <button
    onClick={onClick}
    aria-pressed={active}
    className={`px-3 h-full min-w-[52px] rounded text-[10px] font-extrabold uppercase tracking-widest transition-colors ${active ? 'bg-[#18181B] text-white shadow-sm' : 'text-[#52525B] hover:bg-white hover:text-[#18181B]'}`}
  >
    {label}
  </button>
);

const FilterBtn = ({ label, active, onClick }: { label: string, active: boolean, onClick: () => void }) => (
  <button
    onClick={onClick}
    aria-pressed={active}
    className={`px-3 py-2 rounded text-[10px] font-extrabold uppercase tracking-widest transition-colors ${active ? 'bg-[#18181B] text-white' : 'text-[#71717A] hover:bg-gray-100'}`}
  >
    {label}
  </button>
);

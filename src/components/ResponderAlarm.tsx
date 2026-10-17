import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { supabase, realtimeChannel } from '../lib/supabase';
import { isAlarmSoundBlocked, prepareAlarmSound, startSiren, stopSiren, subscribeAlarmSound, unlockAlarmSound } from '../lib/alarmSound';
import { BTN_SECONDARY } from './ui';

// Safety net for a missed realtime event: the siren must not stay silent (or keep sounding) until the next one.
const POLL_MS = 30_000;

// The BFP fire alarm, on every responder page (it sits in ResponderLayout, not on the dashboard, so it keeps
// sounding when the responder opens Alert Logs or Settings). It sounds while any fire (Tier 2) is still
// unacknowledged and cannot be muted: acknowledging the fire is the only way to silence it, so a responder cannot
// switch it off by accident and then miss the next fire.
export const ResponderAlarm = () => {
  const [unacknowledged, setUnacknowledged] = useState(0);
  const blocked = useSyncExternalStore(subscribeAlarmSound, isAlarmSoundBlocked);

  const fetchUnacknowledged = useCallback(async () => {
    const { data, error } = await supabase.from('alert_events')
      .select('id, incident_status')
      .eq('alert_tier', 2)
      .is('resolved_at', null);
    if (error || !data) return;
    setUnacknowledged(data.filter(a => !a.incident_status || a.incident_status === 'active').length);
  }, []);

  useEffect(() => {
    prepareAlarmSound();
    fetchUnacknowledged();
    const sub = realtimeChannel('resp_alarm')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alert_events' }, fetchUnacknowledged)
      .subscribe();
    const poll = setInterval(fetchUnacknowledged, POLL_MS);
    return () => {
      clearInterval(poll);
      supabase.removeChannel(sub);
    };
  }, [fetchUnacknowledged]);

  useEffect(() => {
    if (unacknowledged > 0) startSiren();
    else stopSiren();
  }, [unacknowledged]);
  // Signing out leaves the responder pages: silence it.
  useEffect(() => stopSiren, []);

  // The browser blocks page audio until the user interacts with the page (after a reload): say so before a fire is missed.
  if (!blocked) return null;
  return (
    <div
      role="alert"
      className={`mb-6 flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg border ${unacknowledged > 0
        ? 'border-tier2-border/40 bg-tier2-bg text-tier2-text'
        : 'border-tier1-border/40 bg-tier1-bg text-tier1-text'}`}
    >
      <VolumeX className="w-5 h-5 shrink-0" />
      <div className="text-sm flex-1 min-w-0">
        <p className="font-bold">
          {unacknowledged > 0 ? 'A fire alarm is sounding, but the browser has blocked the sound.' : 'The browser is blocking the alarm sound.'}
        </p>
        <p className="mt-0.5">Tap or click anywhere to allow it. Until then a new fire will not be heard.</p>
      </div>
      <button type="button" onClick={unlockAlarmSound} className={`${BTN_SECONDARY} shrink-0`}>
        <Volume2 className="w-4 h-4" /> Enable alarm sound
      </button>
    </div>
  );
};

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Role } from '../lib/supabase';
import { DEFAULT_TIMEOUT_MINUTES, TIMEOUT_SETTING_KEY, resolveTimeoutMinutes } from '../lib/sessionTimeouts';

// Spec SW-2.6.1: client-tracked last-interaction timestamp, role-specific
// admin-configurable durations (settings table), sign out + redirect to
// /session-expired on expiry. Previously the config UI (Settings.tsx) and
// the target screen (SessionExpired.tsx) both existed but nothing wired
// them to real session enforcement — this hook is that wiring. With no
// saved value the role's default applies (lib/sessionTimeouts.ts).

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const;
const IDLE_CHECK_INTERVAL_MS = 15_000;
const SETTINGS_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export const useIdleTimeout = (role: Role | null | undefined, enabled: boolean) => {
  const navigate = useNavigate();
  const lastActivityRef = useRef(Date.now());
  const timeoutMinutesRef = useRef<number>(DEFAULT_TIMEOUT_MINUTES.resident);

  useEffect(() => {
    if (!enabled || !role) return;

    let cancelled = false;
    lastActivityRef.current = Date.now();
    timeoutMinutesRef.current = DEFAULT_TIMEOUT_MINUTES[role];

    const loadTimeoutMinutes = async () => {
      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', TIMEOUT_SETTING_KEY[role])
        .maybeSingle();
      // A failed read keeps the current value (the default until one loads).
      if (cancelled || error) return;
      timeoutMinutesRef.current = resolveTimeoutMinutes(data?.value, role);
    };
    loadTimeoutMinutes();
    const settingsInterval = setInterval(loadTimeoutMinutes, SETTINGS_REFRESH_INTERVAL_MS);

    const markActive = () => {
      lastActivityRef.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, markActive, { passive: true }));

    const idleCheckInterval = setInterval(async () => {
      const timeoutMinutes = timeoutMinutesRef.current;
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= timeoutMinutes * 60 * 1000) {
        // Navigate before signing out: AuthGuard re-renders as soon as
        // signOut() clears the session, and its own "no session -> /login"
        // redirect would otherwise win the race and override this one,
        // landing the user on a bare /login with no explanation.
        navigate('/session-expired', { replace: true });
        await supabase.auth.signOut();
      }
    }, IDLE_CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(settingsInterval);
      clearInterval(idleCheckInterval);
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, markActive));
    };
  }, [role, enabled, navigate]);
};

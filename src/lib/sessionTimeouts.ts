import type { Role } from './supabase';

// Per-role idle timeouts (spec SW-2.6.1). Admins set them on the Settings
// page; until a value is saved, or if a saved one is unusable, the default
// below applies. One source for both the Settings page and useIdleTimeout,
// so the page never shows a timeout that isn't being enforced (spec KI-30).

export const TIMEOUT_SETTING_KEY: Record<Role, string> = {
  admin: 'timeout_admin',
  bfp_responder: 'timeout_bfp',
  resident: 'timeout_resident',
};

export const DEFAULT_TIMEOUT_MINUTES: Record<Role, number> = {
  admin: 15,
  bfp_responder: 15,
  resident: 60,
};

export const MIN_TIMEOUT_MINUTES = 1;
export const MAX_TIMEOUT_MINUTES = 1440;

// Minutes to enforce for a stored `settings.value` (string, or null when the row is missing).
export const resolveTimeoutMinutes = (stored: string | null | undefined, role: Role): number => {
  const minutes = stored != null && /^\s*\d+\s*$/.test(stored) ? Number(stored) : NaN;
  return minutes >= MIN_TIMEOUT_MINUTES && minutes <= MAX_TIMEOUT_MINUTES
    ? minutes
    : DEFAULT_TIMEOUT_MINUTES[role];
};

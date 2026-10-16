// The disposable accounts and devices global setup creates. Everything lives under the
// e2e.agapsense.test domain / E2E- device prefix so setup can wipe it before every run.
// Mirrors Role in src/lib/supabase.ts (not imported: that module needs Vite's import.meta.env).
type Role = 'admin' | 'bfp_responder' | 'resident';

export const EMAIL_DOMAIN = 'e2e.agapsense.test';
export const DEVICE_PREFIX = 'E2E-';
export const PASSWORD = 'E2e-pass-123!';

/** Idle timeout global setup configures for every role (minutes). */
export const IDLE_TIMEOUT_MINUTES = 60;

/** A settings row (value 'initial') that only the settings write-access test touches. */
export const SETTINGS_PROBE_KEY = 'e2e_probe';

export interface Account {
  email: string;
  fullName: string;
  role: Role;
  status?: 'approved' | 'pending' | 'rejected';
  setupComplete?: boolean;
  isActive?: boolean;
  /** device_code of the device linked to this resident. */
  device?: string;
}

const acct = (local: string, a: Omit<Account, 'email'>): Account => ({ email: `${local}@${EMAIL_DOMAIN}`, ...a });

export const DEVICES = {
  resident: { device_code: `${DEVICE_PREFIX}RES-1`, label: 'E2E resident device', co_threshold: 50, temp_threshold: 57 },
  otherResident: { device_code: `${DEVICE_PREFIX}RES-2`, label: 'E2E other resident device', co_threshold: 45, temp_threshold: 55, bfp_contact: '09221234567' },
  inactive: { device_code: `${DEVICE_PREFIX}INACTIVE`, label: 'E2E inactive device', co_threshold: 50, temp_threshold: 57, is_active: false },
  /** Unlinked; only the trigger-alert tests raise incidents on it. */
  alerting: { device_code: `${DEVICE_PREFIX}ALERT`, label: 'E2E alerting device', co_threshold: 50, temp_threshold: 57 },
  /** Unlinked; only the ingest-reading tests post telemetry for it. */
  telemetry: { device_code: `${DEVICE_PREFIX}TELEMETRY`, label: 'E2E telemetry device', co_threshold: 50, temp_threshold: 57 },
  /** Unlinked; the admin key-regeneration test rotates its key. */
  rotating: { device_code: `${DEVICE_PREFIX}ROTATE`, label: 'E2E key rotation device', co_threshold: 50, temp_threshold: 57 },
} as const;

export const ACCOUNTS = {
  admin: acct('admin', { fullName: 'E2E Admin', role: 'admin', setupComplete: true }),
  responder: acct('responder', { fullName: 'E2E Responder', role: 'bfp_responder', setupComplete: true }),
  resident: acct('resident', { fullName: 'E2E Resident', role: 'resident', setupComplete: true, device: DEVICES.resident.device_code }),
  otherResident: acct('resident2', { fullName: 'E2E Other Resident', role: 'resident', setupComplete: true, device: DEVICES.otherResident.device_code }),
  newResident: acct('resident.new', { fullName: 'E2E New Resident', role: 'resident', setupComplete: false }),
  pending: acct('pending', { fullName: 'E2E Pending', role: 'resident', status: 'pending' }),
  rejected: acct('rejected', { fullName: 'E2E Rejected', role: 'resident', status: 'rejected' }),
  deactivated: acct('deactivated', { fullName: 'E2E Deactivated', role: 'resident', setupComplete: true, isActive: false }),
  // Accounts whose tests sign out or lock them, so no other test shares their sessions.
  logout: acct('logout', { fullName: 'E2E Logout', role: 'resident', setupComplete: true }),
  idle: acct('idle', { fullName: 'E2E Idle', role: 'resident', setupComplete: true }),
  idleReset: acct('idle.reset', { fullName: 'E2E Idle Reset', role: 'resident', setupComplete: true }),
  revocable: acct('revocable', { fullName: 'E2E Revocable', role: 'resident', setupComplete: true }),
  editable: acct('editable', { fullName: 'E2E Editable', role: 'resident', setupComplete: true }),
  lockTier1: acct('lock.tier1', { fullName: 'E2E Lock 1', role: 'resident', setupComplete: true }),
  lockTier3: acct('lock.tier3', { fullName: 'E2E Lock 3', role: 'resident', setupComplete: true }),
  lockTier3b: acct('lock.tier3b', { fullName: 'E2E Lock 3b', role: 'resident', setupComplete: true }),
  lockTier3c: acct('lock.tier3c', { fullName: 'E2E Lock 3c', role: 'resident', setupComplete: true }),
  lockTier2: acct('lock.tier2', { fullName: 'E2E Lock 2', role: 'resident', setupComplete: true }),
  lockApi: acct('lock.api', { fullName: 'E2E Lock API', role: 'resident', setupComplete: true }),
  lockOverride: acct('lock.override', { fullName: 'E2E Lock Override', role: 'resident', setupComplete: true }),
} satisfies Record<string, Account>;

export type AccountName = keyof typeof ACCOUNTS;

/** A fresh address for tests that register a brand-new account. */
export const freshEmail = (tag: string) => `${tag}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@${EMAIL_DOMAIN}`;

// Wipes everything a previous run created (users under EMAIL_DOMAIN, devices under DEVICE_PREFIX)
// and seeds the fixture accounts and devices from accounts.ts.
import { ACCOUNTS, DEVICES, DEVICE_PREFIX, EMAIL_DOMAIN, IDLE_TIMEOUT_MINUTES, PASSWORD, SETTINGS_PROBE_KEY } from './support/accounts.ts';
import { startAppServer } from './support/app-server.ts';
import { admin } from './support/supabase.ts';

type Result = { data?: unknown; error: { message: string } | null };

/** Throws on error; returns the (non-null) data of a read. */
const must = <R extends Result>(res: R, what: string): NonNullable<R['data']> => {
  if (res.error || res.data == null) throw new Error(`E2E setup: ${what}: ${res.error?.message ?? 'no data'}`);
  return res.data as NonNullable<R['data']>;
};

/** Throws on error; for writes, which return no data. */
const check = (res: Result, what: string) => {
  if (res.error) throw new Error(`E2E setup: ${what}: ${res.error.message}`);
};

async function wipe() {
  for (let page = 1; ; page++) {
    const { users } = must(await admin.auth.admin.listUsers({ page, perPage: 1000 }), 'list users');
    for (const u of users.filter((u) => u.email?.endsWith(`@${EMAIL_DOMAIN}`))) {
      check(await admin.auth.admin.deleteUser(u.id), `delete ${u.email}`); // profiles + registration_requests cascade
    }
    if (users.length < 1000) break;
  }
  const devices = must(await admin.from('devices').select('id').like('device_code', `${DEVICE_PREFIX}%`), 'list devices');
  const ids = devices.map((d) => d.id as string);
  if (ids.length) {
    const alerts = must(await admin.from('alert_events').select('id').in('device_id', ids), 'list alerts');
    if (alerts.length) check(await admin.from('alert_notifications').delete().in('alert_event_id', alerts.map((a) => a.id)), 'delete notifications');
    for (const table of ['alert_events', 'sensor_readings', 'address_discrepancies']) {
      check(await admin.from(table).delete().in('device_id', ids), `delete ${table}`);
    }
    check(await admin.from('devices').delete().in('id', ids), 'delete devices');
  }
  for (const table of ['login_attempts', 'login_lockout_overrides']) {
    check(await admin.from(table).delete().like('email', `%@${EMAIL_DOMAIN}`), `delete ${table}`);
  }
  check(await admin.from('settings').delete().like('key', 'e2e_forged_%'), 'delete forged settings');
}

async function seed() {
  const deviceIds: Record<string, string> = {};
  for (const d of Object.values(DEVICES)) {
    const row = must(await admin.from('devices').insert(d as Record<string, unknown>).select('id').single(), `insert ${d.device_code}`);
    deviceIds[d.device_code] = row.id;
  }

  for (const a of Object.values(ACCOUNTS)) {
    const { user } = must(await admin.auth.admin.createUser({ email: a.email, password: PASSWORD, email_confirm: true }), `create ${a.email}`);
    if (!user) throw new Error(`E2E setup: create ${a.email}: no user returned`);
    check(await admin.from('profiles').insert({
      id: user.id,
      full_name: a.fullName,
      role: a.role,
      status: a.status ?? 'approved',
      setup_complete: a.setupComplete ?? false,
      is_active: a.isActive ?? true,
      device_id: a.device ? deviceIds[a.device] : null,
      contact_number: '09171234567',
      address: a.role === 'resident' ? '1 E2E St, Brgy Test, Testing City, Test Province' : null,
    }), `profile ${a.email}`);
    if (a.role !== 'admin') {
      check(await admin.from('registration_requests').insert({
        user_id: user.id, email: a.email, requested_role: a.role, device_code: a.device ?? null,
        organization: a.role === 'bfp_responder' ? 'E2E Fire Station' : null,
      }), `registration ${a.email}`);
    }
  }

  // One reading and one resolved incident per resident device, for the row-scoping checks.
  for (const code of [DEVICES.resident.device_code, DEVICES.otherResident.device_code]) {
    const device_id = deviceIds[code];
    check(await admin.from('sensor_readings').insert({ device_id, co_ppm: 5, temp_celsius: 30 }), `reading ${code}`);
    check(await admin.from('alert_events').insert({
      device_id, alert_tier: 1, co_ppm: 60, temp_celsius: 30,
      incident_status: 'resolved', resolved_at: new Date().toISOString(), resolution_source: 'admin',
    }), `alert ${code}`);
  }

  // A realistic idle timeout for every role; the idle tests fast-forward the browser clock past it.
  check(await admin.from('settings').upsert([
    ...['timeout_admin', 'timeout_bfp', 'timeout_resident'].map((key) => ({ key, value: String(IDLE_TIMEOUT_MINUTES) })),
    { key: SETTINGS_PROBE_KEY, value: 'initial' },
  ]), 'settings');
}

export default async function globalSetup() {
  await wipe();
  await seed();
  // The UI project needs the built app; the returned function is Playwright's global teardown.
  return process.env.E2E_SERVE_APP === '1' ? startAppServer() : undefined;
}

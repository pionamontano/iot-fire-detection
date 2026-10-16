// testing/reports/ERROR_EDGE_CASE_TESTING.md: Edge Function boundary behaviour, called exactly as
// the firmware and the browser call them.
import { expect, test } from '@playwright/test';
import { ACCOUNTS, DEVICES, PASSWORD, freshEmail } from '../support/accounts.ts';
import {
  admin, anonClient, callFunction, clearLoginAttempts, clientAs, deviceByCode, profileByEmail, seedFailedAttempts,
} from '../support/supabase.ts';

const deviceKey = async (code: string) => ({ 'x-device-key': (await deviceByCode(code)).api_key });

test.describe('every function answers CORS preflight', () => {
  for (const fn of ['login', 'register', 'ingest-reading', 'trigger-alert', 'get-device-config', 'confirm-sms-status']) {
    test(fn, async () => {
      const res = await callFunction(fn, { method: 'OPTIONS' });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    });
  }
});

test.describe('device authentication (x-device-key)', () => {
  const body = { co_ppm: 5, temp_celsius: 30 };
  for (const fn of ['ingest-reading', 'trigger-alert', 'get-device-config', 'confirm-sms-status']) {
    test(`${fn}: missing, unknown and inactive-device keys are 401 JSON`, async () => {
      const missing = await callFunction(fn, { body });
      const unknown = await callFunction(fn, { body, headers: { 'x-device-key': 'sk_not_a_real_key' } });
      const inactive = await callFunction(fn, { body, headers: await deviceKey(DEVICES.inactive.device_code) });
      for (const r of [missing, unknown, inactive]) {
        expect(r.status).toBe(401);
        expect(r.json?.error).toEqual(expect.any(String));
      }
    });
  }
});

test.describe('ingest-reading', () => {
  test('malformed JSON is 400, not a crash', async () => {
    const r = await callFunction('ingest-reading', { rawBody: '{"co_ppm": 5,', headers: await deviceKey(DEVICES.telemetry.device_code) });
    expect(r.status).toBe(400);
    expect(r.json?.error).toBe('Invalid JSON payload');
  });

  const invalid: [string, string][] = [
    ['missing co_ppm', '{"temp_celsius": 30}'],
    ['null temp', '{"co_ppm": 5, "temp_celsius": null}'],
    ['string co_ppm', '{"co_ppm": "5", "temp_celsius": 30}'],
    ['Infinity (1e999)', '{"co_ppm": 1e999, "temp_celsius": 30}'],
  ];
  for (const [name, rawBody] of invalid) {
    test(`non-finite values are rejected: ${name}`, async () => {
      const r = await callFunction('ingest-reading', { rawBody, headers: await deviceKey(DEVICES.telemetry.device_code) });
      expect(r.status).toBe(400);
    });
  }

  test('valid reading is stored with defaults; (0,0) GPS means "no coordinates"', async () => {
    const device = await deviceByCode(DEVICES.telemetry.device_code);
    const r = await callFunction('ingest-reading', {
      body: { co_ppm: 4.5, temp_celsius: 29.5, latitude: 0, longitude: 0, unexpected_extra_field: 'ignored' },
      headers: { 'x-device-key': device.api_key },
    });
    expect(r.status).toBe(200);
    const { data } = await admin.from('sensor_readings').select('*').eq('device_id', device.id)
      .order('recorded_at', { ascending: false }).limit(1).single();
    expect(data).toMatchObject({ co_ppm: 4.5, temp_celsius: 29.5, latitude: null, longitude: null, gps_valid: false, on_battery: false, sensor_ready: true });
    const seen = await deviceByCode(DEVICES.telemetry.device_code) as unknown as { last_seen_at: string | null };
    expect(seen.last_seen_at).not.toBeNull();
  });
});

test.describe('get-device-config', () => {
  test("returns only the calling device's own configuration", async () => {
    const r = await callFunction('get-device-config', { headers: await deviceKey(DEVICES.otherResident.device_code) });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      co_alert_ppm: DEVICES.otherResident.co_threshold,
      temp_alert_c: DEVICES.otherResident.temp_threshold,
      bfp_number: DEVICES.otherResident.bfp_contact,
      owner_number: '09171234567',
    });
  });

  test('a device with no resident and no BFP contact gets empty strings, not null', async () => {
    const r = await callFunction('get-device-config', { headers: await deviceKey(DEVICES.alerting.device_code) });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ owner_number: '', bfp_number: '' });
  });
});

test.describe('trigger-alert', () => {
  test.describe.configure({ mode: 'serial' }); // one incident on E2E-ALERT, built up step by step

  const send = async (body: Record<string, unknown>) =>
    callFunction('trigger-alert', { body, headers: await deviceKey(DEVICES.alerting.device_code) });

  test('malformed JSON and non-numeric readings are 400', async () => {
    const headers = await deviceKey(DEVICES.alerting.device_code);
    expect((await callFunction('trigger-alert', { rawBody: 'not json', headers })).status).toBe(400);
    expect((await send({ co_ppm: '60', temp_celsius: 30 })).status).toBe(400);
  });

  test('readings below both thresholds are rejected (server decides the tier)', async () => {
    const r = await send({ co_ppm: 10, temp_celsius: 30, tier: 2 });
    expect(r.status).toBe(400);
    expect(r.json?.code).toBe('below_threshold');
  });

  test('gps_valid without coordinates is 400', async () => {
    expect((await send({ co_ppm: 60, temp_celsius: 30, gps_valid: true })).status).toBe(400);
  });

  let incidentId = '';

  test('first over-threshold reading opens a Tier 1 incident', async () => {
    const r = await send({ co_ppm: 60, temp_celsius: 30 });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ created: true, tier: 1 });
    incidentId = r.json!.alert_event_id as string;
  });

  test('repeat alert updates the same incident instead of duplicating it', async () => {
    const r = await send({ co_ppm: 65, temp_celsius: 31 });
    expect(r.json).toMatchObject({ alert_event_id: incidentId, created: false, tier: 1 });
  });

  test('legacy firmware field names (temperature_c, lat/lng) are accepted', async () => {
    const r = await send({ co_ppm: 66, temperature_c: 31, lat: 0, lng: 0 });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ alert_event_id: incidentId });
  });

  test('Tier 2 reading escalates the same incident', async () => {
    const r = await send({ co_ppm: 80, temp_celsius: 70 });
    expect(r.json).toMatchObject({ alert_event_id: incidentId, created: false, tier: 2 });
  });

  test('a later Tier 1 reading never downgrades it', async () => {
    const r = await send({ co_ppm: 60, temp_celsius: 30 });
    expect(r.json).toMatchObject({ alert_event_id: incidentId, tier: 2 });
    const device = await deviceByCode(DEVICES.alerting.device_code);
    const { data } = await admin.from('alert_events').select('id, alert_tier').eq('device_id', device.id).is('resolved_at', null);
    expect(data).toEqual([{ id: incidentId, alert_tier: 2 }]);
  });

  test('concurrent alerts for one device still leave a single open incident', async () => {
    await Promise.all(Array.from({ length: 5 }, () => send({ co_ppm: 61, temp_celsius: 30 })));
    const device = await deviceByCode(DEVICES.alerting.device_code);
    const { data } = await admin.from('alert_events').select('id').eq('device_id', device.id).is('resolved_at', null);
    expect(data).toHaveLength(1);
  });

  test('confirm-sms-status validates input and is idempotent', async () => {
    const headers = await deviceKey(DEVICES.alerting.device_code);
    expect((await callFunction('confirm-sms-status', { body: { alert_event_id: incidentId, role: 'neighbor', success: true }, headers })).status).toBe(400);
    expect((await callFunction('confirm-sms-status', { body: { alert_event_id: incidentId, role: 'owner', success: 'true' }, headers })).status).toBe(400);
    for (let i = 0; i < 2; i++) {
      expect((await callFunction('confirm-sms-status', { body: { alert_event_id: incidentId, role: 'bfp', success: true }, headers })).status).toBe(200);
    }
  });

  test("confirm-sms-status refuses another device's incident", async () => {
    const other = await deviceByCode(DEVICES.otherResident.device_code);
    const r = await callFunction('confirm-sms-status', {
      body: { alert_event_id: incidentId, role: 'owner', success: true },
      headers: { 'x-device-key': other.api_key },
    });
    expect(r.status).toBe(404);
  });
});

test.describe('login (server-side lockout gate)', () => {
  test.describe.configure({ mode: 'serial' }); // all steps share lock.api's attempt history

  const { email } = ACCOUNTS.lockApi;
  const login = (password: string, as = email) => callFunction('login', { body: { email: as, password } });

  test.beforeAll(async () => { await clearLoginAttempts(email); });

  test('missing email or password is 400 and records nothing', async () => {
    expect((await callFunction('login', { body: { email } })).status).toBe(400);
    expect((await callFunction('login', { body: { password: 'x' } })).status).toBe(400);
    const { data } = await admin.from('login_attempts').select('id').eq('email', email);
    expect(data).toEqual([]);
  });

  test('3rd failure locks for 10s', async () => {
    await seedFailedAttempts(email, 2, 60);
    const r = await login('wrong-password');
    expect(r.status).toBe(401);
    expect(r.json).toMatchObject({ locked: true });
    expect(r.json!.retry_after_seconds).toBeGreaterThan(0);
    expect(r.json!.retry_after_seconds).toBeLessThanOrEqual(10);
  });

  test('while locked even the correct password is refused with 429', async () => {
    const r = await login(PASSWORD);
    expect(r.status).toBe(429);
    expect(r.json).toMatchObject({ locked: true });
  });

  test('email case does not dodge the counter', async () => {
    const r = await login(PASSWORD, email.toUpperCase());
    expect(r.status).toBe(429);
  });

  test('5th failure escalates to 30s, 7th to 900s', async () => {
    await clearLoginAttempts(email);
    await seedFailedAttempts(email, 4, 15); // tier-1 cooldown (10s) already over
    const fifth = await login('wrong-password');
    expect(fifth.json!.retry_after_seconds).toBeGreaterThan(10);
    expect(fifth.json!.retry_after_seconds).toBeLessThanOrEqual(30);

    await clearLoginAttempts(email);
    await seedFailedAttempts(email, 6, 35); // tier-2 cooldown (30s) already over
    const seventh = await login('wrong-password');
    expect(seventh.json!.retry_after_seconds).toBeGreaterThan(30);
    expect(seventh.json!.retry_after_seconds).toBeLessThanOrEqual(900);
  });

  test('admin unlock clears the lockout immediately', async () => {
    expect((await login(PASSWORD)).status).toBe(429);
    const { error } = await (await clientAs('admin')).rpc('admin_unlock_login', { p_email: email });
    expect(error).toBeNull();
    expect((await login(PASSWORD)).status).toBe(200);
  });

  test('a successful login returns tokens that work as a normal session', async () => {
    await clearLoginAttempts(email);
    const r = await login(PASSWORD);
    expect(r.status).toBe(200);
    const c = anonClient();
    const { error } = await c.auth.setSession({ access_token: r.json!.access_token as string, refresh_token: r.json!.refresh_token as string });
    expect(error).toBeNull();
    const { data } = await c.auth.getUser();
    expect(data.user?.email).toBe(email);
    const { data: attempts } = await admin.from('login_attempts').select('success').eq('email', email);
    expect(attempts).toEqual([{ success: true }]);
  });
});

test.describe('register', () => {
  const valid = () => ({
    full_name: 'E2E Api Registrant', email: freshEmail('api.reg'), password: PASSWORD, requested_role: 'resident',
    contact_number: '09171234567', address: '1 Api St, Brgy, City, Province',
  });

  const rejected: [string, Record<string, unknown>][] = [
    ['missing full_name', { full_name: '' }],
    ['missing requested_role', { requested_role: undefined }],
    ['self-registering as admin', { requested_role: 'admin' }],
    ['phone with +63', { contact_number: '+639171234567' }],
    ['phone with letters', { contact_number: '0917abc4567' }],
    ['5-character password', { password: '12345' }],
    ['malformed email', { email: 'a@b' }],
    ['resident without address', { address: '' }],
    ['responder without organization', { requested_role: 'bfp_responder', organization: '' }],
  ];
  for (const [name, patch] of rejected) {
    test(`400: ${name}`, async () => {
      const body = { ...valid(), ...patch };
      const r = await callFunction('register', { body });
      expect(r.status).toBe(400);
      expect(r.json?.error).toEqual(expect.any(String));
      const { data } = await admin.from('registration_requests').select('id').eq('email', String(body.email));
      expect(data ?? []).toEqual([]);
    });
  }

  test('exactly 6 characters and no phone number is accepted', async () => {
    const r = await callFunction('register', { body: { ...valid(), password: '123456', contact_number: undefined } });
    expect(r.status).toBe(200);
  });

  test('device_code: unknown -> recognized false; omitted -> null', async () => {
    const unknown = await callFunction('register', { body: { ...valid(), device_code: 'NO-SUCH-DEVICE' } });
    expect(unknown.status).toBe(200);
    expect(unknown.json?.device_code_recognized).toBe(false);
    const omitted = await callFunction('register', { body: valid() });
    expect(omitted.json?.device_code_recognized ?? null).toBeNull();
  });

  test('duplicate email is 409 and leaves no orphaned rows', async () => {
    const body = valid();
    expect((await callFunction('register', { body })).status).toBe(200);
    const again = await callFunction('register', { body: { ...body, full_name: 'Second Attempt' } });
    expect(again.status).toBe(409);
    const profile = await profileByEmail(body.email);
    expect(profile).toMatchObject({ role: 'resident', status: 'pending' });
    const { data } = await admin.from('registration_requests').select('id').eq('email', body.email);
    expect(data).toHaveLength(1);
  });

  test('very long input does not crash the function', async () => {
    const r = await callFunction('register', { body: { ...valid(), full_name: 'N'.repeat(5000), address: 'A'.repeat(10000) } });
    expect([200, 400]).toContain(r.status);
    expect(r.json).not.toBeNull();
  });
});

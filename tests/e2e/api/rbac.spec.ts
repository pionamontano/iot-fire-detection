// testing/reports/ROLE_BASED_ACCESS_TESTING.md: every CRUD boundary, checked with each role's real
// JWT against PostgREST/RPC. "Cannot" is asserted on the outcome (row unchanged / not returned),
// so it holds whether the denial comes from a GRANT or from RLS.
import { expect, test } from '@playwright/test';
import { ACCOUNTS, DEVICES, SETTINGS_PROBE_KEY } from '../support/accounts.ts';
import { admin, anonClient, clientAs, deviceByCode, profileByEmail } from '../support/supabase.ts';

const E2E_DEVICE_LIKE = 'E2E-%';

test.describe('devices', () => {
  test('admin reads every device including the real api_key (via devices_safe)', async () => {
    // 20261015000000 revoked table-wide SELECT on devices from authenticated, admins included;
    // the key reaches admins through devices_safe -> get_device_api_key_secure().
    const c = await clientAs('admin');
    const { data, error } = await c.from('devices_safe').select('device_code, api_key').like('device_code', E2E_DEVICE_LIKE);
    expect(error).toBeNull();
    expect(data!.length).toBe(Object.keys(DEVICES).length);
    for (const d of data!) expect(d.api_key).toMatch(/^sk_/);
  });

  test('responder reads all devices via devices_safe with api_key masked', async () => {
    const c = await clientAs('responder');
    const { data, error } = await c.from('devices_safe').select('device_code, api_key').like('device_code', E2E_DEVICE_LIKE);
    expect(error).toBeNull();
    expect(data!.length).toBe(Object.keys(DEVICES).length);
    for (const d of data!) expect(d.api_key).toBeNull();
  });

  test('resident sees only their own device via devices_safe, api_key masked', async () => {
    const c = await clientAs('resident');
    const { data } = await c.from('devices_safe').select('device_code, api_key');
    expect(data).toEqual([{ device_code: DEVICES.resident.device_code, api_key: null }]);
  });

  test('resident cannot read another device by id', async () => {
    const other = await deviceByCode(DEVICES.otherResident.device_code);
    const c = await clientAs('resident');
    const { data } = await c.from('devices_safe').select('id').eq('id', other.id);
    expect(data ?? []).toEqual([]);
  });

  for (const who of ['resident', 'responder'] as const) {
    test(`${who} cannot read api_key from the base devices table`, async () => {
      const c = await clientAs(who);
      const { data, error } = await c.from('devices').select('api_key').like('device_code', E2E_DEVICE_LIKE);
      expect(error !== null || (data ?? []).length === 0, 'api_key must not be returned').toBe(true);
    });

    test(`${who} cannot create, update or delete a device`, async () => {
      const c = await clientAs(who);
      const ins = await c.from('devices').insert({ device_code: `E2E-FORGED-${who}`, label: 'forged' }).select();
      expect(ins.error).not.toBeNull();

      const target = await deviceByCode(DEVICES.resident.device_code);
      await c.from('devices').update({ label: 'hijacked', co_threshold: 999 }).eq('id', target.id);
      await c.from('devices').delete().eq('id', target.id);
      const after = await deviceByCode(DEVICES.resident.device_code);
      expect(after).toMatchObject({ label: DEVICES.resident.label, co_threshold: DEVICES.resident.co_threshold });
    });

    test(`${who} cannot regenerate a device api_key`, async () => {
      const before = await deviceByCode(DEVICES.resident.device_code);
      const c = await clientAs(who);
      const { error } = await c.rpc('regenerate_device_api_key', { p_device_id: before.id });
      expect(error).not.toBeNull();
      expect((await deviceByCode(DEVICES.resident.device_code)).api_key).toBe(before.api_key);
    });
  }

  test('admin can regenerate a device api_key', async () => {
    const before = await deviceByCode(DEVICES.rotating.device_code);
    const c = await clientAs('admin');
    const { error } = await c.rpc('regenerate_device_api_key', { p_device_id: before.id });
    expect(error).toBeNull();
    expect((await deviceByCode(DEVICES.rotating.device_code)).api_key).not.toBe(before.api_key);
  });

  test('anonymous caller cannot regenerate a device api_key', async () => {
    const before = await deviceByCode(DEVICES.rotating.device_code);
    const { error } = await anonClient().rpc('regenerate_device_api_key', { p_device_id: before.id });
    expect(error).not.toBeNull();
  });

  test('resident updates own thresholds only within 0-100°C / 0-1000ppm', async () => {
    const c = await clientAs('resident');
    expect((await c.rpc('update_own_device_alert_settings', { p_temp_threshold: 58, p_co_threshold: 55 })).error).toBeNull();
    expect((await c.rpc('update_own_device_alert_settings', { p_temp_threshold: 101, p_co_threshold: 55 })).error).not.toBeNull();
    expect((await c.rpc('update_own_device_alert_settings', { p_temp_threshold: 58, p_co_threshold: 1001 })).error).not.toBeNull();
    const d = await deviceByCode(DEVICES.resident.device_code);
    expect(d).toMatchObject({ temp_threshold: 58, co_threshold: 55 });
    await admin.from('devices').update({ temp_threshold: DEVICES.resident.temp_threshold, co_threshold: DEVICES.resident.co_threshold }).eq('id', d.id);
  });
});

test.describe('profiles', () => {
  // 20261019000000_restrict_profile_reads: own row for everyone, every row for approved admins only.
  test('admin reads every profile', async () => {
    const { data } = await (await clientAs('admin')).from('profiles').select('id');
    expect(data!.length).toBeGreaterThanOrEqual(Object.keys(ACCOUNTS).length);
  });

  test('resident and responder read only their own profile', async () => {
    for (const who of ['resident', 'responder'] as const) {
      const self = await profileByEmail(ACCOUNTS[who].email);
      const { data } = await (await clientAs(who)).from('profiles').select('id');
      expect(data!.map((r) => r.id)).toEqual([self.id]);
    }
  });

  test('pending and rejected accounts see at most their own profile row', async () => {
    for (const who of ['pending', 'rejected'] as const) {
      const self = await profileByEmail(ACCOUNTS[who].email);
      const { data } = await (await clientAs(who)).from('profiles').select('id');
      expect((data ?? []).every((r) => r.id === self.id)).toBe(true);
    }
  });

  test('user can update their own contact number', async () => {
    const self = await profileByEmail(ACCOUNTS.editable.email);
    const c = await clientAs('editable');
    await c.from('profiles').update({ contact_number: '09998887777' }).eq('id', self.id);
    expect((await profileByEmail(ACCOUNTS.editable.email)).contact_number).toBe('09998887777');
  });

  test('user cannot change their own role or status', async () => {
    const self = await profileByEmail(ACCOUNTS.editable.email);
    const c = await clientAs('editable');
    await c.from('profiles').update({ role: 'admin' }).eq('id', self.id);
    await c.from('profiles').update({ status: 'rejected' }).eq('id', self.id);
    expect(await profileByEmail(ACCOUNTS.editable.email)).toMatchObject({ role: 'resident', status: 'approved' });
  });

  test("user cannot edit or delete someone else's profile", async () => {
    const victim = await profileByEmail(ACCOUNTS.otherResident.email);
    const c = await clientAs('resident');
    await c.from('profiles').update({ full_name: 'hijacked', contact_number: '09000000000' }).eq('id', victim.id);
    await c.from('profiles').delete().eq('id', victim.id);
    const after = await profileByEmail(ACCOUNTS.otherResident.email);
    expect(after.contact_number).toBe(victim.contact_number);
  });

  test('resident cannot delete their own profile', async () => {
    const self = await profileByEmail(ACCOUNTS.editable.email);
    await (await clientAs('editable')).from('profiles').delete().eq('id', self.id);
    await expect(profileByEmail(ACCOUNTS.editable.email)).resolves.toBeTruthy();
  });

  test('rejecting an account takes effect on the very next request with the same JWT', async () => {
    const self = await profileByEmail(ACCOUNTS.revocable.email);
    const c = await clientAs('revocable');
    expect((await c.from('station_settings').select('id')).data).toHaveLength(1);
    try {
      await admin.from('profiles').update({ status: 'rejected' }).eq('id', self.id);
      expect((await c.from('station_settings').select('id')).data ?? []).toEqual([]);
      const { data } = await c.from('profiles').select('id');
      expect((data ?? []).every((r) => r.id === self.id)).toBe(true);
    } finally {
      await admin.from('profiles').update({ status: 'approved' }).eq('id', self.id);
    }
  });
});

test.describe('sensor_readings and alert_events', () => {
  for (const who of ['admin', 'responder', 'resident'] as const) {
    test(`${who} cannot insert readings or alerts directly`, async () => {
      const c = await clientAs(who);
      const device = await deviceByCode(DEVICES.resident.device_code);
      expect((await c.from('sensor_readings').insert({ device_id: device.id, co_ppm: 1, temp_celsius: 1 })).error).not.toBeNull();
      expect((await c.from('alert_events').insert({ device_id: device.id, alert_tier: 2, co_ppm: 999, temp_celsius: 99 })).error).not.toBeNull();
    });
  }

  test('responder reads readings and alerts for every device', async () => {
    const c = await clientAs('responder');
    const ids = [(await deviceByCode(DEVICES.resident.device_code)).id, (await deviceByCode(DEVICES.otherResident.device_code)).id];
    const r = await c.from('sensor_readings').select('device_id').in('device_id', ids);
    const a = await c.from('alert_events').select('device_id').in('device_id', ids);
    expect(new Set(r.data!.map((x) => x.device_id))).toEqual(new Set(ids));
    expect(new Set(a.data!.map((x) => x.device_id))).toEqual(new Set(ids));
  });

  test("resident reads only their own device's readings and alerts", async () => {
    const own = await deviceByCode(DEVICES.resident.device_code);
    const other = await deviceByCode(DEVICES.otherResident.device_code);
    const c = await clientAs('resident');
    const r = await c.from('sensor_readings').select('device_id').in('device_id', [own.id, other.id]);
    const a = await c.from('alert_events').select('device_id').in('device_id', [own.id, other.id]);
    expect(r.data!.length).toBeGreaterThan(0);
    expect(r.data!.every((x) => x.device_id === own.id)).toBe(true);
    expect(a.data!.length).toBeGreaterThan(0);
    expect(a.data!.every((x) => x.device_id === own.id)).toBe(true);
  });

  for (const who of ['admin', 'responder', 'resident'] as const) {
    test(`${who} cannot update or delete an alert or reading directly`, async () => {
      const device = await deviceByCode(DEVICES.resident.device_code);
      const before = (await admin.from('alert_events').select('*').eq('device_id', device.id)).data!;
      const readings = (await admin.from('sensor_readings').select('id').eq('device_id', device.id)).data!;
      const c = await clientAs(who);
      await c.from('alert_events').update({ outcome_notes: 'tampered', alert_tier: 2 }).eq('device_id', device.id);
      await c.from('alert_events').delete().eq('device_id', device.id);
      await c.from('sensor_readings').update({ co_ppm: 999 }).eq('device_id', device.id);
      await c.from('sensor_readings').delete().eq('device_id', device.id);
      expect((await admin.from('alert_events').select('*').eq('device_id', device.id)).data).toEqual(before);
      expect((await admin.from('sensor_readings').select('id').eq('device_id', device.id)).data).toEqual(readings);
    });
  }
});

test.describe('login attempts and lockout', () => {
  test('nobody can insert login attempts directly (forging or force-locking)', async () => {
    const row = { email: ACCOUNTS.resident.email, success: false };
    expect((await anonClient().from('login_attempts').insert(row)).error).not.toBeNull();
    expect((await (await clientAs('resident')).from('login_attempts').insert(row)).error).not.toBeNull();
  });

  test('only admin can read login history', async () => {
    expect((await (await clientAs('admin')).from('login_attempts').select('id').limit(1)).error).toBeNull();
    for (const who of ['resident', 'responder'] as const) {
      const { data } = await (await clientAs(who)).from('login_attempts').select('id').limit(1);
      expect(data ?? []).toEqual([]);
    }
  });

  for (const who of ['anon', 'resident', 'responder'] as const) {
    test(`${who} cannot clear a lockout with admin_unlock_login`, async () => {
      const c = who === 'anon' ? anonClient() : await clientAs(who);
      const { error } = await c.rpc('admin_unlock_login', { p_email: ACCOUNTS.lockApi.email });
      expect(error).not.toBeNull();
      const { data } = await admin.from('login_lockout_overrides').select('email').eq('email', ACCOUNTS.lockApi.email);
      expect(data).toEqual([]);
    });
  }

  test('clients cannot call check_login_lockout (only the login function may)', async () => {
    // Regression: PUBLIC kept EXECUTE until 20261106000000.
    for (const c of [anonClient(), await clientAs('resident')]) {
      const { error } = await c.rpc('check_login_lockout', { p_email: ACCOUNTS.resident.email });
      expect(error).not.toBeNull();
    }
  });
});

test.describe('settings and station settings', () => {
  test('approved users read settings', async () => {
    expect((await (await clientAs('resident')).from('settings').select('key')).data!.length).toBeGreaterThan(0);
  });

  test('pending, rejected and deactivated accounts read no settings', async () => {
    // Regression: a misnamed DROP POLICY left "Authenticated users can read settings" in place
    // until 20261106000000.
    for (const who of ['pending', 'rejected', 'deactivated'] as const) {
      expect((await (await clientAs(who)).from('settings').select('key')).data ?? []).toEqual([]);
    }
  });

  test('only admin can change settings', async () => {
    for (const who of ['resident', 'responder'] as const) {
      const c = await clientAs(who);
      await c.from('settings').update({ value: `set-by-${who}` }).eq('key', SETTINGS_PROBE_KEY);
      expect((await c.from('settings').insert({ key: `e2e_forged_${who}`, value: 'x' })).error).not.toBeNull();
    }
    expect((await admin.from('settings').select('value').eq('key', SETTINGS_PROBE_KEY).single()).data!.value).toBe('initial');
    const adminRes = await (await clientAs('admin')).from('settings').update({ value: 'initial' }).eq('key', SETTINGS_PROBE_KEY).select();
    expect(adminRes.data).toHaveLength(1);
  });

  test('pending and rejected accounts cannot read station settings', async () => {
    for (const who of ['pending', 'rejected'] as const) {
      expect((await (await clientAs(who)).from('station_settings').select('id')).data ?? []).toEqual([]);
    }
  });

  test('responder may update station settings, resident may not', async () => {
    const before = (await admin.from('station_settings').select('*').eq('id', 1).single()).data!;
    const asResponder = await (await clientAs('responder')).from('station_settings').update({ contact_number: before.contact_number }).eq('id', 1).select();
    expect(asResponder.data).toHaveLength(1);
    await (await clientAs('resident')).from('station_settings').update({ contact_number: '09000000000' }).eq('id', 1);
    expect((await admin.from('station_settings').select('contact_number').eq('id', 1).single()).data!.contact_number).toBe(before.contact_number);
  });

  test('station settings stay a single row', async () => {
    const { error } = await (await clientAs('admin')).from('station_settings').insert({ id: 2, contact_number: '09171234567', address: 'x' });
    expect(error).not.toBeNull();
  });
});

// Beneath RLS: these privileges must be absent, not merely filtered to zero rows. Production had
// drifted on exactly these until 20261107000000.
test.describe('privileges (defence in depth beneath RLS)', () => {
  const PERMISSION_DENIED = '42501';

  test('nobody can read devices.api_key from the base table, admins included', async () => {
    for (const c of [anonClient(), await clientAs('admin'), await clientAs('responder'), await clientAs('resident')]) {
      const { error } = await c.from('devices').select('api_key').limit(1);
      expect(error?.code).toBe(PERMISSION_DENIED);
    }
  });

  test('anonymous callers cannot read devices at all', async () => {
    const { error } = await anonClient().from('devices').select('id').limit(1);
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  test('clients cannot insert or update alert_events directly', async () => {
    const device = await deviceByCode(DEVICES.resident.device_code);
    for (const c of [anonClient(), await clientAs('admin'), await clientAs('responder')]) {
      const ins = await c.from('alert_events').insert({ device_id: device.id, alert_tier: 1, co_ppm: 60, temp_celsius: 30 });
      expect(ins.error?.code).toBe(PERMISSION_DENIED);
      const upd = await c.from('alert_events').update({ incident_status: 'acknowledged' }).eq('device_id', device.id);
      expect(upd.error?.code).toBe(PERMISSION_DENIED);
    }
  });
});

test.describe('registration requests', () => {
  test('a user reads only their own request and cannot review it', async () => {
    const self = await profileByEmail(ACCOUNTS.resident.email);
    const c = await clientAs('resident');
    const { data } = await c.from('registration_requests').select('user_id, admin_notes');
    expect(data!.map((r) => r.user_id)).toEqual([self.id]);
    await c.from('registration_requests').update({ admin_notes: 'self-approved' }).eq('user_id', self.id);
    const after = (await admin.from('registration_requests').select('admin_notes').eq('user_id', self.id).single()).data!;
    expect(after.admin_notes).toBeNull();
  });

  test('admin reads every request', async () => {
    const { data } = await (await clientAs('admin')).from('registration_requests').select('email').like('email', '%@e2e.agapsense.test');
    expect(data!.length).toBeGreaterThanOrEqual(Object.values(ACCOUNTS).filter((a) => a.role !== 'admin').length);
  });
});

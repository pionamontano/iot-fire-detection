// Step 2 (NOT-005): approval/eligibility enforcement in the edge functions.
// Runs the real handlers from supabase/functions against a fake DB. No network, nothing is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb, loadHandler, req } from './harness.mjs';

const DEV = '10000000-0000-0000-0000-000000000001';
const OTHER_DEV = '10000000-0000-0000-0000-000000000002';
const profiles = [
  { id: 'admin-ok',        role: 'admin',         status: 'approved', is_active: true,  device_id: null,      contact_number: '09000000001' },
  { id: 'admin-inactive',  role: 'admin',         status: 'approved', is_active: false, device_id: null,      contact_number: '09000000002' },
  { id: 'resp-ok',         role: 'bfp_responder', status: 'approved', is_active: true,  device_id: null,      contact_number: '09000000003' },
  { id: 'resp-pending',    role: 'bfp_responder', status: 'pending',  is_active: true,  device_id: null,      contact_number: '09000000004' },
  { id: 'resp-rejected',   role: 'bfp_responder', status: 'rejected', is_active: true,  device_id: null,      contact_number: '09000000005' },
  { id: 'res-ok',          role: 'resident',      status: 'approved', is_active: true,  device_id: DEV,       contact_number: '09111111111' },
  { id: 'res-other-dev',   role: 'resident',      status: 'approved', is_active: true,  device_id: OTHER_DEV, contact_number: '09222222222' },
];
const device = { id: DEV, device_code: 'T-001', location_desc: 'Loc', is_active: true, co_threshold: 200, temp_threshold: 60, bfp_contact: '09999999999', api_key: 'k' };

// ---------- trigger-alert ----------
async function runTrigger({ tier, profileRows = profiles }) {
  const db = new FakeDb({ devices: [device], profiles: profileRows, alert_events: [] });
  const pushCalls = [];
  const fetchImpl = async (url, init) => {
    if (String(url).includes('send-push-notification')) pushCalls.push(JSON.parse(init.body));
    return new Response('{}', { status: 200 });
  };
  const handler = loadHandler('trigger-alert', { db, env: { SUPABASE_URL: 'http://local', SUPABASE_SERVICE_ROLE_KEY: 'srv' }, fetchImpl });
  // tier 1: only CO over; tier 2: both over. No coords -> no geocoding call.
  const body = tier === 2 ? { co_ppm: 500, temp_celsius: 90, gps_valid: false } : { co_ppm: 500, temp_celsius: 20, gps_valid: false };
  const res = await handler(req(body, { 'x-device-key': 'k' }));
  return { res, pushCalls, db, payload: await res.json() };
}

test('trigger-alert Tier 2: push goes only to approved+active admins, responders and THIS device\'s resident', async () => {
  const { res, pushCalls } = await runTrigger({ tier: 2 });
  assert.equal(res.status, 200);
  assert.equal(pushCalls.length, 1);
  assert.deepEqual(pushCalls[0].userIds.sort(), ['admin-ok', 'res-ok', 'resp-ok']);
});

test('trigger-alert Tier 1: admins and THIS device\'s resident are pushed (no BFP responders); unapproved excluded', async () => {
  const { pushCalls } = await runTrigger({ tier: 1 });
  assert.deepEqual(pushCalls[0].userIds.sort(), ['admin-ok', 'res-ok']);
});

test('trigger-alert: unapproved/inactive accounts never appear, even when they are the only ones', async () => {
  const onlyBad = profiles.filter(p => p.status !== 'approved' || !p.is_active);
  const { res, pushCalls } = await runTrigger({ tier: 2, profileRows: onlyBad });
  assert.equal(res.status, 200);          // the alert itself is still created
  assert.equal(pushCalls.length, 0);      // no push dispatched to ineligible users
});

test('trigger-alert Tier 2: owner SMS contact is returned only for an approved+active resident', async () => {
  const ok = await runTrigger({ tier: 2 });
  assert.equal(ok.payload.owner_contact, '09111111111');
  for (const bad of [{ status: 'pending' }, { status: 'rejected' }, { is_active: false }]) {
    const rows = profiles.map(p => p.id === 'res-ok' ? { ...p, ...bad } : p);
    const r = await runTrigger({ tier: 2, profileRows: rows });
    assert.equal(r.payload.owner_contact, '', JSON.stringify(bad));
  }
});

// ---------- get-device-config ----------
test('get-device-config: owner_number empty unless resident is approved+active', async () => {
  for (const [bad, expected] of [[{}, '09111111111'], [{ status: 'pending' }, ''], [{ status: 'rejected' }, ''], [{ is_active: false }, '']]) {
    const rows = profiles.map(p => p.id === 'res-ok' ? { ...p, ...bad } : p);
    const db = new FakeDb({ devices: [device], profiles: rows });
    const handler = loadHandler('get-device-config', { db, env: { SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'y' } });
    const res = await handler(req({}, { 'x-device-key': 'k' }));
    assert.equal((await res.json()).owner_number, expected, JSON.stringify(bad));
  }
});

// ---------- link-device ----------
async function link(profile) {
  const rows = [{ ...profile }];
  const db = new FakeDb({ profiles: rows, devices: [{ id: DEV, device_code: 'T-001', is_active: true }] });
  const handler = loadHandler('link-device', { db, env: { SUPABASE_URL: 'x', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's' }, user: { id: profile.id } });
  const res = await handler(req({ device_code: 'T-001' }, { Authorization: 'Bearer t' }));
  return { res, rows: db.tables.profiles };
}
const resident = { id: 'r1', role: 'resident', device_id: null, status: 'approved', is_active: true };

test('link-device: approved active resident can link', async () => {
  const { res, rows } = await link(resident);
  assert.equal(res.status, 200);
  assert.equal(rows[0].device_id, DEV);
});
for (const bad of [{ status: 'pending' }, { status: 'rejected' }, { is_active: false }]) {
  test(`link-device: ${JSON.stringify(bad)} resident is refused (403) and nothing is linked`, async () => {
    const { res, rows } = await link({ ...resident, ...bad });
    assert.equal(res.status, 403);
    assert.equal(rows[0].device_id, null);
  });
}

// ---------- register-push ----------
async function registerPush(profile, action = 'subscribe') {
  const db = new FakeDb({ profiles: [profile], push_subscriptions: [] });
  const handler = loadHandler('register-push', { db, env: { SUPABASE_URL: 'x', SUPABASE_ANON_KEY: 'a' }, user: { id: profile.id } });
  const sub = { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } };
  const res = await handler(req({ action, subscription: sub }, { Authorization: 'Bearer t' }));
  return { res, writes: db.log.filter(l => l.table === 'push_subscriptions') };
}
test('register-push: approved active user can subscribe', async () => {
  const { res, writes } = await registerPush({ id: 'u', role: 'bfp_responder', status: 'approved', is_active: true });
  assert.equal(res.status, 200);
  assert.equal(writes.filter(w => w.op === 'upsert').length, 1);
});
for (const bad of [{ status: 'pending' }, { status: 'rejected' }, { is_active: false }]) {
  test(`register-push: ${JSON.stringify(bad)} user is refused (403) and no subscription is written`, async () => {
    const { res, writes } = await registerPush({ id: 'u', role: 'bfp_responder', status: 'approved', is_active: true, ...bad });
    assert.equal(res.status, 403);
    assert.equal(writes.length, 0);
  });
}
test('register-push: a non-approved user can still UNSUBSCRIBE (cleanup is not blocked)', async () => {
  const { res, writes } = await registerPush({ id: 'u', role: 'bfp_responder', status: 'rejected', is_active: true }, 'unsubscribe');
  assert.equal(res.status, 200);
  assert.equal(writes.filter(w => w.op === 'delete').length, 1);
});

// ---------- send-push-notification (independent validation) ----------
test('send-push-notification: only approved+active users\' subscriptions are used, even for the service role', async () => {
  const sent = [];
  const webpush = { setVapidDetails() {}, sendNotification: async (sub) => { sent.push(sub.endpoint); } };
  const subs = profiles.map(p => ({ user_id: p.id, endpoint: 'ep-' + p.id, p256dh: 'p', auth: 'a' }));
  const db = new FakeDb({ profiles, push_subscriptions: subs });
  const handler = loadHandler('send-push-notification', { db, webpush, env: { SUPABASE_URL: 'x', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 'srv', VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' } });
  const res = await handler(req({ userIds: profiles.map(p => p.id), title: 't', body: 'b' }, { Authorization: 'Bearer srv' }));
  assert.equal(res.status, 200);
  assert.deepEqual(sent.sort(), ['ep-admin-ok', 'ep-res-ok', 'ep-res-other-dev', 'ep-resp-ok']);
  assert.equal((await res.json()).sentCount, 4);
});
test('send-push-notification: all-ineligible list sends nothing', async () => {
  const sent = [];
  const webpush = { setVapidDetails() {}, sendNotification: async (s) => { sent.push(s.endpoint); } };
  const db = new FakeDb({ profiles, push_subscriptions: [{ user_id: 'resp-pending', endpoint: 'e', p256dh: 'p', auth: 'a' }] });
  const handler = loadHandler('send-push-notification', { db, webpush, env: { SUPABASE_URL: 'x', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 'srv', VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' } });
  const res = await handler(req({ userIds: ['resp-pending', 'resp-rejected'], title: 't', body: 'b' }, { Authorization: 'Bearer srv' }));
  assert.equal((await res.json()).sentCount, 0);
  assert.equal(sent.length, 0);
});

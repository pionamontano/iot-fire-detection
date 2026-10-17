// Step 5.2: send-push-notification per-recipient results, and the confirm-sms-status "never overwrite a success" guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb, loadHandler, req } from './harness.mjs';

const ENV = { SUPABASE_URL: 'http://local', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 'srv', VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' };
const profiles = [
  { id: 'u-ok',      role: 'bfp_responder', status: 'approved', is_active: true },
  { id: 'u-nosub',   role: 'bfp_responder', status: 'approved', is_active: true },
  { id: 'u-failed',  role: 'admin',         status: 'approved', is_active: true },
  { id: 'u-expired', role: 'admin',         status: 'approved', is_active: true },
  { id: 'u-pending', role: 'bfp_responder', status: 'pending',  is_active: true },
];
const subs = [
  { user_id: 'u-ok', endpoint: 'https://push.example.net/secret-token-1', p256dh: 'p', auth: 'a' },
  { user_id: 'u-ok', endpoint: 'https://push.example.net/secret-token-1b', p256dh: 'p', auth: 'a' },
  { user_id: 'u-failed', endpoint: 'https://push.example.net/secret-token-2', p256dh: 'p', auth: 'a' },
  { user_id: 'u-expired', endpoint: 'https://push.example.net/secret-token-3', p256dh: 'p', auth: 'a' },
  { user_id: 'u-pending', endpoint: 'https://push.example.net/secret-token-4', p256dh: 'p', auth: 'a' },
];

function push(outcomeFor) {
  const sent = []; const options = [];
  const webpush = { setVapidDetails() {}, sendNotification: async (sub, _payload, opts) => {
    options.push(opts); const o = outcomeFor(sub);
    if (o instanceof Error) throw o; sent.push(sub.endpoint); return o ?? { statusCode: 201 };
  } };
  const db = new FakeDb({ profiles, push_subscriptions: subs });
  const handler = loadHandler('send-push-notification', { db, webpush, env: ENV });
  return { handler, sent, options, db };
}
const call = (h, body) => h(req(body, { Authorization: 'Bearer srv' })).then(async (r) => ({ r, j: await r.json() }));
const all = ['u-ok', 'u-nosub', 'u-failed', 'u-expired', 'u-pending'];
const errWith = (statusCode) => Object.assign(new Error('push failed'), { statusCode });

test('one result per REQUESTED recipient: sent / failed / skipped, with retryability', async () => {
  const p = push((sub) => sub.endpoint.endsWith('token-2') ? errWith(500) : sub.endpoint.endsWith('token-3') ? errWith(410) : undefined);
  const { r, j } = await call(p.handler, { userIds: all, title: 't', body: 'b' });
  assert.equal(r.status, 200);
  const by = Object.fromEntries(j.results.map((x) => [x.userId, x]));
  assert.equal(j.results.length, all.length);
  assert.equal(by['u-ok'].status, 'sent');
  assert.deepEqual([by['u-nosub'].status, by['u-nosub'].retryable], ['skipped', false]);
  assert.deepEqual([by['u-failed'].status, by['u-failed'].retryable, by['u-failed'].provider_status], ['failed', true, '500']);
  assert.deepEqual([by['u-expired'].status, by['u-expired'].retryable], ['failed', false], 'an expired endpoint is permanent');
  assert.deepEqual([by['u-pending'].status, by['u-pending'].retryable], ['skipped', false], 'ineligible recipients are skipped (Step 2 rule preserved)');
  assert.equal(j.sentCount, 1, 'sentCount now counts recipients actually reached');
});

test('a user with several endpoints counts as sent if ANY endpoint accepted', async () => {
  const p = push((sub) => sub.endpoint.endsWith('token-1') ? errWith(500) : undefined);
  const { j } = await call(p.handler, { userIds: ['u-ok'], title: 't', body: 'b' });
  assert.equal(j.results[0].status, 'sent');
  assert.equal(p.sent.length, 1);
});

test('every send has a timeout; a valid topic is passed through, an invalid one is dropped', async () => {
  const p = push(() => undefined);
  await call(p.handler, { userIds: ['u-ok'], title: 't', body: 'b', topic: 'a0123456789abcdef01234567t2' });
  assert.ok(p.options.every((o) => o.timeout > 0 && o.timeout <= 5000));
  assert.ok(p.options.every((o) => o.topic === 'a0123456789abcdef01234567t2'));
  const q = push(() => undefined);
  await call(q.handler, { userIds: ['u-ok'], title: 't', body: 'b', topic: 'bad topic with spaces and way too long to be valid!!' });
  assert.ok(q.options.every((o) => !('topic' in o)));
});

test('nothing is DELETED: expired endpoints are reported, never removed (decision D5.3 default)', async () => {
  const p = push(() => errWith(410));
  await call(p.handler, { userIds: ['u-ok', 'u-failed'], title: 't', body: 'b' });
  assert.equal(p.db.log.filter((l) => l.op === 'delete').length, 0);
});

test('the push endpoint URL (a bearer-like secret) is never written to logs', async () => {
  const lines = []; const orig = console.error; console.error = (...a) => lines.push(a.join(' '));
  try { const p = push(() => errWith(500)); await call(p.handler, { userIds: ['u-ok', 'u-failed'], title: 't', body: 'b' }); } finally { console.error = orig; }
  assert.ok(lines.length > 0);
  assert.ok(lines.every((l) => !l.includes('secret-token')), lines.join('\n'));
  assert.ok(lines.some((l) => l.includes('push.example.net')), 'the host is logged for diagnosis');
});

test('all requested recipients ineligible: no sends and a result per recipient', async () => {
  const p = push(() => undefined);
  const { j } = await call(p.handler, { userIds: ['u-pending', 'ghost'], title: 't', body: 'b' });
  assert.equal(p.sent.length, 0); assert.equal(j.sentCount, 0);
  assert.deepEqual(j.results.map((x) => x.status), ['skipped', 'skipped']);
});

// ---------------- confirm-sms-status ----------------
function sms(initial) {
  const db = new FakeDb({ devices: [{ id: 'd1', is_active: true, api_key: 'k' }], alert_events: [{ id: 'a1', device_id: 'd1', sms_sent_owner: initial.owner, sms_sent_bfp: initial.bfp }, { id: 'a2', device_id: 'other', sms_sent_owner: false, sms_sent_bfp: false }] });
  const handler = loadHandler('confirm-sms-status', { db, env: ENV });
  const post = async (body) => { const r = await handler(req(body, { 'x-device-key': 'k' })); return { status: r.status, j: await r.json() }; };
  return { post, row: () => db.tables.alert_events.find((a) => a.id === 'a1') };
}

test('a success report sets the flag', async () => {
  const s = sms({ owner: false, bfp: false });
  assert.equal((await s.post({ alert_event_id: 'a1', role: 'owner', success: true })).status, 200);
  assert.equal(s.row().sms_sent_owner, true);
});
test('a FAILURE report never overwrites an earlier success', async () => {
  const s = sms({ owner: true, bfp: false });
  const r = await s.post({ alert_event_id: 'a1', role: 'owner', success: false });
  assert.deepEqual([r.status, r.j.unchanged], [200, true]);
  assert.equal(s.row().sms_sent_owner, true);
});
test('a failure report on a not-yet-sent flag keeps it false; roles are independent', async () => {
  const s = sms({ owner: true, bfp: false });
  assert.equal((await s.post({ alert_event_id: 'a1', role: 'bfp', success: false })).status, 200);
  assert.deepEqual([s.row().sms_sent_owner, s.row().sms_sent_bfp], [true, false]);
});
test('unknown alert id or another device\'s alert is a 404 (scoped to the calling device), for success and failure reports', async () => {
  const s = sms({ owner: false, bfp: false });
  for (const success of [true, false]) {
    assert.equal((await s.post({ alert_event_id: 'nope', role: 'owner', success })).status, 404);
    assert.equal((await s.post({ alert_event_id: 'a2', role: 'owner', success })).status, 404);
  }
});
test('validation unchanged', async () => {
  const s = sms({ owner: false, bfp: false });
  assert.equal((await s.post({ role: 'owner', success: true })).status, 400);
  assert.equal((await s.post({ alert_event_id: 'a1', role: 'x', success: true })).status, 400);
  assert.equal((await s.post({ alert_event_id: 'a1', role: 'owner', success: 'yes' })).status, 400);
});

test('a same-site url is passed to the notification; an off-site or protocol-relative one is dropped', async () => {
  const payloads = [];
  const webpush = { setVapidDetails() {}, sendNotification: async (_sub, payload) => { payloads.push(JSON.parse(payload)); return { statusCode: 201 }; } };
  const db = new FakeDb({ profiles, push_subscriptions: subs.filter((s) => s.endpoint.endsWith('token-1')) });
  const handler = loadHandler('send-push-notification', { db, webpush, env: ENV });
  for (const url of ['/admin/support?request=r1', 'https://evil.example', '//evil.example', '/\\evil.example', 42]) {
    await call(handler, { userIds: ['u-ok'], title: 't', body: 'b', url });
  }
  assert.deepEqual(payloads.map((p) => p.url), ['/admin/support?request=r1', undefined, undefined, undefined, undefined]);
});

test('the push service\'s reason for a rejection is logged (e.g. a 403 for a subscription made with another key)', async () => {
  const lines = []; const orig = console.error; console.error = (...a) => lines.push(a.join(' '));
  const rejected = Object.assign(errWith(403), { body: 'the key in the authorization header does not correspond to the sender ID' });
  try { const p = push(() => rejected); await call(p.handler, { userIds: ['u-failed'], title: 't', body: 'b' }); } finally { console.error = orig; }
  assert.ok(lines.some((l) => l.includes('status 403') && l.includes('does not correspond')), lines.join('\n'));
  assert.ok(lines.every((l) => !l.includes('secret-token')));
});

test('register-push GET returns the server\'s VAPID public key without sign-in, so the app subscribes with the matching key', async () => {
  const get = (env) => loadHandler('register-push', { db: new FakeDb({}), env })(new Request('http://local/fn', { method: 'GET' }));
  const ok = await get({ VAPID_PUBLIC_KEY: 'BPublicKey' });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { publicKey: 'BPublicKey' });
  const missing = await get({});
  assert.equal(missing.status, 503, 'no key configured: the app reports push as unavailable instead of using a stale key');
});

test('pushes expire after an hour by default (no alert shown days late); a valid caller TTL is used, an invalid one ignored', async () => {
  const p = push(() => undefined);
  await call(p.handler, { userIds: ['u-ok'], title: 't', body: 'b' });
  assert.ok(p.options.every((o) => o.TTL === 3600));
  const q = push(() => undefined);
  await call(q.handler, { userIds: ['u-ok'], title: 't', body: 'b', ttl: 600 });
  assert.ok(q.options.every((o) => o.TTL === 600));
  const r = push(() => undefined);
  await call(r.handler, { userIds: ['u-ok'], title: 't', body: 'b', ttl: 'forever' });
  assert.ok(r.options.every((o) => o.TTL === 3600));
});

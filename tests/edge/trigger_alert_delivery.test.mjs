// Step 5.2: trigger-alert persists first, then notifies through the idempotency ledger. Real handler source, in-memory
// backend + provider stubs (nothing is sent anywhere).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, TIER1, TIER2, device, profiles } from './delivery_helpers.mjs';

// An admin who linked their own Telegram: the only Telegram recipient of a Tier 1 warning.
const withAdminChat = profiles.map((p) => (p.id === 'admin-ok' ? { ...p, telegram_chat_id: 'chat-admin' } : p));

const ELIGIBLE_T2 = ['admin-ok', 'res-ok', 'resp-ok'];
const ELIGIBLE_T1 = ['admin-ok', 'res-ok'];   // Tier 1 warnings go to admins and the resident; BFP responders join at Tier 2
const sorted = (a) => [...a].sort();

test('PERSIST FIRST: raise_alert is called before any provider is contacted', async () => {
  const t = setup(); await t.send();
  const firstRaise = t.events.findIndex((e) => e.t === 'rpc' && e.fn === 'raise_alert');
  const firstProvider = t.events.findIndex((e) => e.t === 'telegram' || e.t === 'push');
  assert.ok(firstRaise >= 0 && firstProvider > firstRaise, JSON.stringify(t.events.map((e) => e.t + (e.fn ? ':' + e.fn : ''))));
});

test('first request: one incident, one Telegram, one push to exactly the eligible recipients', async () => {
  const t = setup(); const { res, json } = await t.send();
  assert.equal(res.status, 200);
  assert.equal(json.created, true);
  assert.equal(t.calls.telegram.length, 1);
  assert.equal(t.calls.push.length, 1);
  assert.deepEqual(sorted(t.calls.push[0].userIds), ELIGIBLE_T2);
});

test('REPLAY: the same alert sent 3 times (sequentially) notifies once and returns the SAME incident', async () => {
  const t = setup(); const a = await t.send(); const b = await t.send(); const c = await t.send();
  assert.equal(new Set([a.json.alert_event_id, b.json.alert_event_id, c.json.alert_event_id]).size, 1);
  assert.deepEqual([a.json.created, b.json.created, c.json.created], [true, false, false]);
  assert.equal(t.calls.telegram.length, 1, 'Telegram sent once');
  assert.equal(t.calls.push.length, 1, 'push dispatched once');
  assert.equal(t.backend.incidents.length, 1);
});

test('CONCURRENT replay: 12 simultaneous identical requests still notify once', async () => {
  const t = setup();
  const all = await Promise.all(Array.from({ length: 12 }, () => t.send()));
  assert.ok(all.every((r) => r.res.status === 200));
  assert.equal(new Set(all.map((r) => r.json.alert_event_id)).size, 1);
  assert.equal(all.filter((r) => r.json.created).length, 1);
  assert.equal(t.calls.telegram.length, 1);
  assert.deepEqual(t.calls.push.flatMap((c) => c.userIds).sort(), ELIGIBLE_T2, 'each eligible recipient pushed exactly once');
});

test('ESCALATION tier 1 -> 2 is a NEW notification (same incident), responders and residents join only at tier 2', async () => {
  const t = setup();
  const one = await t.send(TIER1); const two = await t.send(TIER2);
  assert.equal(one.json.alert_event_id, two.json.alert_event_id);
  assert.equal(one.json.tier, 1); assert.equal(two.json.tier, 2);
  assert.equal(t.calls.telegram.length, 1, 'the station chat gets the Tier 2 fire only');
  assert.match(t.calls.telegram[0].text, /^FIRE ALERT — Tier 2/);
  assert.deepEqual(sorted(t.calls.push[0].userIds), ELIGIBLE_T1);
  assert.deepEqual(sorted(t.calls.push[1].userIds), ELIGIBLE_T2);
});

test('a late tier-1 retry after tier 2 never downgrades and re-sends nothing', async () => {
  const t = setup(); await t.send(TIER2);
  const late = await t.send(TIER1);
  assert.equal(late.json.tier, 2);
  assert.equal(t.calls.telegram.length, 1); assert.equal(t.calls.push.length, 1);
});

test('FAILED Telegram is retried by a LATER request (not the same one), then stops once it succeeds', async () => {
  const providers = { telegram: '500' }; const t = setup({ providers });
  await t.send();
  assert.equal(t.calls.telegram.length, 1);
  assert.equal(t.backend.rows('telegram_station')[0].status, 'failed');
  providers.telegram = 'ok';
  await t.send();
  assert.equal(t.calls.telegram.length, 2, 'retried on the next request');
  assert.equal(t.backend.rows('telegram_station')[0].status, 'sent');
  await t.send();
  assert.equal(t.calls.telegram.length, 2, 'not re-sent once recorded as sent');
});

test('retry budget: a persistently failing Telegram is attempted at most 3 times', async () => {
  const t = setup({ providers: { telegram: '500' } });
  for (let i = 0; i < 6; i++) await t.send();
  assert.equal(t.calls.telegram.length, 3);
});

test('NON-retryable provider errors (403 bot blocked / bad chat) are not retried', async () => {
  const t = setup({ providers: { telegram: '403' } });
  await t.send(); await t.send(); await t.send();
  assert.equal(t.calls.telegram.length, 1);
  const row = t.backend.rows('telegram_station')[0];
  assert.deepEqual([row.status, row.retryable, row.provider_status], ['failed', false, '403']);
});

test('429 / 5xx from Telegram are retryable; the status is recorded', async () => {
  const t = setup({ providers: { telegram: '429' } }); await t.send();
  assert.deepEqual([t.backend.rows('telegram_station')[0].retryable, t.backend.rows('telegram_station')[0].provider_status], [true, '429']);
});

test('push outcomes are recorded per recipient; only the failed recipient is retried', async () => {
  const providers = { pushResults: { 'resp-ok': { status: 'failed', provider_status: '500', retryable: true, error: 'x' }, 'res-ok': { status: 'skipped', error: 'no push subscription', retryable: false } } };
  const t = setup({ providers });
  await t.send();
  const byUser = Object.fromEntries(t.backend.rows('push').map((r) => [r.recipient, r.status]));
  assert.deepEqual(byUser, { 'admin-ok': 'sent', 'resp-ok': 'failed', 'res-ok': 'skipped' });
  providers.pushResults = {};
  await t.send();
  assert.equal(t.calls.push.length, 2);
  assert.deepEqual(t.calls.push[1].userIds, ['resp-ok'], 'only the failed, retryable recipient is sent again');
});

test('a push service that is unreachable marks every claimed recipient failed (retryable)', async () => {
  const t = setup({ providers: { push: '500' } });
  const { res } = await t.send();
  assert.equal(res.status, 200, 'the alert itself is unaffected');
  assert.ok(t.backend.rows('push').every((r) => r.status === 'failed' && r.retryable));
});

test('an older send-push-notification without per-recipient results is treated as sent (outcome unknown)', async () => {
  const t = setup({ providers: { pushLegacy: true } }); await t.send();
  assert.ok(t.backend.rows('push').every((r) => r.status === 'sent' && r.provider_status === 'unknown'));
});

test('HANGING Telegram: the response is returned within the budget and the incident is already recorded', async () => {
  const t = setup({ providers: { telegram: 'hang' } });
  const t0 = Date.now(); const { res, json } = await t.send(); const ms = Date.now() - t0;
  assert.equal(res.status, 200); assert.ok(json.alert_event_id);
  assert.ok(ms < 1500, `took ${ms} ms`);
  assert.equal(t.backend.incidents.length, 1);
  assert.equal(t.backend.rows('telegram_station')[0].status, 'failed', 'the provider timeout is recorded as a retryable failure');
  assert.equal(t.calls.push.length, 1, 'push is not blocked by a hung Telegram');
});

test('HANGING push does not delay or break the alert either', async () => {
  const t = setup({ providers: { push: 'hang' } });
  const t0 = Date.now(); const { res } = await t.send();
  assert.equal(res.status, 200); assert.ok(Date.now() - t0 < 1500);
  assert.equal(t.calls.telegram.length, 1);
});

test('a stale pending claim (sender died before recording) is reclaimed: AT-LEAST-ONCE means a duplicate is possible', async () => {
  const t = setup({ providers: { telegram: 'hang' } });
  // simulate a sender that crashed after claiming and never recorded an outcome
  await t.send();
  const row = t.backend.rows('telegram_station')[0]; row.status = 'pending'; row.claimed_at = Date.now() - 5 * 60 * 1000;
  await t.send();
  assert.equal(t.calls.telegram.length, 2, 'reclaimed and sent again');
});

test('FAIL-OPEN: if the ledger is unavailable the notifications are sent anyway', async () => {
  const t = setup({ backendSetup: (b) => { b.failClaim = { code: 'XX000', message: 'ledger down' }; } });
  const { res } = await t.send();
  assert.equal(res.status, 200);
  assert.equal(t.calls.telegram.length, 1); assert.equal(t.calls.push.length, 1);
});

test('INCIDENT CANNOT BE RECORDED: still attempts the station notifications, then reports a retryable 500', async () => {
  const t = setup({ backendSetup: (b) => { b.failRaise = { code: 'XX000', message: 'db down' }; } });
  const { res, json } = await t.send();
  assert.equal(res.status, 500); assert.equal(json.code, 'persist_failed');
  assert.equal(t.calls.telegram.length, 1, 'emergency notification still attempted');
  assert.equal(t.calls.push.length, 1);
  assert.ok(!JSON.stringify(json).includes('db down'), 'database text is not leaked');
});

test('...and a device retrying during the outage does not spam: unrecorded notifications are de-duplicated in memory', async () => {
  const t = setup({ tables: { profiles: withAdminChat }, backendSetup: (b) => { b.failRaise = { code: 'XX000', message: 'db down' }; } });
  await t.send(); await t.send(); await t.send();
  assert.equal(t.calls.telegram.length, 2, 'station + admin chat, once');
  await t.send(TIER1);   // a different tier is a different event (admin chat only: the station chat is Tier 2 only)
  assert.equal(t.calls.telegram.length, 3);
});

test('LEGACY fallback while the 5.1 migrations are not applied: records the incident the old way, flags it, still dedupes', async () => {
  const t = setup({ backendSetup: (b) => { b.missing = true; } });
  const a = await t.send(); const b = await t.send();
  assert.equal(a.res.status, 200); assert.equal(a.json.persistence, 'legacy');
  assert.equal(t.db.tables.alert_events.length, 1, 'exactly one row: the second request updated it');
  assert.equal(a.json.alert_event_id, b.json.alert_event_id);
  assert.equal(a.json.created, true); assert.equal(b.json.created, false);
  assert.equal(t.calls.telegram.length, 2, 'without the ledger there is no notification dedupe (previous behaviour)');
});

test('ALERT_STRICT_DB=1 refuses the legacy fallback (500, nothing written to alert_events)', async () => {
  const t = setup({ env: { ALERT_STRICT_DB: '1' }, backendSetup: (b) => { b.missing = true; } });
  const { res, json } = await t.send();
  assert.equal(res.status, 500); assert.equal(json.code, 'persist_failed');
  assert.equal(t.db.tables.alert_events.length, 0);
});

test('every claim is for an ELIGIBLE recipient only (Step 2 rule preserved on the ledger path)', async () => {
  const t = setup(); await t.send();
  const claimed = t.backend.rows('push').map((r) => r.recipient);
  assert.deepEqual(sorted(claimed), ELIGIBLE_T2);
  assert.ok(!claimed.includes('resp-pending') && !claimed.includes('res-other'));
});

test('the push topic is a valid, per-alert, per-tier value (lets a push service collapse undelivered duplicates)', async () => {
  const t = setup(); await t.send(TIER1); await t.send(TIER2);
  const [a, b] = t.calls.push.map((p) => p.topic);
  assert.match(a, /^[A-Za-z0-9_-]{1,32}$/); assert.match(b, /^[A-Za-z0-9_-]{1,32}$/);
  assert.notEqual(a, b);
});

test('the push opens the alert in the app: a same-site /alert link for the alerting device, on both tiers', async () => {
  const t = setup(); await t.send(TIER1); await t.send(TIER2);
  for (const p of t.calls.push) assert.equal(p.url, `/alert?device=${device.id}`);
});

test('telegram_sent on the incident is set after a successful station notification only', async () => {
  const ok = setup(); await ok.send();
  assert.ok(ok.db.log.some((l) => l.table === 'alert_events' && l.op === 'update' && l.payload?.telegram_sent === true));
  const bad = setup({ providers: { telegram: '500' } }); await bad.send();
  assert.ok(!bad.db.log.some((l) => l.table === 'alert_events' && l.op === 'update' && l.payload?.telegram_sent === true));
});

test('Telegram not configured: no claim, no call, alert unaffected', async () => {
  const t = setup({ env: { TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' } });
  const { res } = await t.send();
  assert.equal(res.status, 200); assert.equal(t.calls.telegram.length, 0); assert.equal(t.backend.rows('telegram_station').length, 0);
});

// ---- contract with the firmware and status codes ----
test('response keeps every field the firmware parses; extra fields are additive; triggered_at is the incident time', async () => {
  const t = setup(); const { json } = await t.send(TIER2);
  for (const k of ['success', 'alert_event_id', 'owner_contact', 'bfp_contact', 'address_resolved', 'triggered_at']) assert.ok(k in json, k);
  assert.equal(json.owner_contact, '09111111111'); assert.equal(json.bfp_contact, '09999999999');
  assert.equal(json.triggered_at, '2026-10-12 03:04:05');
  assert.deepEqual([json.created, json.tier, json.persistence], [true, 2, 'raise_alert']);
});

test('notification TEXT is unchanged', async () => {
  const t = setup(); await t.send(TIER2);
  assert.match(t.calls.telegram[0].text, /^FIRE ALERT — Tier 2\n\nDevice: T-001\nLocation: Registered Loc\nTime: \d{4}-\d\d-\d\d \d\d:\d\d:\d\d\n\nSensor readings:\n- CO: 500 ppm \(threshold: 200 ppm\)\n- Temp: 90°C \(threshold: 60°C\)\n\nGPS: Unavailable\n\nSMS alerts have been dispatched\.$/);
  const t1 = setup({ tables: { profiles: withAdminChat } }); await t1.send(TIER1);
  assert.match(t1.calls.telegram[0].text, /^WARNING — Tier 1\n\nDevice: T-001\n.*\n\nElevated reading detected:\n- CO: 500 ppm \(threshold: 200 ppm\)\n- Temp: 20°C \(threshold: 60°C\)\n\nMonitor the area\. No SMS dispatched at this level\.$/s);
  assert.equal(t.calls.push[0].title, 'FIRE ALERT - Tier 2');
  assert.equal(t.calls.push[0].body, 'Device: T-001\nLocation: Registered Loc');
});

test('status codes: 401 auth, 400 validation (with a machine-readable code), 500 only for server faults', async () => {
  const t = setup();
  assert.equal((await t.send(TIER2, {})).res.status, 401);
  assert.equal((await t.send(TIER2, { 'x-device-key': 'wrong' })).res.status, 401);
  const below = await t.send({ co_ppm: 10, temp_celsius: 20, gps_valid: false });
  assert.deepEqual([below.res.status, below.json.code], [400, 'below_threshold']);
  const bad = await t.send({ co_ppm: 'x', temp_celsius: 20 });
  assert.deepEqual([bad.res.status, bad.json.code], [400, 'invalid_payload']);
  const coords = await t.send({ co_ppm: 500, temp_celsius: 90, gps_valid: true });
  assert.deepEqual([coords.res.status, coords.json.code], [400, 'invalid_payload']);
  assert.equal(t.backend.incidents.length, 0, 'no incident for rejected input');
});

test('invalid JSON -> 400; inactive device -> 401', async () => {
  const t = setup();
  const res = await t.handler(new Request('http://x', { method: 'POST', headers: { 'x-device-key': 'k', 'content-type': 'application/json' }, body: '{nope' }));
  assert.equal(res.status, 400);
  const off = setup({ tables: { devices: [{ ...device, is_active: false }] } });
  assert.equal((await off.send()).res.status, 401);
});

test('a DATABASE FAULT during device lookup is a retryable 500, not an authentication failure', async () => {
  const t = setup();
  const realFrom = t.db.from.bind(t.db);
  t.db.from = (table) => { const b = realFrom(table); if (table === 'devices') { b.maybeSingle = async () => ({ data: null, error: { code: '08006', message: 'connection failure' } }); } return b; };
  const { res, json } = await t.send();
  assert.deepEqual([res.status, json.code], [500, 'device_lookup_failed']);
});

test('an unexpected exception is a generic 500 that does not leak internals', async () => {
  const t = setup();
  const realFrom = t.db.from.bind(t.db);
  t.db.from = (table) => { if (table === 'profiles') throw new Error('secret internal detail'); return realFrom(table); };
  const { res, json } = await t.send(TIER2);
  assert.equal(res.status, 500); assert.equal(json.code, 'internal');
  assert.ok(!JSON.stringify(json).includes('secret internal detail'));
});

// ---- no GPS from the device: registered install pin (location_verified, 20261102000000) ----
const pinned = (extra) => ({ devices: [{ ...device, latitude: 14.8447, longitude: 120.8112, ...extra }] });

test('no GPS + admin-confirmed registered pin: pin and navigate link are sent, labelled confirmed', async () => {
  const t = setup({ tables: pinned({ location_verified: true }) }); await t.send(TIER2);
  assert.match(t.calls.telegram[0].text, /\n\nGPS: Unavailable\nRegistered pin: 14\.8447, 120\.8112 \(confirmed by admin\)\nNavigate: https:\/\/maps\.google\.com\/\?q=14\.8447,120\.8112\n\nSMS alerts/);
});

test('no GPS + resident pin not yet confirmed: still sent, labelled UNVERIFIED', async () => {
  const t = setup({ tables: pinned({ location_verified: false }) }); await t.send(TIER2);
  assert.match(t.calls.telegram[0].text, /Registered pin: 14\.8447, 120\.8112 \(UNVERIFIED — set by resident, not yet confirmed by an admin\)\nNavigate: /);
});

test('device GPS wins over the registered pin', async () => {
  const t = setup({ tables: pinned({ location_verified: true }) });
  await t.send({ co_ppm: 500, temp_celsius: 90, gps_valid: true, latitude: 14.9, longitude: 120.9 });
  assert.match(t.calls.telegram[0].text, /\nGPS: 14\.9, 120\.9\n/);
  assert.doesNotMatch(t.calls.telegram[0].text, /Registered pin/);
});

test('no address set yet: location reads "Location not set"', async () => {
  const t = setup({ tables: { devices: [{ ...device, location_desc: null }] } }); await t.send(TIER2);
  assert.match(t.calls.telegram[0].text, /\nLocation: Location not set\n/);
  assert.equal(t.calls.push[0].body, 'Device: T-001\nLocation: Location not set');
});

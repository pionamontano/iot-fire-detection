// Step 5.2 INTEGRATION: the real trigger-alert handler driving the REAL SQL functions in a local PostgreSQL.
// Skipped unless AGAP_PG_DB names a local test database built from supabase/migrations (see run_integration.sh).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb, loadHandler, req } from './harness.mjs';
import { makeFetch, device, profiles, TIER1, TIER2 } from './delivery_helpers.mjs';
import { pgBackend } from './pg_backend.mjs';

const DB = process.env.AGAP_PG_DB;
const skip = DB ? false : 'AGAP_PG_DB not set (run tests/edge/run_integration.sh against a local PostgreSQL)';
const RESP = '00000000-0000-0000-0000-0000000000c1';

function setup(providers = {}, extraEnv = {}) {
  const events = []; const pg = pgBackend(DB, events);
  const db = new FakeDb({ devices: [device], profiles, alert_events: [] }, { rpc: pg.impl });
  const { fetchImpl, calls } = makeFetch(events, providers);
  const handler = loadHandler('trigger-alert', { db, fetchImpl, env: { SUPABASE_URL: 'http://local', SUPABASE_SERVICE_ROLE_KEY: 'srv', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c', ALERT_DISPATCH_BUDGET_MS: '3000', ALERT_PROVIDER_TIMEOUT_MS: '2500', ...extraEnv } });
  const send = async (p = TIER2) => { const res = await handler(req(p, { 'x-device-key': 'k' })); return { res, json: await res.json() }; };
  return { pg, calls, send, events };
}
const reset = async (pg) => { await pg.q(`delete from alert_events where device_id='${device.id}'`); };

test('REAL SQL: replay x3 -> one incident, one Telegram, one push, ledger rows recorded as sent', { skip }, async () => {
  const t = setup(); await reset(t.pg);
  const a = await t.send(); await t.send(); await t.send();
  assert.equal(a.res.status, 200);
  assert.equal(await t.pg.q(`select count(*) from alert_events where device_id='${device.id}' and resolved_at is null`), '1');
  assert.equal(t.calls.telegram.length, 1); assert.equal(t.calls.push.length, 1);
  assert.equal(await t.pg.q(`select string_agg(channel||':'||status||':'||attempts, ',' order by channel, recipient_key) from alert_notifications where alert_event_id='${a.json.alert_event_id}'`),
    'push:sent:1,push:sent:1,push:sent:1,telegram_station:sent:1');
  assert.equal(await t.pg.q(`select provider_ref from alert_notifications where channel='telegram_station' and alert_event_id='${a.json.alert_event_id}'`), '4242', 'Telegram message id recorded');
});

test('REAL SQL: 20 CONCURRENT requests -> exactly one incident, one Telegram, every recipient pushed exactly once', { skip }, async () => {
  const t = setup(); await reset(t.pg);
  const all = await Promise.all(Array.from({ length: 20 }, () => t.send()));
  assert.ok(all.every((r) => r.res.status === 200), all.map((r) => r.res.status).join(','));
  assert.equal(new Set(all.map((r) => r.json.alert_event_id)).size, 1);
  assert.equal(all.filter((r) => r.json.created).length, 1);
  assert.equal(await t.pg.q(`select count(*) from alert_events where device_id='${device.id}' and resolved_at is null`), '1');
  assert.equal(t.calls.telegram.length, 1, 'Telegram sent once despite 20 racing requests');
  // Racing requests may win the per-recipient claims for DIFFERENT users, so push can go out in several smaller calls.
  // The invariant is per recipient: every eligible user is notified exactly once, never twice.
  const pushed = t.calls.push.flatMap((c) => c.userIds).sort();
  assert.deepEqual(pushed, ['admin-ok', 'res-ok', 'resp-ok'], 'each eligible recipient exactly once');
  const id = all[0].json.alert_event_id;
  assert.equal(await t.pg.q(`select count(*) from alert_notifications where channel='telegram_station' and alert_event_id='${id}'`), '1', 'one ledger row for the station chat');
  assert.equal(await t.pg.q(`select count(*)||':'||max(attempts) from alert_notifications where channel='push' and alert_event_id='${id}'`), '3:1', 'one row per recipient, each claimed exactly once');
});

test('REAL SQL: escalation 1 -> 2 keeps one incident, notifies once per tier', { skip }, async () => {
  const t = setup(); await reset(t.pg);
  const one = await t.send(TIER1); const two = await t.send(TIER2); await t.send(TIER2); await t.send(TIER1);
  assert.equal(one.json.alert_event_id, two.json.alert_event_id);
  assert.equal(await t.pg.q(`select alert_tier from alert_events where id='${one.json.alert_event_id}'`), '2');
  assert.equal(t.calls.telegram.length, 2);
  assert.equal(await t.pg.q(`select string_agg(tier::text, ',' order by tier) from alert_notifications where channel='telegram_station' and alert_event_id='${one.json.alert_event_id}'`), '1,2');
});

test('REAL SQL: failed Telegram is retried by the next request, up to 3 attempts, 403 never', { skip }, async () => {
  const providers = { telegram: '500' }; const t = setup(providers); await reset(t.pg);
  const a = await t.send();
  assert.equal(await t.pg.q(`select status||':'||retryable||':'||provider_status from alert_notifications where channel='telegram_station' and alert_event_id='${a.json.alert_event_id}'`), 'failed:true:500');
  providers.telegram = 'ok'; await t.send();
  assert.equal(await t.pg.q(`select status||':'||attempts from alert_notifications where channel='telegram_station' and alert_event_id='${a.json.alert_event_id}'`), 'sent:2');
  const b = setup({ telegram: '403' }); await reset(b.pg);
  const c = await b.send(); await b.send(); await b.send();
  assert.equal(b.calls.telegram.length, 1);
  assert.equal(await b.pg.q(`select status||':'||retryable from alert_notifications where channel='telegram_station' and alert_event_id='${c.json.alert_event_id}'`), 'failed:false');
});

test('REAL SQL: AT-LEAST-ONCE - a stale pending claim is re-sent (a duplicate is possible by design)', { skip }, async () => {
  const providers = { telegram: 'hang' }; const t = setup(providers, { ALERT_DISPATCH_BUDGET_MS: '300', ALERT_PROVIDER_TIMEOUT_MS: '200' }); await reset(t.pg);
  const a = await t.send();
  // provider timeout is recorded as a retryable failure; simulate the sender that died before recording anything instead
  await t.pg.q(`update alert_notifications set status='pending', claimed_at = now() - interval '5 minutes' where channel='telegram_station' and alert_event_id='${a.json.alert_event_id}'`);
  providers.telegram = 'ok'; await t.send();
  assert.equal(t.calls.telegram.length, 2);
  assert.equal(await t.pg.q(`select status||':'||attempts from alert_notifications where channel='telegram_station' and alert_event_id='${a.json.alert_event_id}'`), 'sent:2');
});

test('REAL SQL + lifecycle: after a responder closes the incident (transition_incident) the next fire is a NEW incident with its own notifications', { skip }, async () => {
  const t = setup(); await reset(t.pg);
  const first = await t.send();
  await t.pg.q(`select set_config('request.jwt.claim.sub','${RESP}',false); select transition_incident('${first.json.alert_event_id}','acknowledged'); select transition_incident('${first.json.alert_event_id}','resolved')`);
  const second = await t.send();
  assert.notEqual(second.json.alert_event_id, first.json.alert_event_id);
  assert.equal(second.json.created, true);
  assert.equal(t.calls.telegram.length, 2, 'the new incident is announced');
});

test('REAL SQL: a LEGACY row closed by status only (pre-guard data) does not absorb a new fire', { skip }, async () => {
  const t = setup(); await reset(t.pg);
  const first = await t.send();
  await t.pg.q(`alter table alert_events disable trigger alert_events_lifecycle_guard; alter table alert_events drop constraint if exists alert_events_lifecycle_sync; update alert_events set incident_status='resolved' where id='${first.json.alert_event_id}'; alter table alert_events enable trigger alert_events_lifecycle_guard`);
  assert.equal(await t.pg.q(`select resolved_at is null from alert_events where id='${first.json.alert_event_id}'`), 't');
  const second = await t.send();
  assert.notEqual(second.json.alert_event_id, first.json.alert_event_id);
  assert.equal(await t.pg.q(`select count(*) from alert_events where device_id='${device.id}' and resolved_at is null`), '1');
});

test('REAL SQL: a raise_alert FAILURE (invalid device) is a retryable 500 and the station notification is still attempted', { skip }, async () => {
  const events = []; const pg = pgBackend(DB, events);
  const ghost = { ...device, id: '10000000-0000-0000-0000-0000000000ff' };       // device unknown to the database -> FK violation (23503)
  const db = new FakeDb({ devices: [ghost], profiles, alert_events: [] }, { rpc: pg.impl });
  const { fetchImpl, calls } = makeFetch(events, {});
  const handler = loadHandler('trigger-alert', { db, fetchImpl, env: { SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 's', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c', ALERT_DISPATCH_BUDGET_MS: '1000', ALERT_PROVIDER_TIMEOUT_MS: '800' } });
  const res = await handler(req(TIER2, { 'x-device-key': 'k' }));
  assert.equal(res.status, 500); assert.equal((await res.json()).code, 'persist_failed');
  assert.equal(calls.telegram.length, 1);
});

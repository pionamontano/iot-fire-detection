// Shared test doubles for the Step 5.2 delivery tests. The in-memory backend models the SEMANTICS of the SQL functions
// (raise_alert / claim_notification / complete_notification); the real SQL is tested separately in supabase/tests/local
// and, end to end, in trigger_alert_pg.test.mjs. Nothing here touches a network or sends anything.
import { FakeDb, loadHandler, req } from './harness.mjs';

export const DEV = '10000000-0000-0000-0000-000000000001';
export const device = { id: DEV, device_code: 'T-001', location_desc: 'Registered Loc', is_active: true, co_threshold: 200, temp_threshold: 60, bfp_contact: '09999999999', api_key: 'k' };
export const profiles = [
  { id: 'admin-ok',      role: 'admin',         status: 'approved', is_active: true,  device_id: null, contact_number: '09000000001' },
  { id: 'resp-ok',       role: 'bfp_responder', status: 'approved', is_active: true,  device_id: null, contact_number: '09000000003' },
  { id: 'resp-pending',  role: 'bfp_responder', status: 'pending',  is_active: true,  device_id: null, contact_number: '09000000004' },
  { id: 'res-ok',        role: 'resident',      status: 'approved', is_active: true,  device_id: DEV,  contact_number: '09111111111' },
  { id: 'res-other',     role: 'resident',      status: 'approved', is_active: true,  device_id: '10000000-0000-0000-0000-000000000002', contact_number: '09222222222' },
];

export class MemoryBackend {
  constructor(events) {
    this.events = events; this.incidents = []; this.ledger = new Map(); this.n = 0;
    this.failRaise = null;      // e.g. { code: 'XX000', message: 'db down' }
    this.failClaim = null;      // makes claim_notification return an error
    this.missing = false;       // behave like "function not found"
    this.calls = { raise: 0, claim: 0, complete: 0 };
  }
  key = (a) => [a.p_alert, a.p_tier, a.p_channel, a.p_recipient].join('|');
  age(match, ms) { for (const [k, row] of this.ledger) if (k.includes(match)) row.claimed_at -= ms; }
  rows(channel) { return [...this.ledger.values()].filter((r) => !channel || r.channel === channel); }
  impl = async (fn, a) => {
    this.events.push({ t: 'rpc', fn });
    if (this.missing) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    if (fn === 'raise_alert') {
      this.calls.raise++;
      if (this.failRaise) return { data: null, error: this.failRaise };
      let inc = this.incidents.find((i) => i.device_id === a.p_device_id && !i.resolved_at);
      let created = false;
      if (!inc) { inc = { id: `inc-${++this.n}`, device_id: a.p_device_id, tier: a.p_tier, triggered_at: new Date('2026-10-12T03:04:05Z').toISOString() }; this.incidents.push(inc); created = true; }
      else inc.tier = Math.max(inc.tier, a.p_tier);
      return { data: [{ alert_id: inc.id, created, tier: inc.tier, triggered_at: inc.triggered_at }], error: null };
    }
    if (fn === 'claim_notification') {
      this.calls.claim++;
      if (this.failClaim) return { data: null, error: this.failClaim };
      const k = this.key(a); const row = this.ledger.get(k);
      if (!row) { this.ledger.set(k, { channel: a.p_channel, recipient: a.p_recipient, tier: a.p_tier, status: 'pending', retryable: true, attempts: 1, claimed_at: Date.now() }); return { data: true, error: null }; }
      const stale = row.status === 'pending' && row.claimed_at < Date.now() - 120000;
      if (row.attempts < 3 && ((row.status === 'failed' && row.retryable) || stale)) { row.attempts++; row.status = 'pending'; row.claimed_at = Date.now(); return { data: true, error: null }; }
      return { data: false, error: null };
    }
    if (fn === 'complete_notification') {
      this.calls.complete++;
      const row = this.ledger.get(this.key(a));
      if (row) { row.status = a.p_status; row.provider_status = a.p_provider_status; row.error = a.p_error; if (a.p_status === 'failed') row.retryable = a.p_retryable; }
      return { data: null, error: null };
    }
    return { data: null, error: { code: 'PGRST202', message: 'unknown function' } };
  };
}

// provider behaviours: telegram: ok|500|403|429|hang|throw   push: ok|500|hang|throw  (pushResults overrides per-user outcomes)
export function makeFetch(events, mode) {
  const calls = { telegram: [], push: [] };
  const hang = (init) => new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))));
  const fetchImpl = async (url, init) => {
    const u = String(url);
    if (u.includes('api.telegram.org')) {
      events.push({ t: 'telegram' }); const body = JSON.parse(init.body); calls.telegram.push(body);
      const m = mode.telegram ?? 'ok';
      if (m === 'hang') return hang(init);
      if (m === 'throw') throw new Error('connection reset');
      if (m === 'ok') return new Response(JSON.stringify({ ok: true, result: { message_id: 4242 } }), { status: 200 });
      return new Response('{}', { status: Number(m) });
    }
    if (u.includes('send-push-notification')) {
      events.push({ t: 'push' }); const body = JSON.parse(init.body); calls.push.push(body);
      const m = mode.push ?? 'ok';
      if (m === 'hang') return hang(init);
      if (m === 'throw') throw new Error('connection reset');
      if (m === '500') return new Response('{}', { status: 500 });
      if (mode.pushLegacy) return new Response(JSON.stringify({ success: true, sentCount: body.userIds.length }), { status: 200 });
      const results = body.userIds.map((id) => (mode.pushResults?.[id] ?? { status: 'sent', provider_status: '201' })).map((r, i) => ({ userId: body.userIds[i], ...r }));
      return new Response(JSON.stringify({ success: true, results }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
  return { fetchImpl, calls };
}

export function setup({ providers = {}, env = {}, tables = {}, backendSetup } = {}) {
  const events = [];
  const backend = new MemoryBackend(events);
  backendSetup?.(backend);
  const db = new FakeDb({ devices: [device], profiles, alert_events: [], ...tables }, { rpc: backend.impl });
  const { fetchImpl, calls } = makeFetch(events, providers);
  const fullEnv = {
    SUPABASE_URL: 'http://local', SUPABASE_SERVICE_ROLE_KEY: 'srv', TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: 'chat',
    ALERT_DISPATCH_BUDGET_MS: '400', ALERT_PROVIDER_TIMEOUT_MS: '250', ...env,
  };
  const handler = loadHandler('trigger-alert', { db, env: fullEnv, fetchImpl });
  const send = async (payload = { co_ppm: 500, temp_celsius: 90, gps_valid: false }, headers = { 'x-device-key': 'k' }) => {
    const res = await handler(req(payload, headers));
    return { res, json: await res.json().catch(() => null) };
  };
  return { handler, db, backend, calls, events, send };
}
export const TIER1 = { co_ppm: 500, temp_celsius: 20, gps_valid: false };
export const TIER2 = { co_ppm: 500, temp_celsius: 90, gps_valid: false };

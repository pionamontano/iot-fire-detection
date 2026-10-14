// resolve-support-request: admin resolves / reopens a support request and the requester is told.
// Real handler, in-memory DB, stubbed fetch (nothing is sent anywhere).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb, loadHandler, req } from './harness.mjs';

const ADMIN = { id: 'admin-1', role: 'admin', status: 'approved', is_active: true };
const requester = (over = {}) => ({ id: 'res-1', role: 'resident', status: 'approved', is_active: true, telegram_chat_id: 'chat-res', ...over });
const request = (over = {}) => ({ id: 'sr-1', user_id: 'res-1', category: 'Role Change', status: 'open', admin_notes: null, reviewed_by: null, reviewed_at: null, ...over });

function setup({ caller = ADMIN, profiles = [requester()], requests = [request()], env = {}, pushStatus = 200 } = {}) {
  const db = new FakeDb({ profiles: [caller, ...profiles], support_requests: requests });
  const calls = { telegram: [], push: [] };
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    if (String(url).includes('api.telegram.org')) { calls.telegram.push(body); return new Response('{}', { status: 200 }); }
    if (String(url).includes('send-push-notification')) {
      calls.push.push(body);
      return new Response(JSON.stringify({ success: true, results: body.userIds.map((userId) => ({ userId, status: 'sent' })) }), { status: pushStatus });
    }
    throw new Error('unexpected fetch ' + url);
  };
  const handler = loadHandler('resolve-support-request', {
    db, fetchImpl, user: { id: caller.id },
    env: { SUPABASE_URL: 'http://sb', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's', TELEGRAM_BOT_TOKEN: 'tok', ...env },
  });
  const call = (body) => handler(req(body, { Authorization: 'Bearer t' }));
  const row = () => db.tables.support_requests[0];
  return { call, calls, row };
}

test('non-admins are refused and nothing changes', async () => {
  const t = setup({ caller: { id: 'res-9', role: 'resident', status: 'approved', is_active: true } });
  assert.equal((await t.call({ request_id: 'sr-1', status: 'resolved' })).status, 403);
  assert.equal(t.row().status, 'open');
});

test('resolving saves the note and reviewer, and messages the requester on Telegram and push', async () => {
  const t = setup();
  const res = await t.call({ request_id: 'sr-1', status: 'resolved', admin_notes: '  Role changed to BFP Responder ' });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).notified, { telegram: 'sent', push: 'sent' });
  assert.equal(t.row().status, 'resolved');
  assert.equal(t.row().admin_notes, 'Role changed to BFP Responder');
  assert.equal(t.row().reviewed_by, 'admin-1');
  assert.equal(t.calls.telegram.length, 1);
  assert.equal(t.calls.telegram[0].chat_id, 'chat-res');
  assert.match(t.calls.telegram[0].text, /Role Change.*resolved[\s\S]*Role changed to BFP Responder/);
  assert.deepEqual(t.calls.push[0].userIds, ['res-1']);
  assert.equal(t.calls.push[0].url, '/account', 'the push opens their My Requests list');
});

test('resolving an already-resolved request only updates the note and never re-notifies', async () => {
  const t = setup({ requests: [request({ status: 'resolved', admin_notes: 'old', reviewed_by: 'admin-0' })] });
  const res = await t.call({ request_id: 'sr-1', status: 'resolved', admin_notes: 'new' });
  assert.equal(res.status, 200);
  assert.equal(t.row().admin_notes, 'new');
  assert.equal(t.row().reviewed_by, 'admin-0');
  assert.equal(t.calls.telegram.length + t.calls.push.length, 0);
});

test('no Telegram link, or no bot token, is reported and does not block the resolve', async () => {
  const t = setup({ profiles: [requester({ telegram_chat_id: null })] });
  assert.equal((await (await t.call({ request_id: 'sr-1', status: 'resolved' })).json()).notified.telegram, 'not_linked');
  const t2 = setup({ env: { TELEGRAM_BOT_TOKEN: '' } });
  assert.equal((await (await t2.call({ request_id: 'sr-1', status: 'resolved' })).json()).notified.telegram, 'not_configured');
  assert.equal(t2.row().status, 'resolved');
});

test('a deactivated requester is not messaged', async () => {
  const t = setup({ profiles: [requester({ is_active: false })] });
  assert.equal((await t.call({ request_id: 'sr-1', status: 'resolved' })).status, 200);
  assert.equal(t.row().status, 'resolved');
  assert.equal(t.calls.telegram.length + t.calls.push.length, 0);
});

test('reopening clears the reviewer and sends nothing', async () => {
  const t = setup({ requests: [request({ status: 'resolved', reviewed_by: 'admin-1', reviewed_at: '2026-10-01' })] });
  assert.equal((await t.call({ request_id: 'sr-1', status: 'open' })).status, 200);
  assert.equal(t.row().status, 'open');
  assert.equal(t.row().reviewed_by, null);
  assert.equal(t.calls.telegram.length + t.calls.push.length, 0);
});

test('bad input is rejected', async () => {
  const t = setup();
  assert.equal((await t.call({ status: 'resolved' })).status, 400);
  assert.equal((await t.call({ request_id: 'sr-1', status: 'closed' })).status, 400);
  assert.equal((await t.call({ request_id: 'sr-1', status: 'resolved', admin_notes: 'x'.repeat(1001) })).status, 400);
  assert.equal((await t.call({ request_id: 'nope', status: 'resolved' })).status, 404);
  assert.equal(t.row().status, 'open');
});

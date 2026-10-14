// admin-support-request: a user files a request; every approved, active admin is told (push + linked Telegram).
// Real handler, in-memory DB, stubbed fetch (nothing is sent anywhere).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb, loadHandler, req } from './harness.mjs';

const USER = { id: 'res-1', full_name: 'Juan Dela Cruz', role: 'resident', status: 'approved', is_active: true, contact_number: '09171234567' };
const admins = [
  { id: 'adm-tg', role: 'admin', status: 'approved', is_active: true, telegram_chat_id: 'chat-adm' },
  { id: 'adm-push', role: 'admin', status: 'approved', is_active: true, telegram_chat_id: null },
  { id: 'adm-off', role: 'admin', status: 'approved', is_active: false, telegram_chat_id: 'chat-off' },
  { id: 'adm-pending', role: 'admin', status: 'pending', is_active: true, telegram_chat_id: 'chat-pending' },
];

function setup({ env = {}, failFetch = false } = {}) {
  const db = new FakeDb({ profiles: [USER, ...admins], support_requests: [] });
  const calls = { telegram: [], push: [] };
  const fetchImpl = async (url, init) => {
    if (failFetch) throw Object.assign(new Error('down'), { name: 'TypeError' });
    const body = JSON.parse(init.body);
    if (String(url).includes('api.telegram.org')) calls.telegram.push(body);
    else if (String(url).includes('send-push-notification')) calls.push.push(body);
    else throw new Error('unexpected fetch ' + url);
    return new Response('{}', { status: 200 });
  };
  const handler = loadHandler('admin-support-request', {
    db, fetchImpl, user: { id: USER.id, email: 'juan@x.com' },
    env: { SUPABASE_URL: 'http://sb', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's', TELEGRAM_BOT_TOKEN: 'tok', ...env },
  });
  const call = (body) => handler(req(body, { Authorization: 'Bearer t' }));
  return { db, call, calls };
}

test('saving a request pushes to every approved, active admin with a link to it', async () => {
  const t = setup();
  const res = await t.call({ category: 'Role Change', message: 'Please make me a responder' });
  assert.equal(res.status, 200);
  const saved = t.db.tables.support_requests[0];
  assert.equal(saved.user_id, 'res-1');
  assert.equal(t.calls.push.length, 1);
  assert.deepEqual(t.calls.push[0].userIds.sort(), ['adm-push', 'adm-tg']);
  assert.equal(t.calls.push[0].url, `/admin/support?request=${saved.id}`);
  assert.match(t.calls.push[0].body, /Juan Dela Cruz \(Resident\): Please make me a responder/);
});

test('only active admins with a linked chat get Telegram; the link is included only when APP_URL is set', async () => {
  const t = setup();
  await t.call({ category: 'Other', message: 'hi' });
  assert.deepEqual(t.calls.telegram.map((m) => m.chat_id), ['chat-adm']);
  assert.doesNotMatch(t.calls.telegram[0].text, /Open:/);

  const t2 = setup({ env: { APP_URL: 'https://agapsense.example/' } });
  await t2.call({ category: 'Other', message: 'hi' });
  const id = t2.db.tables.support_requests[0].id;
  assert.match(t2.calls.telegram[0].text, new RegExp(`Open: https://agapsense\\.example/admin/support\\?request=${id}$`));
});

test('a long message is shortened in notifications but saved in full', async () => {
  const t = setup();
  const long = 'x'.repeat(500);
  await t.call({ category: 'Other', message: long });
  assert.equal(t.db.tables.support_requests[0].message, long);
  assert.ok(t.calls.push[0].body.length < 260);
});

test('notification failures never fail the request (no duplicate resubmits)', async () => {
  const t = setup({ failFetch: true });
  const res = await t.call({ category: 'Other', message: 'hi' });
  assert.equal(res.status, 200);
  assert.equal(t.db.tables.support_requests.length, 1);
});

test('no bot token: push still goes out, Telegram is skipped', async () => {
  const t = setup({ env: { TELEGRAM_BOT_TOKEN: '' } });
  await t.call({ category: 'Other', message: 'hi' });
  assert.equal(t.calls.push.length, 1);
  assert.equal(t.calls.telegram.length, 0);
});

// Owner decision D5.5 (issue #95): a Telegram chat already linked to a different account is REFUSED,
// never silently moved. Real telegram-webhook handler, in-memory DB. No network, nothing is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb, loadHandler, req } from './harness.mjs';

const SECRET = 'whsec';
const TOKEN = 'a'.repeat(64);
const FUTURE = new Date(Date.now() + 60_000).toISOString();

function setup({ profiles = [], tokens = [], telegramOk = true } = {}) {
  const calls = [];
  const db = new FakeDb({ profiles, telegram_link_tokens: tokens });
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: telegramOk }), { status: telegramOk ? 200 : 403 });
  };
  const handler = loadHandler('telegram-webhook', {
    db, fetchImpl,
    env: { TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_BOT_TOKEN: 'tok', SUPABASE_URL: 'http://local', SUPABASE_SERVICE_ROLE_KEY: 'srv' },
  });
  const send = (chatId, token = TOKEN) => handler(req(
    { message: { chat: { id: chatId }, text: `/start ${token}` } },
    { 'X-Telegram-Bot-Api-Secret-Token': SECRET },
  ));
  return { db, calls, send };
}

test('a fresh link sets telegram_chat_id and consumes the one-time token', async () => {
  const { db, calls, send } = setup({
    profiles: [{ id: 'u1', telegram_chat_id: null }],
    tokens: [{ token: TOKEN, user_id: 'u1', expires_at: FUTURE }],
  });
  const res = await send(555);
  assert.equal(res.status, 200);
  assert.equal(db.tables.profiles[0].telegram_chat_id, '555');
  assert.equal(db.tables.telegram_link_tokens.length, 0, 'token consumed');
  assert.match(calls[0].text, /successfully linked/);
});

test('D5.5: a chat already linked to a DIFFERENT account is refused, not moved', async () => {
  const { db, calls, send } = setup({
    profiles: [
      { id: 'u1', telegram_chat_id: null },
      { id: 'u2', telegram_chat_id: '555' },
    ],
    tokens: [{ token: TOKEN, user_id: 'u1', expires_at: FUTURE }],
  });
  const res = await send(555);
  assert.equal(res.status, 200);
  assert.equal(db.tables.profiles.find((p) => p.id === 'u1').telegram_chat_id, null, 'u1 is not linked');
  assert.equal(db.tables.profiles.find((p) => p.id === 'u2').telegram_chat_id, '555', 'u2 keeps their link');
  assert.match(calls[0].text, /already linked to a different AgapSense account/);
});

test('re-linking the SAME chat to the SAME account (idempotent re-link) is allowed', async () => {
  const { db, calls, send } = setup({
    profiles: [{ id: 'u1', telegram_chat_id: '555' }],
    tokens: [{ token: TOKEN, user_id: 'u1', expires_at: FUTURE }],
  });
  const res = await send(555);
  assert.equal(res.status, 200);
  assert.equal(db.tables.profiles[0].telegram_chat_id, '555');
  assert.match(calls[0].text, /successfully linked/);
});

test('an expired or unknown token is rejected and nothing is linked', async () => {
  const { db, calls, send } = setup({
    profiles: [{ id: 'u1', telegram_chat_id: null }],
    tokens: [{ token: TOKEN, user_id: 'u1', expires_at: new Date(Date.now() - 1000).toISOString() }],
  });
  const res = await send(555);
  assert.equal(res.status, 200);
  assert.equal(db.tables.profiles[0].telegram_chat_id, null);
  assert.match(calls[0].text, /invalid or has expired/);
});

test('wrong secret token is rejected with 401 before touching the database', async () => {
  const db = new FakeDb({ profiles: [{ id: 'u1', telegram_chat_id: null }], telegram_link_tokens: [{ token: TOKEN, user_id: 'u1', expires_at: FUTURE }] });
  const handler = loadHandler('telegram-webhook', { db, env: { TELEGRAM_WEBHOOK_SECRET: SECRET, SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'y' } });
  const res = await handler(req({ message: { chat: { id: 555 }, text: `/start ${TOKEN}` } }, { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' }));
  assert.equal(res.status, 401);
  assert.equal(db.tables.profiles[0].telegram_chat_id, null);
});

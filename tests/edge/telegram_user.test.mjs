// Owner decision D5.4 (issue #95): per-user Telegram delivery, additive to the existing station chat.
// Real trigger-alert handler, in-memory backend + provider stubs (nothing is sent anywhere).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, TIER1, TIER2, DEV, device, profiles } from './delivery_helpers.mjs';

function withTelegramLinks(overrides) {
  return profiles.map((p) => (overrides[p.id] ? { ...p, telegram_chat_id: overrides[p.id] } : p));
}

test('an approved+active resident with a linked chat gets their own Telegram message on Tier 2, in addition to the station chat', async () => {
  const t = setup({ tables: { profiles: withTelegramLinks({ 'res-ok': 'chat-res-ok' }) } });
  await t.send(TIER2);
  assert.equal(t.calls.telegram.length, 2, 'station + one linked resident');
  const chatIds = t.calls.telegram.map((c) => c.chat_id).sort();
  assert.deepEqual(chatIds, ['chat', 'chat-res-ok']);
});

test('Tier 1: the resident is messaged on their own chat, the station chat is not (same role rule as push)', async () => {
  const t = setup({ tables: { profiles: withTelegramLinks({ 'res-ok': 'chat-res-ok', 'res-other': 'chat-other-device' }) } });
  await t.send(TIER1);
  const chatIds = t.calls.telegram.map((c) => c.chat_id);
  assert.deepEqual(chatIds, ['chat-res-ok'], 'the station chat is the fire station\'s: Tier 2 only');
});

test('Tier 1: only admins with a linked chat are messaged; BFP responders are not', async () => {
  const t = setup({ tables: { profiles: withTelegramLinks({ 'admin-ok': 'chat-admin', 'resp-ok': 'chat-resp' }) } });
  await t.send(TIER1);
  const chatIds = t.calls.telegram.map((c) => c.chat_id).sort();
  assert.deepEqual(chatIds, ['chat-admin']);
});

test('Tier 2: admins and responders with a linked chat are both messaged', async () => {
  const t = setup({ tables: { profiles: withTelegramLinks({ 'admin-ok': 'chat-admin', 'resp-ok': 'chat-resp' }) } });
  await t.send(TIER2);
  const chatIds = t.calls.telegram.map((c) => c.chat_id).sort();
  assert.deepEqual(chatIds, ['chat', 'chat-admin', 'chat-resp']);
});

test('a linked chat on a PENDING or INACTIVE account is never messaged', async () => {
  const t = setup({ tables: { profiles: withTelegramLinks({ 'resp-pending': 'chat-pending' }) } });
  await t.send(TIER2);
  assert.ok(!t.calls.telegram.some((c) => c.chat_id === 'chat-pending'));
});

test('a resident linked chat on a DIFFERENT device is never messaged for this device\'s alert', async () => {
  const t = setup({ tables: { profiles: withTelegramLinks({ 'res-other': 'chat-other-device' }) } });
  await t.send(TIER2);
  assert.ok(!t.calls.telegram.some((c) => c.chat_id === 'chat-other-device'));
});

test('REPLAY: a linked recipient is messaged once even if the device retries the same alert', async () => {
  const t = setup({ tables: { profiles: withTelegramLinks({ 'res-ok': 'chat-res-ok' }) } });
  await t.send(TIER2); await t.send(TIER2); await t.send(TIER2);
  assert.equal(t.calls.telegram.filter((c) => c.chat_id === 'chat-res-ok').length, 1);
});

test('no TELEGRAM_BOT_TOKEN configured: per-user Telegram is skipped entirely (fails closed, not open)', async () => {
  const t = setup({ env: { TELEGRAM_BOT_TOKEN: '' }, tables: { profiles: withTelegramLinks({ 'res-ok': 'chat-res-ok' }) } });
  await t.send(TIER2);
  assert.equal(t.calls.telegram.length, 0);
});

test('unchanged behaviour: no profile has a linked chat -> only the station chat is messaged (existing fixture)', async () => {
  const t = setup();
  await t.send(TIER2);
  assert.equal(t.calls.telegram.length, 1);
  assert.equal(t.calls.telegram[0].chat_id, 'chat');
});

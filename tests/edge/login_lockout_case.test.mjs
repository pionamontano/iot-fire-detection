// KI-26 (issue #111): login lockout must not be bypassable by varying the email's case. Real
// supabase/functions/login handler, in-memory DB + a fake GoTrue token endpoint. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb, loadHandler, req } from './harness.mjs';

// Mimics check_login_lockout()'s real behaviour closely enough for this test: an exact-match (case
// SENSITIVE, like the real `where email = p_email`) count of recent failures for p_email, locked once
// >= 3. This is deliberately simpler than the real tiered/time-decaying SQL function - only the
// case-sensitivity of the comparison matters here, not the exact thresholds.
function rpcImpl(fn, args, db) {
  if (fn !== 'check_login_lockout') return { data: null, error: { code: 'PGRST202', message: 'unknown function' } };
  const failures = (db.tables.login_attempts ?? []).filter((r) => r.email === args.p_email && r.success === false).length;
  return { data: [{ locked: failures >= 3, retry_after_seconds: failures >= 3 ? 10 : 0 }], error: null };
}

function setup({ wrongPassword = true } = {}) {
  const db = new FakeDb({ login_attempts: [] }, { rpc: rpcImpl });
  const fetchImpl = async (url) => {
    if (String(url).includes('/auth/v1/token')) {
      return wrongPassword
        ? new Response(JSON.stringify({ error_description: 'Invalid login credentials' }), { status: 400 })
        : new Response(JSON.stringify({ access_token: 'tok', refresh_token: 'rtok' }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
  const handler = loadHandler('login', { db, fetchImpl, env: { SUPABASE_URL: 'http://local', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'srv' } });
  const attempt = (email, password = 'wrong') => handler(req({ email, password }));
  return { db, attempt };
}

test('every recorded attempt is normalised to lowercase, regardless of input case', async () => {
  const { db, attempt } = setup();
  await attempt('Victim@X.com');
  assert.equal(db.tables.login_attempts[0].email, 'victim@x.com');
});

test('3 failures across DIFFERENT email casings still lock the account (same real account, same counter)', async () => {
  const { attempt } = setup();
  await attempt('victim@x.com');
  await attempt('Victim@X.com');
  const third = await attempt('VICTIM@X.COM');
  assert.equal((await third.json()).locked, true, 'third failure (case varied each time) should trip the lockout');

  const fourth = await attempt('vIcTiM@x.CoM');
  const fourthBody = await fourth.json();
  assert.equal(fourth.status, 429);
  assert.equal(fourthBody.locked, true, 'a 4th attempt, in yet another casing, is still refused by the SAME lockout');
});

test('a locked account cannot be reached by a fresh case variant (the bypass this fix closes)', async () => {
  const { attempt } = setup();
  await attempt('victim@x.com'); await attempt('victim@x.com'); await attempt('victim@x.com');
  const bypassAttempt = await attempt('VicTIM@X.Com');
  assert.equal(bypassAttempt.status, 429, 'before this fix, a fresh case variant was treated as an unlocked identity');
});

test('successful login still works regardless of the case the user happened to type', async () => {
  const { attempt } = setup({ wrongPassword: false });
  const res = await attempt('Victim@X.com', 'correct-password');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.access_token, 'tok');
});

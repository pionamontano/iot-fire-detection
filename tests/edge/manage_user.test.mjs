// manage-user: admin edit / deactivate / list. Real supabase/functions/manage-user handler, in-memory DB,
// fake auth.admin that records calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb, loadHandler, req } from './harness.mjs';

const ADMIN = 'admin-1';
const DEV = '10000000-0000-0000-0000-000000000001';

function setup({ caller = { id: ADMIN, role: 'admin', status: 'approved', is_active: true }, profiles = [], authUsers = [], authError = null } = {}) {
  const db = new FakeDb({ profiles: [caller, ...profiles] });
  const authCalls = [];
  const authAdmin = {
    listUsers: async ({ page }) => ({ data: { users: page === 1 ? authUsers : [] }, error: null }),
    updateUserById: async (id, attrs) => { authCalls.push({ id, attrs }); return { data: {}, error: authError }; },
  };
  const handler = loadHandler('manage-user', {
    db, authAdmin, user: { id: caller.id },
    env: { SUPABASE_URL: 'x', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's' },
  });
  const call = (body) => handler(req(body, { Authorization: 'Bearer t' }));
  const profile = (id) => db.tables.profiles.find((p) => p.id === id);
  return { db, call, authCalls, profile };
}

const resident = (over = {}) => ({ id: 'res-1', role: 'resident', status: 'approved', is_active: true, full_name: 'Old', contact_number: null, address: null, device_id: DEV, ...over });

test('non-admins are refused', async () => {
  const { call } = setup({ caller: { id: 'res-9', role: 'resident', status: 'approved', is_active: true } });
  const res = await call({ action: 'list' });
  assert.equal(res.status, 403);
});

test('a deactivated admin is refused', async () => {
  const { call } = setup({ caller: { id: ADMIN, role: 'admin', status: 'approved', is_active: false } });
  assert.equal((await call({ action: 'list' })).status, 403);
});

test('list returns login email and last sign-in only', async () => {
  const { call } = setup({ authUsers: [{ id: 'res-1', email: 'a@x.com', last_sign_in_at: '2026-10-01', phone: 'secret' }] });
  const res = await call({ action: 'list' });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).users, [{ id: 'res-1', email: 'a@x.com', last_sign_in_at: '2026-10-01' }]);
});

test('update trims and saves profile fields', async () => {
  const { call, profile } = setup({ profiles: [resident()] });
  const res = await call({ action: 'update', user_id: 'res-1', full_name: '  New Name ', contact_number: '09171234567', address: ' 1 Rizal St ' });
  assert.equal(res.status, 200);
  assert.equal(profile('res-1').full_name, 'New Name');
  assert.equal(profile('res-1').contact_number, '09171234567');
  assert.equal(profile('res-1').address, '1 Rizal St');
});

test('update rejects a bad phone number and changes nothing', async () => {
  const { call, profile } = setup({ profiles: [resident()] });
  const res = await call({ action: 'update', user_id: 'res-1', full_name: 'X', contact_number: '12345' });
  assert.equal(res.status, 400);
  assert.equal(profile('res-1').full_name, 'Old');
});

test('clearing the phone or address stores null', async () => {
  const { call, profile } = setup({ profiles: [resident({ contact_number: '09171234567', address: 'A' })] });
  await call({ action: 'update', user_id: 'res-1', contact_number: '', address: '' });
  assert.equal(profile('res-1').contact_number, null);
  assert.equal(profile('res-1').address, null);
});

test('changing a resident to another role releases their device', async () => {
  const { call, profile } = setup({ profiles: [resident()] });
  const res = await call({ action: 'update', user_id: 'res-1', role: 'bfp_responder' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).device_released, true);
  assert.equal(profile('res-1').role, 'bfp_responder');
  assert.equal(profile('res-1').device_id, null);
});

test('an admin cannot change their own role', async () => {
  const { call, profile } = setup();
  const res = await call({ action: 'update', user_id: ADMIN, role: 'resident' });
  assert.equal(res.status, 400);
  assert.equal(profile(ADMIN).role, 'admin');
});

test('an invalid role is refused', async () => {
  const { call } = setup({ profiles: [resident()] });
  assert.equal((await call({ action: 'update', user_id: 'res-1', role: 'superuser' })).status, 400);
});

test('email and password go to auth; a failing auth update leaves the profile untouched', async () => {
  const ok = setup({ profiles: [resident()] });
  await ok.call({ action: 'update', user_id: 'res-1', email: ' New@X.com ', password: 'secret1' });
  assert.deepEqual(ok.authCalls, [{ id: 'res-1', attrs: { email: 'new@x.com', email_confirm: true, password: 'secret1' } }]);

  const bad = setup({ profiles: [resident()], authError: { message: 'A user with this email address has already been registered' } });
  const res = await bad.call({ action: 'update', user_id: 'res-1', email: 'taken@x.com', full_name: 'Changed' });
  assert.equal(res.status, 400);
  assert.equal(bad.profile('res-1').full_name, 'Old');
});

test('a short password is refused before anything is sent to auth', async () => {
  const { call, authCalls } = setup({ profiles: [resident()] });
  assert.equal((await call({ action: 'update', user_id: 'res-1', password: '123' })).status, 400);
  assert.equal(authCalls.length, 0);
});

test('deactivate bans the auth user and clears is_active; reactivate reverses both', async () => {
  const { call, authCalls, profile } = setup({ profiles: [resident()] });
  assert.equal((await call({ action: 'set_active', user_id: 'res-1', active: false })).status, 200);
  assert.equal(profile('res-1').is_active, false);
  assert.equal(authCalls[0].attrs.ban_duration, '876000h');

  assert.equal((await call({ action: 'set_active', user_id: 'res-1', active: true })).status, 200);
  assert.equal(profile('res-1').is_active, true);
  assert.equal(authCalls[1].attrs.ban_duration, 'none');
});

test('an admin cannot deactivate themselves', async () => {
  const { call, profile, authCalls } = setup();
  assert.equal((await call({ action: 'set_active', user_id: ADMIN, active: false })).status, 400);
  assert.equal(profile(ADMIN).is_active, true);
  assert.equal(authCalls.length, 0);
});

test('unknown users get 404', async () => {
  const { call } = setup();
  assert.equal((await call({ action: 'update', user_id: 'nope', full_name: 'X' })).status, 404);
});

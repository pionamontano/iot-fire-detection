// KI-28 (issue #112): approving a registration must not let two residents share a device_id -
// trigger-alert's resident lookup uses .maybeSingle(), which errors on >1 row and silently drops
// that device's Tier-2 SMS. Real supabase/functions/manage-registration handler, in-memory DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb, loadHandler, req } from './harness.mjs';

const ADMIN = 'admin-1';
const DEV = '10000000-0000-0000-0000-000000000001';

function setup(profiles) {
  const db = new FakeDb({
    profiles: [{ id: ADMIN, role: 'admin', status: 'approved' }, ...profiles],
    registration_requests: profiles.map((p) => ({ user_id: p.id })),
  });
  const handler = loadHandler('manage-registration', {
    db, user: { id: ADMIN },
    env: { SUPABASE_URL: 'x', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's' },
  });
  const approve = (userId, device_id) => handler(req({ action: 'approve', userId, device_id }, { Authorization: 'Bearer t' }));
  return { db, approve };
}

test('approving a resident onto a FRESH device succeeds', async () => {
  const { db, approve } = setup([{ id: 'res-1', role: 'resident', status: 'pending', device_id: null }]);
  const res = await approve('res-1', DEV);
  assert.equal(res.status, 200);
  assert.equal(db.tables.profiles.find((p) => p.id === 'res-1').device_id, DEV);
});

test('approving a SECOND resident onto a device another resident already holds is refused (409), not silently allowed', async () => {
  const { db, approve } = setup([
    { id: 'res-1', role: 'resident', status: 'approved', device_id: DEV },
    { id: 'res-2', role: 'resident', status: 'pending', device_id: null },
  ]);
  const res = await approve('res-2', DEV);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, 'This device is already assigned to another resident.');
  assert.equal(db.tables.profiles.find((p) => p.id === 'res-2').device_id, null, 'res-2 is NOT silently given the device');
  assert.equal(db.tables.profiles.find((p) => p.id === 'res-2').status, 'pending', 'approval did not partially apply');
});

test('re-approving the SAME resident on the SAME device they already hold is not blocked by their own row', async () => {
  const { db, approve } = setup([{ id: 'res-1', role: 'resident', status: 'approved', device_id: DEV }]);
  const res = await approve('res-1', DEV);
  assert.equal(res.status, 200);
  assert.equal(db.tables.profiles.find((p) => p.id === 'res-1').device_id, DEV);
});

test('approving without a device_id (e.g. a responder/admin registration) is unaffected', async () => {
  const { db, approve } = setup([{ id: 'resp-1', role: 'bfp_responder', status: 'pending', device_id: null }]);
  const res = await approve('resp-1', undefined);
  assert.equal(res.status, 200);
  assert.equal(db.tables.profiles.find((p) => p.id === 'resp-1').status, 'approved');
});

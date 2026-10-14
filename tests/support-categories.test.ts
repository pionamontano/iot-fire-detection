// "Contact System Administrator" categories per requester role.
import test from 'node:test';
import assert from 'node:assert/strict';
import { supportCategoriesFor, DEVICE_REQUEST_CATEGORY } from '../src/lib/supportRequests.ts';

test('residents get device and account categories, not responder ones', () => {
  const c = supportCategoriesFor('resident');
  assert.equal(c[0], DEVICE_REQUEST_CATEGORY);
  assert.ok(!c.includes('Role Change'));
  assert.ok(!c.includes('Station Assignment'));
  assert.ok(c.includes('Password Reset') && c.includes('Other'));
});

test('responders keep their list', () => {
  assert.deepEqual([...supportCategoriesFor('bfp_responder')],
    ['Role Change', 'Password Reset', 'Station Assignment', 'Account Access / Permissions', 'Other']);
});

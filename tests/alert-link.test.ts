// Where an alert push notification takes each role.
import test from 'node:test';
import assert from 'node:assert/strict';
import { alertDestination } from '../src/lib/alertLink.ts';

test('admins land on Device Status with the alerting device highlighted', () => {
  assert.equal(alertDestination('admin', 'b3f1c2d4-0000-4000-8000-000000000001'), '/admin/status?device=b3f1c2d4-0000-4000-8000-000000000001');
  assert.equal(alertDestination('admin', null), '/admin/status');
  assert.equal(alertDestination('admin', 'a&b=c'), '/admin/status?device=a%26b%3Dc');
});

test('responders land on their fire dashboard, residents on their home page', () => {
  assert.equal(alertDestination('bfp_responder', 'x'), '/responder');
  assert.equal(alertDestination('resident', 'x'), '/home');
});

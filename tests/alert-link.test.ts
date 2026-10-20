// Where a tapped alert notification (/alert/<id>?device=<id>) takes each role.
import test from 'node:test';
import assert from 'node:assert/strict';
import { alertPagePath } from '../src/lib/alertLink.ts';

test('a BFP responder lands on the dashboard with the fire highlighted', () => {
  assert.equal(alertPagePath('bfp_responder', 'a1', 'd1'), '/responder?alert=a1');
});

test('an admin lands on the device-status row for the device', () => {
  assert.equal(alertPagePath('admin', 'a1', 'd1'), '/admin/status?device=d1');
  assert.equal(alertPagePath('admin', 'a1', null), '/admin/status');
});

test('a resident lands on their home page', () => {
  assert.equal(alertPagePath('resident', 'a1', 'd1'), '/home');
});

test('an /alert link without an alert id (sent by an earlier build) still opens the role\'s page', () => {
  assert.equal(alertPagePath('bfp_responder', undefined, 'd1'), '/responder');
  assert.equal(alertPagePath('admin', undefined, 'd1'), '/admin/status?device=d1');
});

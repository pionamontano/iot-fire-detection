// Emergency numbers on the resident Dashboard: none during testing, and
// well-formed dial links once they are set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { telHref, EMERGENCY_CONTACTS } from '../src/lib/emergencyContacts.ts';

test('no tap-to-call numbers are listed during testing', () => {
  assert.deepEqual(EMERGENCY_CONTACTS, []);
});

test('telHref strips spaces and punctuation, keeps a leading +', () => {
  assert.equal(telHref('0912 345 6789'), 'tel:09123456789');
  assert.equal(telHref('+63 (912) 345-6789'), 'tel:+639123456789');
});

// Dial links for the emergency numbers on the resident Dashboard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { telHref, EMERGENCY_HOTLINE, EMERGENCY_CONTACTS } from '../src/lib/emergencyContacts.ts';

test('telHref strips spaces and punctuation, keeps a leading +', () => {
  assert.equal(telHref(EMERGENCY_HOTLINE.phone), 'tel:911');
  assert.equal(telHref('0912 345 6789'), 'tel:09123456789');
  assert.equal(telHref('+63 (912) 345-6789'), 'tel:+639123456789');
});

test('911 is always listed first', () => {
  assert.equal(EMERGENCY_CONTACTS[0], EMERGENCY_HOTLINE);
});

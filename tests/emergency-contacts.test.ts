// Dial links for the emergency numbers on the resident Dashboard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { telHref, EMERGENCY_HOTLINE, LOCAL_FIRE_STATION } from '../src/lib/emergencyContacts.ts';

test('telHref strips spaces and punctuation, keeps a leading +', () => {
  assert.equal(telHref(LOCAL_FIRE_STATION.phone), 'tel:09951860370');
  assert.equal(telHref(EMERGENCY_HOTLINE.phone), 'tel:911');
  assert.equal(telHref('+63 (995) 186-0370'), 'tel:+639951860370');
});

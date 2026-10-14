// Mobile numbers on the registration forms: whatever format people type or
// paste, the register Edge Function must receive 09XXXXXXXXX.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, PHONE_PATTERN } from '../src/lib/phone.ts';

test('pasted formats normalize to 09XXXXXXXXX', () => {
  for (const raw of [
    '09171234567',
    '0917 123 4567',
    '0917-123-4567',
    '(0917) 123-4567',
    '+63 917 123 4567',
    '+639171234567',
    '639171234567',
    '9171234567',
  ]) {
    assert.equal(normalizePhone(raw), '09171234567', raw);
  }
});

test('typing +63 digit by digit ends up local', () => {
  let value = '';
  for (const ch of '+639171234567') value = normalizePhone(value + ch);
  assert.equal(value, '09171234567');
});

test('partial and wrong numbers are kept so validation can flag them', () => {
  assert.equal(normalizePhone('0917'), '0917');
  assert.equal(normalizePhone('0812345678'), '0812345678');
  assert.equal(PHONE_PATTERN.test(normalizePhone('0812345678')), false);
  assert.equal(normalizePhone('091712345678999'), '09171234567');
  assert.equal(normalizePhone(''), '');
});

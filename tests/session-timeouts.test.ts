// Idle-timeout resolution (spec SW-2.6.1, KI-30): a missing or unusable
// settings value falls back to the role's default instead of "no timeout".
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TIMEOUT_MINUTES, resolveTimeoutMinutes } from '../src/lib/sessionTimeouts.ts';

test('a saved value within 1-1440 minutes is used', () => {
  assert.equal(resolveTimeoutMinutes('30', 'resident'), 30);
  assert.equal(resolveTimeoutMinutes('1', 'admin'), 1);
  assert.equal(resolveTimeoutMinutes('1440', 'bfp_responder'), 1440);
  assert.equal(resolveTimeoutMinutes(' 45 ', 'admin'), 45);
});

test('no saved row falls back to the role default', () => {
  assert.equal(resolveTimeoutMinutes(null, 'admin'), 15);
  assert.equal(resolveTimeoutMinutes(undefined, 'bfp_responder'), 15);
  assert.equal(resolveTimeoutMinutes(null, 'resident'), 60);
});

test('unusable values fall back to the role default, never to "no timeout"', () => {
  for (const bad of ['', '0', '-5', '1441', 'abc', '12.5', '10min']) {
    assert.equal(resolveTimeoutMinutes(bad, 'resident'), DEFAULT_TIMEOUT_MINUTES.resident, bad);
  }
});

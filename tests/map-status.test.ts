// Live map pin status: Tier 2 = fire, Tier 1 = warning (spec SW-2.3.1),
// otherwise connectivity decides normal vs offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getMapStatus } from '../src/lib/deviceStatus.ts';

const NOW = Date.parse('2026-10-12T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const device = (over: Partial<{ is_active: boolean; last_seen_at: string | null }> = {}) => ({
  id: 'd1', is_active: true, last_seen_at: ago(30_000), ...over,
});

test('getMapStatus: tier 2 alert is a fire, tier 1 is a warning (not a fault)', () => {
  assert.equal(getMapStatus(device(), [{ device_id: 'd1', alert_tier: 2 }], NOW), 'fire');
  assert.equal(getMapStatus(device(), [{ device_id: 'd1', alert_tier: 1 }], NOW), 'warning');
  // An escalated incident with an older tier-1 row still open shows as fire.
  assert.equal(getMapStatus(device(), [{ device_id: 'd1', alert_tier: 1 }, { device_id: 'd1', alert_tier: 2 }], NOW), 'fire');
});

test('getMapStatus: alerts on other devices are ignored', () => {
  assert.equal(getMapStatus(device(), [{ device_id: 'other', alert_tier: 2 }], NOW), 'normal');
});

test('getMapStatus: connectivity decides normal vs offline', () => {
  assert.equal(getMapStatus(device(), [], NOW), 'normal');
  assert.equal(getMapStatus(device({ last_seen_at: ago(5 * 60_000) }), [], NOW), 'offline'); // reconnecting → offline pin
  assert.equal(getMapStatus(device({ last_seen_at: null }), [], NOW), 'offline');
  assert.equal(getMapStatus(device({ is_active: false }), [], NOW), 'offline');
});

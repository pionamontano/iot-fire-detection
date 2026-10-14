// Shared device status (used by the dashboard, map and Device Status):
// Tier 2 = fire, Tier 1 = warning (spec SW-2.3.1), otherwise connectivity
// decides online / reconnecting / offline (spec SW-2.4.3); a device an admin
// switched off is disabled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getDeviceStatus, getStatusNote, formatLastSeen } from '../src/lib/deviceStatus.ts';

const NOW = Date.parse('2026-10-12T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const device = (over: Partial<{ is_active: boolean; last_seen_at: string | null }> = {}) => ({
  id: 'd1', is_active: true, last_seen_at: ago(30_000), ...over,
});

test('getDeviceStatus: tier 2 alert is a fire, tier 1 is a warning', () => {
  assert.equal(getDeviceStatus(device(), [{ device_id: 'd1', alert_tier: 2 }], NOW), 'fire');
  assert.equal(getDeviceStatus(device(), [{ device_id: 'd1', alert_tier: 1 }], NOW), 'warning');
  // An escalated incident with an older tier-1 row still open shows as fire.
  assert.equal(getDeviceStatus(device(), [{ device_id: 'd1', alert_tier: 1 }, { device_id: 'd1', alert_tier: 2 }], NOW), 'fire');
  // Alerts on a disabled or offline device still win.
  assert.equal(getDeviceStatus(device({ is_active: false }), [{ device_id: 'd1', alert_tier: 1 }], NOW), 'warning');
});

test('getDeviceStatus: resolved alerts and alerts on other devices are ignored', () => {
  assert.equal(getDeviceStatus(device(), [{ device_id: 'other', alert_tier: 2 }], NOW), 'online');
  assert.equal(getDeviceStatus(device(), [{ device_id: 'd1', alert_tier: 2, resolved_at: ago(1000) }], NOW), 'online');
});

test('getDeviceStatus: connectivity decides online / reconnecting / offline', () => {
  assert.equal(getDeviceStatus(device(), [], NOW), 'online');
  assert.equal(getDeviceStatus(device({ last_seen_at: ago(5 * 60_000) }), [], NOW), 'reconnecting');
  assert.equal(getDeviceStatus(device({ last_seen_at: ago(20 * 60_000) }), [], NOW), 'offline');
  assert.equal(getDeviceStatus(device({ last_seen_at: null }), [], NOW), 'offline');
  // Switched off by an admin: its own status, never mistaken for offline.
  assert.equal(getDeviceStatus(device({ is_active: false }), [], NOW), 'disabled');
  assert.equal(getDeviceStatus(device({ is_active: false, last_seen_at: null }), [], NOW), 'disabled');
});

test('getStatusNote: last seen for offline, reconnecting and disabled devices', () => {
  assert.equal(getStatusNote(device({ is_active: false, last_seen_at: ago(3 * 3600_000) }), 'disabled', NOW), 'Last seen 3 h ago');
  assert.equal(getStatusNote(device({ last_seen_at: ago(5 * 60_000) }), 'reconnecting', NOW), 'Last seen 5 min ago');
  assert.equal(getStatusNote(device({ last_seen_at: null }), 'offline', NOW), 'Never seen');
  assert.equal(getStatusNote(device(), 'online', NOW), null);
});

test('formatLastSeen: switches to hours and days', () => {
  assert.equal(formatLastSeen(ago(3 * 3600_000), NOW), 'Last seen 3 h ago');
  assert.equal(formatLastSeen(ago(20 * 86400_000), NOW), 'Last seen 20 d ago');
});

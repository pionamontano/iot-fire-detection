// BFP responder portal: Tier 2 only, and where the "Directions" button points.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDispatchAlert, navigationTarget, formatElapsed, averageAckSeconds, formatDuration } from '../src/lib/dispatch.ts';

test('only Tier 2 alerts are dispatched to BFP', () => {
  assert.equal(isDispatchAlert({ alert_tier: 1 }), false);
  assert.equal(isDispatchAlert({ alert_tier: 2 }), true);
});

test('navigation: live GPS, then last-known GPS, then the registered pin, else nothing', () => {
  const pin = { latitude: 14.84, longitude: 120.81, location_verified: true };
  assert.deepEqual(navigationTarget({ latitude: 14.85, longitude: 120.82, gps_valid: true }, pin),
    { lat: 14.85, lng: 120.82, label: 'Live GPS at alert', approximate: false });
  assert.equal(navigationTarget({ latitude: 14.85, longitude: 120.82, gps_valid: false }, pin)?.approximate, true);
  assert.deepEqual(navigationTarget({ latitude: null, longitude: null, gps_valid: false }, pin),
    { lat: 14.84, lng: 120.81, label: 'Registered pin, confirmed by admin', approximate: false });
  assert.equal(navigationTarget({ latitude: 0, longitude: 0, gps_valid: false }, { ...pin, location_verified: false })?.label, 'Registered pin, not yet confirmed');
  assert.equal(navigationTarget({ latitude: 0, longitude: 0, gps_valid: true }, { latitude: null, longitude: null }), null);
  assert.equal(navigationTarget({ latitude: null, longitude: null, gps_valid: false }), null);
});

test('elapsed and duration formatting', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const ago = (s: number) => new Date(now - s * 1000).toISOString();
  assert.equal(formatElapsed(ago(45), now), '45s');
  assert.equal(formatElapsed(ago(12 * 60 + 5), now), '12m 05s');
  assert.equal(formatElapsed(ago(3 * 3600 + 20 * 60), now), '3h 20m');
  assert.equal(formatElapsed(ago(-30), now), '0s');
  assert.equal(formatDuration(150), '2m 30s');
});

test('average time to acknowledge ignores unacknowledged and negative durations', () => {
  const t = '2026-10-14T12:00:00Z';
  assert.equal(averageAckSeconds([{ triggered_at: t }]), null);
  assert.equal(averageAckSeconds([
    { triggered_at: t, acknowledged_at: '2026-10-14T12:01:00Z' },
    { triggered_at: t, acknowledged_at: '2026-10-14T12:03:00Z' },
    { triggered_at: t, acknowledged_at: '2026-10-14T11:00:00Z' },
    { triggered_at: t, acknowledged_at: null },
  ]), 120);
});

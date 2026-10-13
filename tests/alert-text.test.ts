// Shared alert wording used by the Dashboard and the Live Map feed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { alertTitle, alertActor, alertEventAt, formatEventTime } from '../src/lib/alertText.ts';

const T = '2026-10-12T08:00:00Z';
const R = '2026-10-12T08:05:00Z';

test('alertTitle: one wording per tier and state', () => {
  assert.equal(alertTitle({ alert_tier: 2, triggered_at: T }), 'Fire alert triggered');
  assert.equal(alertTitle({ alert_tier: 1, triggered_at: T }), 'Warning triggered');
  assert.equal(alertTitle({ alert_tier: 2, triggered_at: T, resolved_at: R }), 'Fire alert resolved');
  assert.equal(alertTitle({ alert_tier: 1, triggered_at: T, resolved_at: R }), 'Warning resolved');
});

test('alertActor / alertEventAt', () => {
  assert.equal(alertActor({ alert_tier: 2, triggered_at: T }), 'Tier 2 · Automated');
  assert.equal(alertActor({ alert_tier: 1, triggered_at: T, resolved_at: R, resolution_source: 'device' }), 'Auto-cleared by device');
  assert.equal(alertActor({ alert_tier: 1, triggered_at: T, resolved_at: R, resolution_source: 'legacy' }), 'Resolved');
  assert.equal(alertEventAt({ alert_tier: 1, triggered_at: T }), T);
  assert.equal(alertEventAt({ alert_tier: 1, triggered_at: T, resolved_at: R }), R);
});

test('formatEventTime: Today / Yesterday / date prefix', () => {
  const now = new Date(2026, 9, 12, 15, 0).getTime();
  assert.match(formatEventTime(new Date(2026, 9, 12, 9, 30).toISOString(), now), /^Today, /);
  assert.match(formatEventTime(new Date(2026, 9, 11, 22, 0).toISOString(), now), /^Yesterday, /);
  assert.doesNotMatch(formatEventTime(new Date(2026, 9, 3, 10, 0).toISOString(), now), /^(Today|Yesterday)/);
});

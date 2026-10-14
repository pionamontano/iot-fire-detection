// System Log: event wording, severity, open-item flags and CSV escaping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLogEntries, relativeTime, toCsv } from '../src/lib/systemLog.ts';

test('entries from every source, newest first', () => {
  const entries = buildLogEntries({
    alerts: [{ id: 'a1', alert_tier: 2, co_ppm: 300, temp_celsius: 70, triggered_at: '2026-10-14T01:00:00Z', resolved_at: null, devices: { device_code: 'AGS-1', location_desc: 'Blk 4' } }],
    logins: [{ id: 'l1', email: 'x@y.com', ip_address: null, success: false, attempted_at: '2026-10-14T03:00:00Z' }],
    devices: [{ id: 'd1', device_code: 'AGS-1', label: 'Kitchen', location_desc: null, created_at: '2026-10-10T00:00:00Z' }],
    registrations: [{ id: 'r1', email: 'r@y.com', requested_role: 'resident', device_code: 'AGS-1', created_at: '2026-10-12T00:00:00Z', reviewed_at: null, profile: { full_name: 'Res', status: 'pending' } }],
    support: [{ id: 's1', category: 'Role change', status: 'resolved', created_at: '2026-10-11T00:00:00Z', reviewed_at: '2026-10-13T00:00:00Z', profile: { full_name: 'Sam' } }],
    firmware: [{ id: 'f1', version: '1.2.0', notes: null, created_at: '2026-10-09T00:00:00Z' }],
  });
  assert.deepEqual(entries.map(e => e.id), ['login-l1', 'alert-a1', 'support-res-s1', 'reg-r1', 'support-s1', 'device-d1', 'fw-f1']);

  const alert = entries.find(e => e.id === 'alert-a1')!;
  assert.equal(alert.severity, 'critical');
  assert.equal(alert.open, true);
  assert.match(alert.details, /Still open/);

  const login = entries.find(e => e.id === 'login-l1')!;
  assert.equal(login.severity, 'warning');
  assert.doesNotMatch(login.details, /Unknown/, 'no "[Unknown]" IP noise when none was recorded');

  assert.equal(entries.find(e => e.id === 'reg-r1')!.open, true);
  assert.equal(entries.find(e => e.id === 'support-s1')!.open, false);
});

test('resolved alert: closed trigger row plus a resolution row', () => {
  const entries = buildLogEntries({
    alerts: [{ id: 'a', alert_tier: 1, co_ppm: 1, temp_celsius: 1, triggered_at: '2026-10-14T01:00:00Z', resolved_at: '2026-10-14T02:00:00Z', resolution_source: 'device' }],
  });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].event, 'Alert auto-cleared');
  assert.equal(entries[0].severity, 'success');
  assert.equal(entries[1].open, false);
  assert.equal(entries[1].severity, 'warning');
});

test('relative time', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  assert.equal(relativeTime('2026-10-14T11:59:30Z', now), 'just now');
  assert.equal(relativeTime('2026-10-14T11:15:00Z', now), '45m ago');
  assert.equal(relativeTime('2026-10-14T09:00:00Z', now), '3h ago');
  assert.equal(relativeTime('2026-10-12T12:00:00Z', now), '2d ago');
  assert.equal(relativeTime('2026-09-01T00:00:00Z', now), '');
});

test('CSV quotes and escapes every field', () => {
  const csv = toCsv(buildLogEntries({ logins: [{ id: 'l', email: 'a"b,c@y.com', ip_address: '1.2.3.4', success: true, attempted_at: '2026-10-14T01:00:00Z' }] }));
  const [header, row] = csv.split('\n');
  assert.equal(header, '"Timestamp (UTC)","Category","Event","Actor","Details","Severity"');
  assert.equal(row, '"2026-10-14T01:00:00.000Z","Sign-ins","Signed in","a""b,c@y.com","Signed in successfully from 1.2.3.4.","Info"');
});

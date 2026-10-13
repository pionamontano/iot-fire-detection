// Owner decision D6.1 (issue #96): auto-resolution requires 2 consecutive below-threshold readings
// and must never close an incident a responder has already acknowledged or is responding to.
// Runs the real supabase/functions/ingest-reading handler against a fake DB. No network, nothing is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeDb, loadHandler, req } from './harness.mjs';

const DEV = '10000000-0000-0000-0000-000000000001';
const device = { id: DEV, location_desc: 'Loc', latitude: null, longitude: null, is_active: true, co_threshold: 200, temp_threshold: 60, api_key: 'k' };

const BELOW = { co_ppm: 10, temp_celsius: 25, sensor_ready: true };
const ABOVE = { co_ppm: 500, temp_celsius: 90, sensor_ready: true };

async function ingest({ incidentStatus, previousReading, body }) {
  const alert = incidentStatus
    ? [{ id: 'a1', device_id: DEV, incident_status: incidentStatus, resolved_at: null, alert_tier: 2 }]
    : [];
  const readings = previousReading ? [{ device_id: DEV, ...previousReading }] : [];
  const db = new FakeDb({ devices: [device], sensor_readings: readings, alert_events: alert, profiles: [], address_discrepancies: [] });
  const handler = loadHandler('ingest-reading', { db, env: { SUPABASE_URL: 'http://local', SUPABASE_SERVICE_ROLE_KEY: 'srv' } });
  const res = await handler(req({ gps_valid: false, ...body }, { 'x-device-key': 'k' }));
  return { res, incident: db.tables.alert_events[0] };
}

test('active incident auto-resolves after 2 consecutive below-threshold readings', async () => {
  const { res, incident } = await ingest({ incidentStatus: 'active', previousReading: BELOW, body: BELOW });
  assert.equal(res.status, 200);
  assert.equal(incident.incident_status, 'resolved');
  assert.ok(incident.resolved_at);
  assert.equal(incident.resolution_source, 'device');
});

test('active incident stays open on only one below-threshold reading (no prior clear reading)', async () => {
  const { incident } = await ingest({ incidentStatus: 'active', previousReading: null, body: BELOW });
  assert.equal(incident.incident_status, 'active');
  assert.equal(incident.resolved_at, null);
});

test('active incident stays open when the previous reading was still above threshold', async () => {
  const { incident } = await ingest({ incidentStatus: 'active', previousReading: ABOVE, body: BELOW });
  assert.equal(incident.incident_status, 'active');
  assert.equal(incident.resolved_at, null);
});

test('acknowledged incident is never auto-closed, even after 2 consecutive clear readings', async () => {
  const { incident } = await ingest({ incidentStatus: 'acknowledged', previousReading: BELOW, body: BELOW });
  assert.equal(incident.incident_status, 'acknowledged');
  assert.equal(incident.resolved_at, null);
});

test('responding incident is never auto-closed, even after 2 consecutive clear readings', async () => {
  const { incident } = await ingest({ incidentStatus: 'responding', previousReading: BELOW, body: BELOW });
  assert.equal(incident.incident_status, 'responding');
  assert.equal(incident.resolved_at, null);
});

test('a sensor_ready=false reading never counts toward the clear debounce', async () => {
  const { incident } = await ingest({
    incidentStatus: 'active',
    previousReading: { ...BELOW, sensor_ready: false },
    body: BELOW,
  });
  assert.equal(incident.incident_status, 'active');
  assert.equal(incident.resolved_at, null);
});

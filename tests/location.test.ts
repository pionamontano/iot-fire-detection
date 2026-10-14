// Step 4 (GPS-001): location helper rules + guard against fabricated coordinates.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  LIVE_FIX_MAX_AGE_MS, isValidCoordinate, resolveDeviceLocation, describeLocation, formatAge, markerOpacity, displayAddress,
} from '../src/lib/location.ts';

const NOW = Date.parse('2026-10-12T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const reg = { latitude: 14.84, longitude: 120.81 };

test('isValidCoordinate: rejects null/undefined/NaN/Infinity/strings/out-of-range/(0,0)', () => {
  for (const [a, b] of [[null, 1], [1, null], [undefined, undefined], [NaN, 1], [1, Infinity], ['14.8', '120.8'], [91, 0], [-91, 0], [0, 181], [0, -181], [0, 0]])
    assert.equal(isValidCoordinate(a, b), false, JSON.stringify([a, b]));
});
test('isValidCoordinate: accepts real values, including the equator and prime meridian', () => {
  assert.equal(isValidCoordinate(14.84, 120.81), true);
  assert.equal(isValidCoordinate(0, 120.81), true);
  assert.equal(isValidCoordinate(14.84, 0), true);
  assert.equal(isValidCoordinate(-90, -180), true);
});

test('live: valid coords, gps_valid=true, within 15 minutes', () => {
  const r = resolveDeviceLocation({ readings: [{ latitude: 14.8, longitude: 120.8, gps_valid: true, recorded_at: ago(60_000) }], device: reg, now: NOW });
  assert.deepEqual([r.kind, r.lat, r.lng], ['live', 14.8, 120.8]);
  assert.equal(r.fixAt, ago(60_000));
});
test('live boundary: exactly 15 min is live, 1 ms older is last_known', () => {
  const mk = (ms: number) => resolveDeviceLocation({ readings: [{ latitude: 14.8, longitude: 120.8, gps_valid: true, recorded_at: ago(ms) }], now: NOW }).kind;
  assert.equal(mk(LIVE_FIX_MAX_AGE_MS), 'live');
  assert.equal(mk(LIVE_FIX_MAX_AGE_MS + 1), 'last_known');
});
test('gps_valid=false is never live, even if recent (cached position)', () => {
  const r = resolveDeviceLocation({ readings: [{ latitude: 14.8, longitude: 120.8, gps_valid: false, recorded_at: ago(1000) }], now: NOW });
  assert.equal(r.kind, 'last_known');
  assert.equal(r.fixAt, ago(1000)); // timestamp preserved for display
});
test('gps_valid null/undefined is not treated as live', () => {
  for (const gv of [null, undefined])
    assert.equal(resolveDeviceLocation({ readings: [{ latitude: 14.8, longitude: 120.8, gps_valid: gv, recorded_at: ago(1000) }], now: NOW }).kind, 'last_known');
});
test('missing or unparseable timestamp can never be live; fixAt is null', () => {
  for (const t of [null, undefined, 'garbage'] as const) {
    const r = resolveDeviceLocation({ readings: [{ latitude: 14.8, longitude: 120.8, gps_valid: true, recorded_at: t }], now: NOW });
    assert.equal(r.kind, 'last_known'); assert.equal(r.fixAt, null);
  }
});
test('timestamp far in the future is not live (clock anomaly)', () => {
  assert.equal(resolveDeviceLocation({ readings: [{ latitude: 14.8, longitude: 120.8, gps_valid: true, recorded_at: ago(-60 * 60_000) }], now: NOW }).kind, 'last_known');
});
test('stale fix keeps its coordinates and timestamp as last_known', () => {
  const r = resolveDeviceLocation({ readings: [{ latitude: 14.8, longitude: 120.8, gps_valid: true, recorded_at: ago(3 * 3600_000) }], device: reg, now: NOW });
  assert.deepEqual([r.kind, r.lat, r.lng, r.fixAt], ['last_known', 14.8, 120.8, ago(3 * 3600_000)]);
});

test('invalid reading coordinates are skipped: (0,0), null, out of range -> falls through to registered', () => {
  for (const bad of [{ latitude: 0, longitude: 0 }, { latitude: null, longitude: null }, { latitude: 200, longitude: 5 }, { latitude: NaN, longitude: 1 }]) {
    const r = resolveDeviceLocation({ readings: [{ ...bad, gps_valid: true, recorded_at: ago(1000) }], device: reg, now: NOW });
    assert.equal(r.kind, 'registered', JSON.stringify(bad));
    assert.deepEqual([r.lat, r.lng, r.fixAt], [14.84, 120.81, null]);
  }
});
test('newest reading with VALID coordinates wins over newer readings without coordinates', () => {
  const r = resolveDeviceLocation({
    readings: [{ latitude: null, longitude: null, gps_valid: false, recorded_at: ago(1000) }, { latitude: 14.7, longitude: 120.7, gps_valid: true, recorded_at: ago(5 * 60_000) }],
    device: reg, now: NOW,
  });
  assert.deepEqual([r.kind, r.lat, r.lng], ['live', 14.7, 120.7]);
});
test('registered coordinates are never labelled live and carry no fix time', () => {
  const r = resolveDeviceLocation({ readings: [], device: reg, now: NOW });
  assert.deepEqual([r.kind, r.fixAt], ['registered', null]);
  assert.equal(resolveDeviceLocation({ readings: null, device: reg, now: NOW }).kind, 'registered');
});
test('registered location carries the admin confirmation flag', () => {
  assert.equal(resolveDeviceLocation({ device: { latitude: 14.8, longitude: 120.8, location_verified: true }, now: NOW }).verified, true);
  assert.equal(resolveDeviceLocation({ device: { latitude: 14.8, longitude: 120.8, location_verified: false }, now: NOW }).verified, false);
  assert.equal(resolveDeviceLocation({ device: { latitude: 14.8, longitude: 120.8 }, now: NOW }).verified, false);
});
test('displayAddress falls back when no address is set', () => {
  assert.equal(displayAddress(null), 'Location not set');
  assert.equal(displayAddress('  '), 'Location not set');
  assert.equal(displayAddress('Malolos'), 'Malolos');
});
test('a usable reading takes precedence over registered coordinates', () => {
  const r = resolveDeviceLocation({ readings: [{ latitude: 14.7, longitude: 120.7, gps_valid: false, recorded_at: ago(1000) }], device: reg, now: NOW });
  assert.equal(r.kind, 'last_known'); assert.equal(r.lat, 14.7);
});
test('unavailable: nothing usable -> null coordinates, never a substitute position', () => {
  for (const device of [null, undefined, {}, { latitude: 0, longitude: 0 }, { latitude: null, longitude: 120 }]) {
    const r = resolveDeviceLocation({ readings: [{ latitude: null, longitude: null }, null, undefined], device, now: NOW });
    assert.deepEqual(r, { kind: 'unavailable', lat: null, lng: null, fixAt: null });
  }
  assert.equal(resolveDeviceLocation({ now: NOW }).kind, 'unavailable');
});

test('describeLocation: wording never calls registered/last-known "live"; unavailable says so', () => {
  const live = describeLocation({ kind: 'live', lat: 1, lng: 1, fixAt: ago(120_000) }, NOW);
  assert.equal(live.label, 'Live GPS'); assert.equal(live.approximate, false); assert.match(live.detail, /2 min ago/);
  const lk = describeLocation({ kind: 'last_known', lat: 1, lng: 1, fixAt: ago(3 * 3600_000) }, NOW);
  assert.match(lk.label, /Last-known/); assert.match(lk.detail, /3 h ago/); assert.equal(lk.approximate, true);
  const rg = describeLocation({ kind: 'registered', lat: 1, lng: 1, fixAt: null }, NOW);
  assert.match(rg.detail, /not a GPS fix/); assert.doesNotMatch(rg.label, /live/i);
  assert.match(rg.label, /unverified/, 'a pin is unverified unless marked otherwise');
  const rgv = describeLocation({ kind: 'registered', lat: 1, lng: 1, fixAt: null, verified: true }, NOW);
  assert.match(rgv.detail, /confirmed by an administrator/); assert.doesNotMatch(rgv.label, /unverified/);
  assert.equal(describeLocation({ kind: 'unavailable', lat: null, lng: null, fixAt: null }, NOW).label, 'Location unavailable');
  assert.equal(describeLocation({ kind: 'last_known', lat: 1, lng: 1, fixAt: null }, NOW).detail.includes('time unknown'), true);
});
test('formatAge and markerOpacity', () => {
  assert.equal(formatAge(ago(10_000), NOW), 'just now');
  assert.equal(formatAge(ago(5 * 60_000), NOW), '5 min ago');
  assert.equal(formatAge(null, NOW), 'time unknown');
  assert.ok(markerOpacity('live') > markerOpacity('last_known') && markerOpacity('last_known') > markerOpacity('registered'));
});

// ---- guard: fabricated coordinates must not come back ----
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
test('no hash-derived device coordinates anywhere in src/', () => {
  const root = path.resolve(import.meta.dirname, '..', 'src');
  const offenders = walk(root).filter((f) => /\.(ts|tsx)$/.test(f)).filter((f) => /hash\s*=\s*\(\(hash\s*<<\s*5\)/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
});

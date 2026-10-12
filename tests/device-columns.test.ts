// Step 3 (DB-001): the shared device column list must match the column-level grants in the migrations,
// must never include api_key, and wildcard reads of the base `devices` table must not come back.
// Static checks over the repository only. The LIVE project's grants are NOT inspected here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEVICE_COLUMN_LIST, DEVICE_COLUMNS } from '../src/lib/deviceColumns.ts';

const root = path.resolve(import.meta.dirname, '..');

function latestDeviceSelectGrant(): string[] {
  const dir = path.join(root, 'supabase/migrations');
  let latest: string[] | null = null;
  for (const f of fs.readdirSync(dir).sort()) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8').replace(/--.*$/gm, '');
    const m = sql.match(/GRANT\s+SELECT\s*\(([^)]*)\)\s+ON\s+(?:public\.)?devices\s+TO\s+authenticated/i);
    if (m) latest = m[1].split(',').map((c) => c.trim()).filter(Boolean);
  }
  assert.ok(latest, 'no column-level GRANT SELECT on devices found in migrations');
  return latest;
}

test('DEVICE_COLUMN_LIST equals the latest column-level SELECT grant on devices (as a set)', () => {
  assert.deepEqual([...DEVICE_COLUMN_LIST].sort(), latestDeviceSelectGrant().sort());
});

test('api_key is never selectable through the shared list', () => {
  assert.ok(!DEVICE_COLUMN_LIST.includes('api_key' as never));
  assert.ok(!DEVICE_COLUMNS.includes('api_key'));
});

test('DEVICE_COLUMNS is a comma-separated list of the same columns', () => {
  assert.equal(DEVICE_COLUMNS, DEVICE_COLUMN_LIST.join(','));
});

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

test('no wildcard read of the base devices table (select(*) / devices(*)) anywhere in src/', () => {
  const offenders: string[] = [];
  for (const file of walk(path.join(root, 'src')).filter((f) => /\.(ts|tsx)$/.test(f))) {
    const code = fs.readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');
    // from('devices') chained (possibly over several lines) into select('*'...)
    if (/from\(\s*'devices'\s*\)\s*\.select\(\s*['"`]\*/.test(code)) offenders.push(file + ' [from(devices).select(*)]');
    // embedded devices(*) inside any select string
    if (/devices\(\s*\*\s*\)/.test(code)) offenders.push(file + ' [devices(*)]');
  }
  assert.deepEqual(offenders, []);
});

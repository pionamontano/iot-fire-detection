// Step 6.2: UI side of the incident lifecycle. Static + unit tests; the database itself is tested in supabase/tests/local.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  availableTransitions, closeConfirmMessage, describeIncidentError, isClosedStatus, transitionIncident,
} from '../src/lib/incidents.ts';
import type { ActorRole, IncidentStatus, IncidentTarget } from '../src/lib/incidents.ts';

const root = path.resolve(import.meta.dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const STATUSES: IncidentStatus[] = ['active', 'acknowledged', 'responding', 'resolved', 'false_alarm'];

test('responder actions per status (hard-coded expectation)', () => {
  const expected: Record<IncidentStatus, IncidentTarget[]> = {
    active: ['acknowledged'],
    acknowledged: ['responding', 'resolved', 'false_alarm'],
    responding: ['resolved', 'false_alarm'],   // the FE-002 dead end: Resolve / False Alarm must be offered here
    resolved: [],
    false_alarm: [],
  };
  for (const s of STATUSES) assert.deepEqual(availableTransitions(s, 'bfp_responder'), expected[s], s);
});

test('admin may additionally close an unattended (active) incident', () => {
  assert.deepEqual(availableTransitions('active', 'admin'), ['acknowledged', 'resolved', 'false_alarm']);
  for (const s of ['acknowledged', 'responding'] as IncidentStatus[]) assert.deepEqual(availableTransitions(s, 'admin'), availableTransitions(s, 'bfp_responder'));
});

test('closed incidents offer no actions for any role', () => {
  for (const role of ['admin', 'bfp_responder'] as ActorRole[])
    for (const s of ['resolved', 'false_alarm'] as IncidentStatus[]) assert.deepEqual(availableTransitions(s, role), []);
});

test('a missing/null status (legacy typing) is treated as active', () => {
  assert.deepEqual(availableTransitions(undefined, 'bfp_responder'), ['acknowledged']);
  assert.deepEqual(availableTransitions(null, 'bfp_responder'), ['acknowledged']);
});

test('offered actions never include a self-transition or "active"', () => {
  for (const role of ['admin', 'bfp_responder'] as ActorRole[])
    for (const s of STATUSES) {
      const t = availableTransitions(s, role) as string[];
      assert.ok(!t.includes(s) && !t.includes('active'), `${role}/${s}`);
    }
});

// The UI hint must equal the database's rules. The SQL test file holds the independent, exhaustive matrix; parse it.
test('UI transition table equals the allowed pairs in the database matrix test (supabase/tests/local/incident_lifecycle.test.sql)', () => {
  const sql = read('supabase/tests/local/incident_lifecycle.test.sql');
  const pairsFor = (role: string): Set<string> => {
    const line = sql.split('\n').find((l) => l.includes(`r = '${role}'`) && l.includes("then 'ok'"));
    assert.ok(line, `no matrix line for ${role}`);
    return new Set([...line.matchAll(/\('(\w+)','(\w+)'\)/g)].map((m) => `${m[1]}>${m[2]}`));
  };
  for (const [role, sqlRole] of [['bfp_responder', 'bfp_responder'], ['admin', 'admin']] as [ActorRole, string][]) {
    const dbPairs = pairsFor(sqlRole);
    const uiPairs = new Set<string>();
    for (const from of ['active', 'acknowledged', 'responding'] as IncidentStatus[])
      for (const to of availableTransitions(from, role)) uiPairs.add(`${from}>${to}`);
    assert.deepEqual([...uiPairs].sort(), [...dbPairs].sort(), `${role}: UI offers ${[...uiPairs].sort()} vs database ${[...dbPairs].sort()}`);
  }
});

test('isClosedStatus / confirmation wording', () => {
  assert.ok(isClosedStatus('resolved') && isClosedStatus('false_alarm'));
  assert.ok(!isClosedStatus('active') && !isClosedStatus('responding') && !isClosedStatus(null) && !isClosedStatus(undefined));
  assert.match(closeConfirmMessage('resolved'), /RESOLVED/);
  assert.match(closeConfirmMessage('false_alarm'), /FALSE ALARM/);
  assert.match(closeConfirmMessage('resolved'), /cannot be reopened/);
});

test('describeIncidentError maps database SQLSTATEs to actionable messages', () => {
  assert.match(describeIncidentError({ code: '42501' }).message, /not allowed/i);
  assert.equal(describeIncidentError({ code: '42501' }).refresh, false);
  const conflict = describeIncidentError({ code: '55000', message: 'raw db text must not leak' });
  assert.match(conflict.message, /already updated|closed/i);
  assert.ok(conflict.refresh, 'a conflict means the list is stale');
  assert.ok(!conflict.message.includes('raw db text'), 'raw database text is not shown for known codes');
  assert.ok(describeIncidentError({ code: 'P0002' }).refresh);
  assert.match(describeIncidentError({ code: 'PGRST202' }).message, /database update/i);
  assert.match(describeIncidentError({ code: '22023' }).message, /not valid/i);
  assert.match(describeIncidentError({ code: 'XX', message: 'boom' }).message, /boom/);
  assert.match(describeIncidentError(null).message, /try again/i);
});

test('transitionIncident calls the RPC with exactly the signature of the migration', async () => {
  const calls: { fn: string; args: Record<string, unknown> | undefined }[] = [];
  const client = { rpc: async (fn: string, args?: Record<string, unknown>) => { calls.push({ fn, args }); return { data: { id: 'x' }, error: null }; } };
  const r = await transitionIncident(client, 'alert-1', 'responding');
  assert.equal(r.ok, true);
  assert.deepEqual(calls, [{ fn: 'transition_incident', args: { p_alert_id: 'alert-1', p_to: 'responding', p_notes: null } }]);
  await transitionIncident(client, 'alert-2', 'resolved', 'extinguished');
  assert.deepEqual(calls[1].args, { p_alert_id: 'alert-2', p_to: 'resolved', p_notes: 'extinguished' });

  // contract with the SQL: parameter names in the migration must be exactly the keys we send
  const mig = read('supabase/migrations/20261021000000_incident_lifecycle.sql');
  const sig = mig.match(/function public\.transition_incident\(([\s\S]*?)\)\s*returns/);
  assert.ok(sig, 'transition_incident signature not found');
  const sqlParams = sig[1].split(',').map((p) => p.trim().split(/\s+/)[0]).sort();
  assert.deepEqual(Object.keys(calls[0].args!).sort(), sqlParams);
});

test('transitionIncident turns database errors and network failures into results (never throws)', async () => {
  const dbErr = await transitionIncident({ rpc: async () => ({ data: null, error: { code: '55000', message: 'x' } }) }, 'a', 'resolved');
  assert.deepEqual([dbErr.ok, !dbErr.ok && dbErr.refresh], [false, true]);
  const net = await transitionIncident({ rpc: async () => { throw new Error('offline'); } }, 'a', 'resolved');
  assert.equal(net.ok, false);
  assert.match(!net.ok ? net.message : '', /network/i);
  assert.ok(!net.ok && net.refresh, 'after a network failure the true state is unknown, so refresh');
});

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

test('the UI never writes alert_events directly (all lifecycle writes go through transition_incident)', () => {
  const offenders: string[] = [];
  for (const f of walk(path.join(root, 'src')).filter((x) => /\.(ts|tsx)$/.test(x))) {
    const code = fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
    if (/from\(\s*['"]alert_events['"]\s*\)\s*\.(update|upsert|insert|delete)\s*\(/.test(code)) offenders.push(path.relative(root, f));
  }
  assert.deepEqual(offenders, []);
});

test('both pages that change incidents use the shared helper', () => {
  for (const f of ['src/pages/responder/ResponderDashboard.tsx', 'src/pages/admin/Alerts.tsx'])
    assert.match(read(f), /transitionIncident\(supabase,/, f);
});

test('the responder dashboard offers its buttons from availableTransitions, not from hard-coded status checks', () => {
  const code = read('src/pages/responder/ResponderDashboard.tsx');
  assert.match(code, /availableTransitions\(alert\.incident_status, 'bfp_responder'\)/);
  assert.doesNotMatch(code, /incident_status === 'acknowledged'/);
  assert.doesNotMatch(code, /acknowledged_by:/, 'the client must not write acknowledged_by');
});

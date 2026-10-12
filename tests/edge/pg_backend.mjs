// rpc backend that runs the REAL SQL functions (raise_alert / claim_notification / complete_notification) in a local
// PostgreSQL, as the service_role (the role the edge functions use). Local test database only.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const lit = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? (v ? 'true' : 'false') : `'${String(v).replace(/'/g, "''")}'`);

export function pgBackend(db, events = []) {
  const psql = (sql) => run('psql', ['-d', db, '-tAq', '-v', 'VERBOSITY=sqlstate', '-c', `set role service_role; ${sql}`], { env: process.env }).then((r) => r.stdout.trim());
  const impl = async (fn, a) => {
    events.push({ t: 'rpc', fn });
    try {
      if (fn === 'raise_alert') {
        const out = await psql(`select coalesce(json_agg(t), '[]') from raise_alert(${lit(a.p_device_id)}, ${lit(a.p_tier)}, ${lit(a.p_co)}, ${lit(a.p_temp)}, ${lit(a.p_lat)}, ${lit(a.p_lng)}, ${lit(a.p_gps_valid)}, ${lit(a.p_address)}) t`);
        return { data: JSON.parse(out.split('\n').filter((l) => l.startsWith('[')).pop()), error: null };
      }
      if (fn === 'claim_notification') {
        const out = await psql(`select claim_notification(${lit(a.p_alert)}, ${lit(a.p_tier)}, ${lit(a.p_channel)}, ${lit(a.p_recipient)})`);
        return { data: out.split('\n').pop() === 't', error: null };
      }
      if (fn === 'complete_notification') {
        await psql(`select complete_notification(${lit(a.p_alert)}, ${lit(a.p_tier)}, ${lit(a.p_channel)}, ${lit(a.p_recipient)}, ${lit(a.p_status)}, ${lit(a.p_provider_status)}, ${lit(a.p_provider_ref)}, ${lit(a.p_error)}, ${lit(a.p_retryable)})`);
        return { data: null, error: null };
      }
    } catch (e) {
      if (process.env.AGAP_DEBUG) console.error(`[pg_backend ${fn}] ${String(e.stderr || e.message).trim().split('\n')[0]}`);
      const m = String(e.stderr || '').match(/ERROR:\s+(\w{5})/);
      return { data: null, error: { code: m?.[1] ?? 'XX000', message: 'database error' } };
    }
    return { data: null, error: { code: 'PGRST202', message: 'unknown function' } };
  };
  const q = (sql) => run('psql', ['-d', db, '-tAq', '-c', sql], { env: process.env }).then((r) => r.stdout.trim());
  return { impl, q, exec: q };
}

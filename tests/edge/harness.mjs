// Test harness: runs the REAL supabase/functions/<name>/index.ts handler in Node against an
// in-memory fake Supabase client and a stubbed fetch. No network, no real notifications.
// (Deno is not required. URL imports are stripped and replaced with injected fakes.)
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '../../supabase/functions');

// ---- tiny PostgREST-style filter support for the fake DB ----
function splitTop(s) { // split on commas not inside parentheses
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++; if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur); return out;
}
function evalCond(cond, row) { // supports  col.eq.val  and  and(...)/or(...)
  const g = cond.match(/^(and|or)\((.*)\)$/s);
  if (g) { const parts = splitTop(g[2]).map(p => evalCond(p, row)); return g[1] === 'and' ? parts.every(Boolean) : parts.some(Boolean); }
  const m = cond.match(/^([^.]+)\.eq\.(.*)$/s);
  if (!m) throw new Error('fake DB: unsupported filter ' + cond);
  return String(row[m[1]]) === m[2];
}

export class FakeDb {
  // opts.rpc(fn, args) -> { data, error }. Without it every rpc behaves like a function that does not exist
  // (PostgREST PGRST202), i.e. a database where the Step 5.1 migrations have not been applied.
  constructor(tables, opts = {}) { this.tables = structuredClone(tables); this.log = []; this.rpcImpl = opts.rpc ?? null; }
  async rpc(fn, args) {
    this.log.push({ rpc: fn, args });
    if (this.rpcImpl) return this.rpcImpl(fn, args, this);
    return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` } };
  }
  from(table) {
    const db = this; const state = { table, filters: [], op: 'select', payload: null };
    const rows = () => (db.tables[table] ?? []).filter(r => state.filters.every(f => f(r)));
    const run = () => {
      db.log.push({ table, op: state.op, payload: state.payload, filters: state.filters.map(f => f.desc) });
      if (state.op === 'select') return { data: rows(), error: null };
      if (state.op === 'update') { const hit = rows(); hit.forEach(r => Object.assign(r, state.payload)); return { data: hit, error: null }; }
      if (state.op === 'insert') { const arr = [].concat(state.payload).map(r => ({ id: 'new-' + Math.random().toString(36).slice(2), ...r })); (db.tables[table] ??= []).push(...arr); return { data: arr, error: null }; }
      if (state.op === 'upsert') { return { data: [].concat(state.payload), error: null }; }
      if (state.op === 'delete') { return { data: [], error: null }; }
    };
    const add = (desc, fn) => { fn.desc = desc; state.filters.push(fn); return b; };
    const b = {
      select() { return b; }, order() { return b; }, limit() { return b; },
      eq: (c, v) => add(`${c}=eq.${v}`, r => r[c] === v),
      neq: (c, v) => add(`${c}=neq.${v}`, r => r[c] !== v),
      is: (c, v) => add(`${c}=is.${v}`, r => (r[c] ?? null) === v),
      in: (c, vs) => add(`${c}=in.(${vs})`, r => vs.includes(r[c])),
      or: (expr) => add(`or(${expr})`, r => splitTop(expr).some(c => evalCond(c, r))),
      update(p) { state.op = 'update'; state.payload = p; return b; },
      insert(p) { state.op = 'insert'; state.payload = p; return b; },
      upsert(p) { state.op = 'upsert'; state.payload = p; return b; },
      delete() { state.op = 'delete'; return b; },
      maybeSingle: async () => { const res = run(); return { data: res.data[0] ?? null, error: null }; },
      single: async () => { const res = run(); return res.data[0] ? { data: res.data[0], error: null } : { data: null, error: { message: 'no rows' } }; },
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    };
    return b;
  }
}

/** Load a function's index.ts and return the handler it registers with serve(). */
export function loadHandler(name, { db, env = {}, user = null, fetchImpl, webpush } = {}) {
  let src = fs.readFileSync(path.join(ROOT, name, 'index.ts'), 'utf8');
  src = src.replace(/^import .*$/gm, '');
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  let handler = null;
  const serve = (h) => { handler = h; };
  const createClient = () => Object.assign(db, {
    auth: { getUser: async () => (user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'no user' } }) },
  });
  const Deno = { env: { get: (k) => env[k] } };
  const origFetch = globalThis.fetch;
  new Function('serve', 'createClient', 'Deno', 'webpush', 'fetch', js)(serve, createClient, Deno, webpush, fetchImpl ?? origFetch);
  if (!handler) throw new Error('no handler registered by ' + name);
  return handler;
}

export const json = (res) => res.json();
export const req = (body, headers = {}) => new Request('http://local/fn', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

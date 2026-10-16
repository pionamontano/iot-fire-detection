// Where the black-box suite points. Defaults to the local stack from `supabase start`; refuses
// anything that is not localhost unless E2E_ALLOW_REMOTE=1, and refuses production outright,
// because global setup deletes and recreates accounts and devices.
import { execSync } from 'node:child_process';

const PRODUCTION_REF = 'fnfgakcmdosxsthvekwj';

export interface E2eEnv {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  baseUrl: string;
}

function fromSupabaseStatus(): Pick<E2eEnv, 'supabaseUrl' | 'anonKey' | 'serviceRoleKey'> {
  let out: string;
  try {
    out = execSync('supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    throw new Error(
      'E2E: no Supabase target. Start the local stack with `supabase start`, or set ' +
      'E2E_SUPABASE_URL, E2E_SUPABASE_ANON_KEY and E2E_SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
  const status = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
  return { supabaseUrl: status.API_URL, anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
}

export function resolveEnv(): E2eEnv {
  const e = process.env;
  const target = e.E2E_SUPABASE_URL && e.E2E_SUPABASE_ANON_KEY && e.E2E_SUPABASE_SERVICE_ROLE_KEY
    ? { supabaseUrl: e.E2E_SUPABASE_URL, anonKey: e.E2E_SUPABASE_ANON_KEY, serviceRoleKey: e.E2E_SUPABASE_SERVICE_ROLE_KEY }
    : fromSupabaseStatus();

  const host = new URL(target.supabaseUrl).hostname;
  if (host.startsWith(PRODUCTION_REF)) {
    throw new Error('E2E: refusing to run against the production Supabase project.');
  }
  if (!['127.0.0.1', 'localhost'].includes(host) && e.E2E_ALLOW_REMOTE !== '1') {
    throw new Error(`E2E: ${host} is not local. Set E2E_ALLOW_REMOTE=1 to run against a disposable remote project.`);
  }

  // Share with the Playwright workers, which inherit the runner's environment.
  e.E2E_SUPABASE_URL = target.supabaseUrl;
  e.E2E_SUPABASE_ANON_KEY = target.anonKey;
  e.E2E_SUPABASE_SERVICE_ROLE_KEY = target.serviceRoleKey;
  return { ...target, baseUrl: e.E2E_BASE_URL ?? 'http://127.0.0.1:4173' };
}

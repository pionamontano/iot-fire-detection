// Clients for arranging state (service role) and for acting as a given account (anon key + that
// account's JWT), plus raw Edge Function calls. Tests assert through these exactly what a real
// caller with that role could do.
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';
import { ACCOUNTS, PASSWORD, type AccountName } from './accounts.ts';
import { resolveEnv } from './env.ts';

export const env = resolveEnv();

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };

export const admin: SupabaseClient = createClient(env.supabaseUrl, env.serviceRoleKey, noPersist);

export const anonClient = (): SupabaseClient => createClient(env.supabaseUrl, env.anonKey, noPersist);

/** Signs in directly with GoTrue (not the login function, so no login_attempts row). */
export async function signIn(name: AccountName): Promise<{ client: SupabaseClient; session: Session }> {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email: ACCOUNTS[name].email, password: PASSWORD });
  if (error || !data.session) throw new Error(`E2E: sign-in as ${name} failed: ${error?.message}`);
  return { client, session: data.session };
}

export const clientAs = async (name: AccountName) => (await signIn(name)).client;

/** Opens the app already signed in as `name`, the way supabase-js persists a session. */
export async function useSession(page: Page, name: AccountName): Promise<void> {
  const { session } = await signIn(name);
  const key = `sb-${new URL(env.supabaseUrl).hostname.split('.')[0]}-auth-token`;
  await page.addInitScript(([k, v]) => {
    if (!window.localStorage.getItem(k)) window.localStorage.setItem(k, v);
  }, [key, JSON.stringify(session)] as const);
}

/** POSTs to an Edge Function and returns status + parsed JSON (or raw text). */
export async function callFunction(
  name: string,
  { body, headers = {}, method = 'POST', rawBody }: { body?: unknown; headers?: Record<string, string>; method?: string; rawBody?: string } = {},
): Promise<{ status: number; json: Record<string, unknown> | null; text: string; headers: Headers }> {
  const res = await fetch(`${env.supabaseUrl}/functions/v1/${name}`, {
    method,
    headers: { 'Content-Type': 'application/json', apikey: env.anonKey, ...headers },
    body: method === 'GET' || method === 'OPTIONS' ? undefined : rawBody ?? JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}

export async function deviceByCode(code: string) {
  const { data, error } = await admin.from('devices').select('*').eq('device_code', code).single();
  if (error) throw error;
  return data as { id: string; api_key: string; device_code: string; co_threshold: number; temp_threshold: number };
}

export async function profileByEmail(email: string) {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const user = users.users.find((u) => u.email === email);
  if (!user) throw new Error(`E2E: no user ${email}`);
  const { data } = await admin.from('profiles').select('*').eq('id', user.id).single();
  return data as { id: string; role: string; status: string; contact_number: string | null; device_id: string | null };
}

/** Backdates `count` failed login attempts for `email`, `secondsAgo` in the past. */
export async function seedFailedAttempts(email: string, count: number, secondsAgo: number) {
  const attempted_at = new Date(Date.now() - secondsAgo * 1000).toISOString();
  const { error } = await admin.from('login_attempts')
    .insert(Array.from({ length: count }, () => ({ email, success: false, attempted_at })));
  if (error) throw error;
}

export async function clearLoginAttempts(email: string) {
  await admin.from('login_attempts').delete().eq('email', email);
  await admin.from('login_lockout_overrides').delete().eq('email', email);
}

// Starts serve.mjs (build + preview) as a direct child process and returns a function that stops
// it. Used instead of Playwright's `webServer`: that always launches through a shell, and on
// Windows its `taskkill /T` of the shell tree took minutes and kept `playwright test` alive.
import { spawn } from 'node:child_process';
import { env } from './supabase.ts';

const isUp = async (url: string) => {
  try { return (await fetch(url)).ok; } catch { return false; }
};

export async function startAppServer(): Promise<() => Promise<void>> {
  if (await isUp(env.baseUrl)) {
    if (process.env.CI) throw new Error(`E2E: ${env.baseUrl} is already in use.`);
    console.log(`[e2e] reusing the app already served at ${env.baseUrl}`);
    return async () => {};
  }

  const child = spawn(process.execPath, ['tests/e2e/serve.mjs'], {
    env: { ...process.env, VITE_SUPABASE_URL: env.supabaseUrl, VITE_SUPABASE_ANON_KEY: env.anonKey, E2E_BASE_URL: env.baseUrl },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  let exited = false;
  child.once('exit', () => { exited = true; });

  const deadline = Date.now() + 180_000;
  while (!(await isUp(env.baseUrl))) {
    if (exited) throw new Error('E2E: the app server (tests/e2e/serve.mjs) exited before it was ready.');
    if (Date.now() > deadline) { child.kill(); throw new Error('E2E: the app server did not come up within 180s.'); }
    await new Promise((r) => setTimeout(r, 500));
  }

  return async () => {
    if (exited) return;
    const gone = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill();
    await Promise.race([gone, new Promise((r) => setTimeout(r, 5_000))]);
  };
}

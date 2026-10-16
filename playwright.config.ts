// Black-box suite (tests/e2e): drives the built app and the Supabase APIs as real users of each
// role would. Runs against the local stack from `supabase start`; see tests/e2e/README.md.
import { defineConfig, devices } from '@playwright/test';
import { resolveEnv } from './tests/e2e/support/env.ts';

const env = resolveEnv();
const ARTIFACTS = 'tests/e2e/.artifacts';

// The UI project runs against the production build, which global setup builds and serves
// (support/app-server.ts) unless E2E_BASE_URL points at one already. `--project=api` needs
// no app, so it skips that.
const args = process.argv.join(' ');
const apiOnly = /--project[= ]api\b/.test(args) && !/--project[= ]ui\b/.test(args);
process.env.E2E_SERVE_APP = process.env.E2E_BASE_URL || apiOnly ? '0' : '1';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  outputDir: `${ARTIFACTS}/results`,
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  // More parallel callers than this exhaust the local Edge Runtime, which then answers
  // `WORKER_LIMIT` ("Worker failed to respond due to a resource limit") instead of running the function.
  workers: 4,
  // The local Docker stack serves every worker at once; the app's first auth/profile load can
  // take longer than the 5s default under that load.
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: `${ARTIFACTS}/report`, open: 'never' }]]
    : [['list'], ['html', { outputFolder: `${ARTIFACTS}/report`, open: 'never' }]],
  use: {
    baseURL: env.baseUrl,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'api', testMatch: 'api/**/*.spec.ts' },
    { name: 'ui', testMatch: 'ui/**/*.spec.ts', use: { ...devices['Desktop Chrome'] } },
  ],
});

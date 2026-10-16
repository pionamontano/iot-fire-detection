// Builds the app and serves the production build in this one process (Playwright's webServer).
// A single process matters on Windows, where a `build && preview` shell chain outlives the
// runner's kill and keeps `playwright test` from exiting. VITE_SUPABASE_* come from the
// environment Playwright passes in, overriding .env.
import { build, preview } from 'vite';

const outDir = 'tests/e2e/.artifacts/dist';
const { hostname, port } = new URL(process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173');

await build({ logLevel: 'warn', build: { outDir, emptyOutDir: true } });
const server = await preview({ build: { outDir }, preview: { host: hostname, port: Number(port), strictPort: true } });
server.printUrls();

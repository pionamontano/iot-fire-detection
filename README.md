# AgapSense

AgapSense is an IoT-based fire detection and location tracking system. ESP32 sensor nodes watch CO and
temperature in a building; when readings cross a threshold the node sounds a local alarm and reports to a
Supabase backend, which notifies the resident and the Bureau of Fire Protection (BFP) by Telegram, browser
push and SMS. A role-based web dashboard lets residents, BFP responders and administrators follow devices
and incidents in real time.

## Repository layout

| Path | What it holds |
|---|---|
| [`src/`](src) | React + TypeScript web app (Vite, Tailwind CSS v4, React Router v7, Leaflet) |
| [`public/`](public) | Static assets and the Web Push service worker (`sw.js`) |
| [`supabase/migrations/`](supabase/migrations) | PostgreSQL schema, RLS policies, grants and RPCs, applied in timestamp order |
| [`supabase/functions/`](supabase/functions) | Deno Edge Functions (login, registration, device ingest, alerts, notifications, support requests) |
| [`supabase/tests/local/`](supabase/tests/local) | SQL tests run against a throwaway local PostgreSQL built from the migrations |
| [`supabase/staging/`](supabase/staging), [`supabase/maintenance/`](supabase/maintenance) | Staging dry-run scripts and one-off maintenance / backfill SQL |
| [`firmware/agapsense-firmware/`](firmware/agapsense-firmware) | ESP32 firmware (PlatformIO) and its host-side logic tests |
| [`tests/`](tests) | Unit tests (`*.test.ts`), Edge Function tests (`edge/`) and the Playwright black-box suite (`e2e/`) |
| [`testing/`](testing) | Manual QA checklists, live verification reports and a Postman hardware-simulation collection |
| [`docs/`](docs) | Project documentation — start with the [documentation index](docs/README.md) |

## Roles and pages

Authority lives in the database (RLS, grants, RPCs) and Edge Functions; `AuthGuard` route protection in the
SPA is a UI convenience. Routes are defined in [`src/App.tsx`](src/App.tsx).

| Role | Routes | Pages (`src/pages/`) |
|---|---|---|
| Admin (`admin`) | `/dashboard`, `/admin/*` | `admin/Dashboard`, `InteractiveMap` (Live Map), `Devices`, `Users`, `DeviceStatus`, `Logs` (System Log), `SupportRequests`, `Settings` |
| BFP Responder (`bfp_responder`) | `/responder/*` | `responder/ResponderDashboard`, `ResponderAlertLogs`, `ResponderSettings` |
| Resident (`resident`) | `/setup`, `/home/*`, `/account` | `resident/ResidentSetup`, `ResidentHome`, `ResidentAlerts`, `ResidentAlertSettings`, `ResidentDeviceInfo`, `ResidentAccount` |
| Public | `/login`, `/register/*`, `/forgot-password`, … | `auth/*`, `common/NotFound` |

Shared pieces: `src/contexts/AuthContext.tsx` (session and profile), `src/components/` (role layouts, tables,
maps, badges), `src/lib/` (Supabase client and domain helpers), `src/hooks/`.

See [`docs/FEATURES.md`](docs/FEATURES.md) for what each feature and Edge Function does.

## Running locally

Requires Node.js 18+ (CI uses 22).

```bash
npm install
cp .env.example .env   # then fill in your Supabase keys
npm run dev            # http://localhost:5173
```

`.env`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
# optional, for browser push notifications
VITE_VAPID_PUBLIC_KEY=your_vapid_public_key
```

To stand up a new Supabase project (schema, first admin, Edge Function secrets, deployment) follow
[`docs/MIGRATION_GUIDE.md`](docs/MIGRATION_GUIDE.md). For the firmware, see
[`docs/FIRMWARE_GUIDE.md`](docs/FIRMWARE_GUIDE.md).

## Checks and tests

| Command | What it runs |
|---|---|
| `npm run typecheck` | `tsc -b` over the app, Vite config and e2e suite |
| `npm run lint` | `oxlint` |
| `npm test` | Unit and Edge Function tests (`node --test`) |
| `npm run build` | Production build |
| `npm run test:e2e` | Playwright black-box suite against a local `supabase start` stack — see [`tests/e2e/README.md`](tests/e2e/README.md) |
| `supabase/tests/local/run_local_db_tests.sh <db> <test.sql>…` | Database tests on a throwaway local PostgreSQL |
| `firmware/agapsense-firmware/host_tests/run.sh` | Firmware logic tests with `g++` — see its [README](firmware/agapsense-firmware/host_tests/README.md) |

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs typecheck, lint, unit tests, the e2e suite and
the build on every pull request.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

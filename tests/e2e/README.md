# Black-box test suite (Playwright)

Automates the manual checklists in [`testing/reports/`](../../testing/reports/): the app and its
APIs are exercised only from the outside, the way a resident, BFP responder, admin, device or
attacker would reach them.

| Project | Files | What it drives |
|---|---|---|
| `api` | [`api/rbac.spec.ts`](api/rbac.spec.ts) | PostgREST / RPC with each role's real JWT: the CRUD matrix of `ROLE_BASED_ACCESS_TESTING.md` |
| `api` | [`api/edge-functions.spec.ts`](api/edge-functions.spec.ts) | Edge Functions as the firmware and browser call them: `ERROR_EDGE_CASE_TESTING.md` |
| `ui` | [`ui/login.spec.ts`](ui/login.spec.ts), [`ui/lockout.spec.ts`](ui/lockout.spec.ts), [`ui/session.spec.ts`](ui/session.spec.ts) | `AUTHENTICATION_TESTING.md`: validation, enumeration, redirects, lockout tiers, logout, idle timeout |
| `ui` | [`ui/access-control.spec.ts`](ui/access-control.spec.ts) | Route isolation per role, setup gating, pending accounts, Not Found |
| `ui` | [`ui/layout.spec.ts`](ui/layout.spec.ts), [`ui/registration.spec.ts`](ui/registration.spec.ts) | `UI_UX_TESTING.md`: shells at 375/768/1440px, mobile menu, overflow, keyboard order, form validation, sign-up |

The UI project runs against the **production build** (`vite build` + `vite preview`, in
[`serve.mjs`](serve.mjs)), as the UI checklist requires. Global setup starts it
([`support/app-server.ts`](support/app-server.ts)) and stops it afterwards; an app already
listening on port 4173 is reused locally, and `E2E_BASE_URL` points the suite at one you serve
yourself. (Playwright's built-in `webServer` is not used: on Windows its shell-tree kill took
minutes and kept the runner from exiting.)

## Running it

Needs Docker and the Supabase CLI.

```sh
supabase start                     # local stack built from supabase/migrations, Edge Functions included
npx playwright install chromium    # once
npm run test:e2e                         # everything (184 tests, ~1.5 min)
npm run test:e2e:api                     # API project only (no browser, no build)
npm run test:e2e -- --project=ui         # UI project only
npm run test:e2e -- -g "lockout"         # by test title
npm run test:e2e:report                  # open the HTML report of the last run
```

### Troubleshooting

- **`WORKER_LIMIT` / "Worker failed to respond due to a resource limit"** in a failure: the
  local Edge Runtime ran out of resources. The config caps the suite at 4 workers for this
  reason; don't raise `--workers` above that.
- **Edge Function calls return 503 "name resolution failed"** after a reboot or sleep: the
  `supabase_edge_runtime` container didn't come back. Run `supabase stop && supabase start`.
- On this project's Windows machine, launching through `npx playwright …` added minutes of
  delay before exit; the npm scripts call the local binary directly and don't.

Credentials come from `supabase status`; nothing needs to be configured. CI runs the same
thing in the `e2e` job of [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) and
uploads the HTML report as the `e2e-report` artifact.

### Safety

- [`support/env.ts`](support/env.ts) refuses any Supabase URL that is not localhost, and refuses
  the production project unconditionally. To target a disposable remote project (e.g.
  staging), set `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`, `E2E_SUPABASE_SERVICE_ROLE_KEY`
  and `E2E_ALLOW_REMOTE=1`.
- [`global-setup.ts`](global-setup.ts) first **deletes** every user under
  `@e2e.agapsense.test`, every device whose code starts with `E2E-`, and their readings,
  incidents and login attempts, then recreates the fixtures in
  [`support/accounts.ts`](support/accounts.ts). It touches nothing else.

## How the tests are written

- **Arrange with the service role, act and assert as the real caller.** Setup (accounts,
  devices, backdated failed logins) uses the service role; every check uses the anon key plus
  that role's own JWT, the login page, or a device's `x-device-key`.
- **"Cannot" is checked on the outcome**: the row is unchanged / not returned, not merely
  "an error came back", so a check holds whether the denial comes from a GRANT or from RLS.
- **No waiting on real time.** Lockout tiers are reached by backdating earlier failures; the
  idle timeout is tested by fast-forwarding the browser clock (`page.clock`) past the
  60-minute timeout global setup configures.
- Tests that sign out, lock or revoke an account each get their own account, so the suite
  runs fully parallel.
- `test.fail()` marks a **known, reported gap** (see Findings). The test asserts the intended
  behaviour and is expected to fail; once the gap is fixed Playwright reports it as an
  unexpected pass, which is the cue to delete the `test.fail()` line.

## Findings (first run, 2026-10-15)

Found by this suite. Open items are pinned by a `test.fail()` (or noted) so they cannot
regress silently and flip to an "unexpected pass" once fixed; fixed items keep their test as a
regression check.

| # | Finding | Where | Status / test |
|---|---|---|---|
| 1 | **Any signed-in account (pending, rejected, deactivated) could read every `settings` row.** `20260917030000` dropped `"Anyone authenticated can read settings"`, but `init.sql` had named it `"Authenticated users can read settings"`, so the `IF EXISTS` drop did nothing and the permissive policy stayed ORed in. | DB / RLS | **Fixed** in `20261106000000`; `api/rbac.spec.ts` › pending, rejected and deactivated accounts read no settings |
| 2 | **`check_login_lockout` was callable by any client.** `20260924080000` revoked EXECUTE from `anon`/`authenticated` but not from `PUBLIC`, so anyone could probe any email's lockout state. | DB / grants | **Fixed** in `20261106000000`; `api/rbac.spec.ts` › clients cannot call check_login_lockout |
| 3 | **The "Account temporarily locked" screen disappears after ~1 second.** `Login.tsx` shows it only while `lockoutTimer >= 900`; the first countdown tick drops it to 899 and the normal form returns with a "Try again in 14:59" countdown. Fix: key the full-page screen off the tier (e.g. a `hardLocked` flag set when the server returns ≥ 900), not the live countdown. | Frontend | `ui/lockout.spec.ts` › the "Account temporarily locked" screen stays up |
| 4 | **Production ACLs are broader than the migrations intend.** Production still grants table-wide `SELECT` on `devices` to `anon`/`authenticated` (revoked in `20261015000000`), and `INSERT`/`UPDATE` on `alert_events` (revoked in `20260917010000`, `20261012000001`, `20261022000000`). RLS currently blocks the rows, so this is lost defence-in-depth rather than an open hole, but it is drift. The local stack has the intended (narrower) grants, so the suite cannot see this; compare with the production ACL dump. | Production DB | — |
| 5 | The mobile menu (hamburger) button in all three layouts has no accessible name; screen readers announce an unlabeled button. Fix: `aria-label="Open menu"` / `"Close menu"`. | Frontend / a11y | noted in `ui/layout.spec.ts` |

Checklist items that turned out to be **stale** and were automated against current behaviour
instead: resident/responder profile reads (narrowed to own row by `20261019000000`), admin
`api_key` reads (via `devices_safe`, not the base table, since `20261015000000`), registration
errors (now field-level, so the earlier "top-of-form banner" UX finding is resolved), and the
`trigger-alert` "tier" field (the server now derives the tier from thresholds).

## Schema prerequisite: explicit grants

New Supabase projects and local stacks no longer grant `public` tables and functions to the
API roles automatically (the CLI's `auto_expose_new_tables` opt-out is removed on
2026-10-30). The earlier migrations relied on that default, so a stack built from them alone
rejected every API call. [`20261105000000_explicit_data_api_grants.sql`](../../supabase/migrations/20261105000000_explicit_data_api_grants.sql)
states the grants explicitly. It is GRANT-only and every grant in it is already held in
production (checked against a production ACL dump on 2026-10-15), so it is a no-op there.

**From now on, a migration that creates a table, view, sequence or function must also GRANT
it** to the roles that need it, or it will be unreachable everywhere except production.

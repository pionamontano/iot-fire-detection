# Live Testing Summary

A single compiled overview of every live-testing pass run against the
real AgapSense production stack (Supabase project
`fnfgakcmdosxsthvekwj`, and the deployed app at
`iot-fire-detection.vercel.app`). The detailed request-by-request logs
live in `LIVE_DATABASE_VERIFICATION.md`, `LIVE_RBAC_VERIFICATION.md`, and
`LIVE_AUTH_VERIFICATION.md` (this folder) — this document synthesizes
them into one narrative: what was tested, what broke, what got fixed,
and what's still open.

## Methodology

All three passes used the same discipline:
- **Real infrastructure, not mocks.** Direct PostgREST/RPC/Edge Function
  calls against the live Supabase project, and (for auth) a real running
  instance of the app driven with Playwright — never a local stand-in.
- **Disposable test data only.** Every account, device, and row created
  for a test was deleted via the app's own real APIs immediately after
  use (`manage-registration`'s `delete` action, direct `DELETE`s on
  throwaway devices). Nothing fabricated was left in production.
- **No destructive tests against real data.** Where a test could only be
  proven by mutating real rows (e.g. deleting a real alert, resolving a
  real incident), it was either skipped in favor of schema-certainty
  reasoning, or performed as a no-op that provably left the value
  unchanged (e.g. `station_settings` write-back of its own existing
  value).
- **Verify, don't assume.** Several checklist items turned out to be
  wrong or stale once actually tested against production, and were
  corrected in place rather than left as-written.

## Bugs found and fixed

Nine real bugs were found this way, all fixed and confirmed live
end-to-end (fix shipped → re-tested against production → passing):

| # | Bug | Area | Fix | PR |
|---|---|---|---|---|
| 1 | `admin_unlock_login`/`regenerate_device_api_key` used `<> 'admin'`, which evaluates to `NULL` (not `TRUE`) for an unauthenticated caller — the admin check silently never fired. Confirmed live: an anonymous client could clear any account's brute-force lockout. | Database / RBAC | `IS DISTINCT FROM` instead of `<>`; also fixed an unrelated `search_path` bug blocking `gen_random_bytes` for real admin calls | [#22](https://github.com/pionamontano/iot-fire-detection/pull/22) |
| 2 | `devices_safe` masked `api_key` for non-admins, but the base `devices` table still had its own SELECT policies for `resident`/`bfp_responder` — anyone could bypass the mask entirely by querying the base table directly. Confirmed live: a disposable resident's own device returned its real key. | Database / RBAC | Dropped the two non-admin SELECT policies from the base table | [#24](https://github.com/pionamontano/iot-fire-detection/pull/24) |
| 3 | `devices.co_threshold`/`temp_threshold` had no DB-level CHECK constraint — a direct admin write could set a nonsensical or inverted alert threshold with nothing to stop it. | Database | Added `CHECK` constraints matching the bounds already enforced in the resident RPC (0–1000ppm / 0–100°C) | [#26](https://github.com/pionamontano/iot-fire-detection/pull/26) |
| 4 | Fixing bug #2 by dropping those policies also broke `devices_safe` itself — it's a `security_invoker` view, so its row visibility depended on the same policies. Confirmed live: `devices_safe` returned `[]` for both a resident and a responder after the fix. | Database / RBAC | Switched the view to `security_invoker = off` with its own row-scoping `WHERE` clause, independent of the base table's grants | [#28](https://github.com/pionamontano/iot-fire-detection/pull/28) |
| 5 | Pending/rejected accounts authenticated successfully but hung forever on "Authenticating..." instead of reaching the Account Pending/Rejected screens. Root cause: the HIGH-03 profiles-read fix blocked a non-approved user from reading even their *own* row, so `fetchProfile` never resolved. | Authentication | Let a user always read their own profile row (`... OR id = auth.uid()`), which doesn't reopen the original bulk-read vulnerability | [#29](https://github.com/pionamontano/iot-fire-detection/pull/29) |
| 6 | Idle timeout signed the user out correctly but landed on `/login` instead of `/session-expired` — a race where `AuthGuard`'s own redirect fired before the idle-timeout hook's navigation took effect. | Authentication | Reordered `useIdleTimeout.ts` to navigate before signing out | [#29](https://github.com/pionamontano/iot-fire-detection/pull/29) |
| 7 | Login lockout had no server-side enforcement at all. The client checked `check_login_lockout` before attempting sign-in and could simply skip that check; `signInWithPassword` itself was never gated. Confirmed live: 7 real form submissions against a locked account recorded only 3 failures, and 10 direct calls to Supabase's auth endpoint were completely unthrottled. | Authentication | New `login` Edge Function does the check-then-record atomically with the service role; `login_attempts` INSERT and `check_login_lockout` EXECUTE revoked from the client entirely | [#30](https://github.com/pionamontano/iot-fire-detection/pull/30) |
| 8 | Even with enforcement fixed, the lockout still couldn't escalate: `check_login_lockout` had no time decay, so once a tier's threshold was hit, every check for up to 15 minutes returned the same flat result — tiers 2/3 were structurally unreachable, just consistently so instead of skippably. Found by testing fix #7 once deployed. | Authentication | Rewrote `check_login_lockout` to track elapsed time since the most recent failure and let exactly one more real attempt through once a tier's cooldown genuinely elapses | [#31](https://github.com/pionamontano/iot-fire-detection/pull/31) |
| 9 | `ROLE_BASED_ACCESS_TESTING.md` itself incorrectly claimed no role, including admin, could delete an `alert_events` row — the admin `FOR ALL` policy actually covers `DELETE` too. | Documentation | Corrected in place; not exercised live to avoid destroying real incident history | [#28](https://github.com/pionamontano/iot-fire-detection/pull/28) |

## Confirmed working, by area

**Database integrity** (`DATABASE_TESTING.md`, `LIVE_DATABASE_VERIFICATION.md`):
foreign key restrict behavior, unique constraints (`devices.device_code`,
`settings.key`, `station_settings` singleton — both its PK and CHECK),
required-field/NOT NULL enforcement across `devices`/`registration_requests`/
`station_settings`/`login_attempts`, CHECK constraint enforcement
(`registration_requests.requested_role`, the RPC bounds), timestamp
auto-population with correct timezone handling, cascading deletes
(`auth.users → profiles → registration_requests`), and duplicate-email
registration rejection with no orphaned partial data.

**Role-based access** (`ROLE_BASED_ACCESS_TESTING.md`, `LIVE_RBAC_VERIFICATION.md`):
full CRUD boundary testing across admin/resident/responder for devices,
profiles, sensor readings, alert events, login attempts, settings,
station settings, and registration requests. Notably proved live that
account revocation (pending → approved → rejected) takes effect
*immediately* on the very next request using the same already-issued
JWT — nothing is cached client-side.

**Authentication** (`AUTHENTICATION_TESTING.md`, `LIVE_AUTH_VERIFICATION.md`):
credential validation (HTML5 constraints, SQL injection, XSS, long input),
no user-enumeration, correct role-based redirects, resident setup-gating,
logout (session destruction, back-button, direct-URL-after-logout), idle
timeout, and — after the two fixes above — a login lockout that actually
escalates through all three tiers (3→10s, 5→30s, 7→900s) with real,
decaying countdowns.

## Deliberately left open (not oversights)

- **Direct-to-GoTrue brute force.** A scripted attacker who bypasses this
  app entirely and calls Supabase's `/auth/v1/token` endpoint directly
  with the public anon key is unaffected by the `login` function or its
  lockout — GoTrue is a separate service outside this repo's reach.
  Checked the project's actual Rate Limits dashboard setting: 30
  sign-in/sign-up requests per 5 minutes per IP (the Supabase default),
  looser than this app's own tier-1 threshold but not nothing. Left
  as-is by the project owner's explicit decision, given the risk of
  locking out multiple legitimate users (e.g. BFP responders) sharing a
  station's network IP. Supabase's CAPTCHA/Attack Protection feature was
  flagged as the more targeted lever if revisited.

## Still not independently testable

A recurring, honest limitation across all three passes: several checks
need either the **service-role key** (never available in this session)
or a scenario that would require **destroying real production data** to
prove. These stay unchecked in the individual checklists rather than
being claimed without evidence:

- `sensor_readings`/`alert_events` required-field and invalid-data
  checks — both tables are service-role-only by design (confirmed: even
  an authenticated admin gets `403` trying to insert directly).
- `profiles.role`/`profiles.status` CHECK constraints, and the
  `profiles_device_id_resident_unique` index as an independent backstop
  — inferable with high confidence from other confirmed CHECK
  constraints and app-layer checks, but not isolated directly.
- Admin resolving a real `alert_events` row, and anything requiring a
  genuinely destructive action against real incident/device history.
- Browser-only behaviors needing a real multi-tab session or precise
  mid-countdown input timing (idle-timer reset, cross-tab logout sync).

## Not yet started

Two checklists exist in this folder with no live-verification pass yet —
both explicitly marked "Not yet run" as of this writing:

- **`ERROR_EDGE_CASE_TESTING.md`** — Edge Function boundary behavior
  (malformed device payloads, network/timeout failures, firmware
  quirks). Needs testing against the *deployed* functions specifically,
  since cold-start/timeout behavior differs from local `supabase
  functions serve`.
- **`UI_UX_TESTING.md`** — frontend layout/interaction checklist across
  the three role-specific shells and three viewport widths. This is
  squarely the kind of thing the Playwright-driven approach used for
  `AUTHENTICATION_TESTING.md` could execute directly against the
  production build.

## Bottom line

Nine real, confirmed bugs — three of them genuine security holes (the
NULL-bypass, the `api_key` masking bypass, and the unenforced login
lockout) — were found only because these checklists were executed
against live infrastructure instead of taken on faith. Every fix above
is deployed and re-verified in production, not just merged. The one
remaining gap (direct GoTrue brute force) is a documented, deliberate
trade-off, not an unknown. The two newer checklists (error/edge-case,
UI/UX) are the natural next live-testing passes if this effort
continues.

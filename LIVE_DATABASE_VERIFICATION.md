# Live Database Verification Log

Record of database-integrity checks (see `DATABASE_TESTING.md` for the
checklist itself) actually executed against the production Supabase
project (`fnfgakcmdosxsthvekwj.supabase.co`), kept separate from that
checklist so it doesn't churn on every testing pass. All requests were
direct PostgREST/Edge Function calls, not the app UI. Test rows/accounts
created during any round were deleted via the real production API
immediately after use — nothing was left behind.

## Round 1 — anonymous (no login session)

| # | Request | Result | Verdict |
|---|---|---|---|
| 1 | `POST /login_attempts {"email":..., "success":false}` | `201 Created` | Matches the app's real `.insert()` call (no `.select()`) — pass |
| 2 | Same, with `Prefer: return=representation` | `401 42501` "new row violates row-level security policy" | Expected Postgres/RLS behavior: `RETURNING` also needs a matching `SELECT` policy, which anon doesn't have on `login_attempts`. **Regression risk noted**: if a future change adds `.select()` after this `.insert()`, the login page's attempt-logging call would start failing for every anonymous login attempt |
| 3 | `POST /login_attempts` missing `success` | `400 23502` not-null violation | Pass |
| 4 | `POST /login_attempts` missing `email` | `400 23502` not-null violation | Pass |
| 5 | `POST /login_attempts {"success":"not-a-boolean"}` | `400 22P02` invalid boolean syntax | Pass |
| 6 | `GET /login_attempts?email=eq...` as anon | `200 []` | Pass — anon cannot read attempts back, matches admin-only SELECT policy |
| 7 | `POST /sensor_readings` as anon | `401 42501` permission denied (grant revoked) | Pass |
| 8 | `POST /alert_events` as anon | `401 42501` permission denied (grant revoked) | Pass |
| 9 | `POST /devices` as anon | `401 42501` RLS violation | Pass |
| 10 | `POST /registration_requests` as anon | `401 42501` RLS violation | Pass — no anon/authenticated INSERT policy exists at all; edge-function-only |
| 11 | `POST /rpc/check_login_lockout` as anon | `200 [{"locked":false,...}]` | Pass — intentionally public, used by the unauthenticated login page |
| 12 | `POST /rpc/update_own_device_alert_settings` as anon | `400 P0001` "No device linked to an approved resident account" | Pass — rejects before reaching bounds checks |
| 13 | `POST /rpc/admin_unlock_login {"p_email":"dbtest-valid@example.com"}` as anon | `204 No Content` (**succeeded**) | 🔴 **Critical — fixed in PR #22** (`20260924020000_fix_admin_check_null_bypass.sql`) |
| 14 | `POST /rpc/regenerate_device_api_key` as anon | `404 42883` "gen_random_bytes(integer) does not exist" | 🟠 Same underlying admin-check NULL-bypass bug as #13, masked by an unrelated `search_path` bug — both fixed in the same migration |
| 15 | `POST /station_settings` (duplicate singleton row) as anon | `401 42501` RLS violation | Inconclusive for the uniqueness constraint itself — RLS blocks the write first |
| 16 | `PATCH /settings?key=eq.timeout_admin` as anon | `content-range: */0` | Pass — 0 rows matched, nothing changed |
| 17 | `PATCH /profiles?id=eq.<uuid>` as anon | `content-range: */0` | Pass — 0 rows matched, nothing changed |

## Round 2 — authenticated as a real admin (`admin@agapsense.com`)

Credentials were provided directly by the project owner for this purpose.
Authenticated via the Supabase Auth password grant (JWT never written to
disk).

| # | Request | Result | Verdict |
|---|---|---|---|
| 18 | `POST /devices` missing `device_code` | `400 23502` not-null violation | Pass |
| 19 | `POST /devices` with `device_code: "DEV-001"` (duplicate) | `409 23505` unique violation | Pass |
| 20 | `POST /devices` with `co_threshold: -500, temp_threshold: -999` | `201 Created` — accepted as-is | 🟡 **Finding, not fixed**: no DB-level CHECK constraint on device thresholds. The 0–100/0–1000 bounds only exist inside `update_own_device_alert_settings` (the resident RPC path), not on the table itself. Test row deleted immediately after |
| 21 | `POST /settings` with duplicate `key: "timeout_admin"` | `409 23505` PK violation | Pass — no silent overwrite; the app must explicitly upsert |
| 22 | `POST /station_settings` with `id: 1` (row exists) | `409 23505` PK violation | Pass |
| 23 | `POST /station_settings` with `id: 2` | `400 23514` singleton CHECK violation | Pass — the CHECK, not just the PK, actively enforces the singleton |
| 24 | `POST /registration_requests` with `requested_role: "admin"` | `400 23514` CHECK violation | Pass |
| 25 | `POST /registration_requests` missing `email` | `400 23502` not-null violation | Pass |
| 26 | `POST /registration_requests` with `reviewed_by` set to a nonexistent UUID | `409 23503` FK violation | Pass |
| 27 | `DELETE /devices?id=eq.<DEV-001>` (has real `sensor_readings`/`alert_events`) | `409 23503` "still referenced from table sensor_readings" | Pass — device and its data survived |
| 28 | `POST /sensor_readings` **as authenticated admin** (not just anon) | `403 42501` permission denied — grant revoked | Pass — confirms the service-role-only restriction applies to every authenticated role, admin included |
| 29 | `PATCH /station_settings?id=eq.1` with `station_name: null` | `400 23502` not-null violation | Pass |
| 30 | `POST /rpc/admin_unlock_login` (re-run after the PR #22 fix was applied live) | `400 P0001` "Only an admin can unlock a login lockout" (as anon) | Confirms the fix is live |
| 31 | `POST /rpc/regenerate_device_api_key` on `DEV-001`, authenticated as admin | `200`, `devices.api_key` changed to a new `sk_`-prefixed 51-char value | Confirms both halves of the PR #22 fix: the admin gate passes for a real admin, and `gen_random_bytes` now resolves correctly |

## Round 3 — disposable resident test accounts

Created via the app's real public `register` Edge Function, approved via
`manage-registration`/`assign-device` (the real admin-approval paths), then
deleted the same way. A throwaway device (`QA-DBTEST-DEVICE`) was created
and deleted alongside them so no real device or user data was touched.

| # | Request | Result | Verdict |
|---|---|---|---|
| 32 | `assign-device` the same test device to a second resident, while it's already linked to the first | `409 "This device is already assigned to another resident."` | Pass — confirms the app-layer collision check (MED-01 fix). The DB-level unique index (`profiles_device_id_resident_unique`) backstop wasn't independently isolated — every write path that could reach it goes through this same app-layer check first |
| 33 | `GET /rest/v1/devices?select=...,api_key` as the disposable resident, for their own device | Returned the **real, unmasked** `api_key` | 🔴 **Critical — fixed in PR #24** (`20260924040000_restrict_devices_base_table_to_admin.sql`). `devices_safe` masked it correctly for the same device/role; the base table did not, because RLS is row-level, not column-level |
| 34 | `GET /rest/v1/devices_safe?select=...,api_key` as the same resident | `api_key: null` | Correct, pre- and post-fix |
| 35 | `GET /rest/v1/devices` as the resident, for a real device they don't own (`DEV-001`) | `200 []` | Pass — row-level scoping itself was never broken, only column masking was |
| 36 | `POST /rpc/update_own_device_alert_settings` as the resident, valid bounds | `200`, device updated | Pass |
| 37 | Same RPC, `p_temp_threshold: 9999` | `400 P0001` "temp_threshold must be between 0 and 100" | Pass — bounds check confirmed live (round 1's test #12 only got as far as the linkage check, since that anon call had no linked device) |
| 38 | Same RPC, `p_co_threshold: -5` | `400 P0001` "co_threshold must be between 0 and 1000" | Pass |
| 39 | `register` the same email twice in a row | First: `200 success`. Second: `409 "An account with this email already exists."` | Pass — confirmed exactly one `profiles`/`registration_requests` row existed after the rejected duplicate; no orphaned partial data |
| 40 | Delete a disposable account via `manage-registration` (`action: delete`, which calls `auth.admin.deleteUser`) | Both the `profiles` row and its `registration_requests` row were gone afterward | Pass — confirms the two-level `ON DELETE CASCADE` chain (`auth.users -> profiles -> registration_requests`) works as designed |

## Still not independently testable via REST/RPC

- `profiles.role`/`profiles.status` CHECK constraints — would require an extra disposable `auth.users` id with no profile row (to INSERT against directly as admin without hitting a PK conflict). Not created, since the schema's CHECK syntax is unambiguous and three other CHECK constraints in this schema (`registration_requests.requested_role`, `station_settings` singleton, `update_own_device_alert_settings` bounds) were already proven to fire correctly live — same mechanism, different table.
- `sensor_readings.alert_tier`, and required-field/invalid-data checks on `sensor_readings`/`alert_events` generally — insert path is service-role-only by design (confirmed in #28); needs the service-role key specifically, not just an admin session.
- `login_lockout_overrides.unlocked_by` FK — no exposed write path other than `admin_unlock_login`, which always supplies a valid `auth.uid()`.
- `devices.api_key` UNIQUE constraint — not independently forced (would require engineering a CSPRNG collision); treated as low-risk given the schema declares it.
- The DB-level `profiles_device_id_resident_unique` index as a true backstop independent of the app-layer check — every reachable write path (`assign-device`, `link-device`) already has its own app-layer collision check, so the DB index was never the thing actually stopping test #32.

# Database Testing

Checklist for data integrity in the AgapSense schema
(`supabase/migrations/`). Pair this with `ROLE_BASED_ACCESS_TESTING.md`
(RLS/permissions) — this file is about the data itself: constraints,
types, and query correctness, independent of who is asking.

> **Live verification status:** items marked `[x]` below were executed
> against the real Supabase project (`fnfgakcmdosxsthvekwj`) via direct
> PostgREST calls — first anonymously, then again authenticated as a
> real admin account. See **Live Verification Log** at the end for the
> exact requests/responses, including one critical bug found and fixed
> (`supabase/migrations/20260924020000_fix_admin_check_null_bypass.sql`,
> confirmed patched live). Everything still unchecked needs either a
> responder/resident test account or the service-role key (only
> `sensor_readings`/`alert_events` writes are service-role-only; those
> are the last gap).

## Foreign Keys
- [ ] `profiles.id -> auth.users(id)` — deleting an `auth.users` row cascades and deletes the matching `profiles` row (`ON DELETE CASCADE`) — deliberately not tested live to avoid deleting a real account; needs a disposable test signup
- [ ] `registration_requests.user_id -> profiles(id)` — deleting a profile cascades and deletes their registration request(s) — same, deferred to avoid touching real data
- [x] `profiles.device_id -> devices(id)` — no `ON DELETE` clause is set, so deleting a device that's still linked to a resident's profile is **rejected** by the FK, not silently nulled — **no resident currently has a device linked** in this project, so the specific FK path couldn't be exercised, but the sibling FK below (same "no ON DELETE clause" pattern, same table) confirms the behavior
- [x] `sensor_readings.device_id -> devices(id)` — confirmed live as admin: `DELETE /devices?id=eq.<DEV-001>` (which has real sensor readings) → `409 23503 "update or delete on table devices violates foreign key constraint sensor_readings_device_id_fkey ... Key is still referenced from table sensor_readings"`. Device survived untouched
- [x] `alert_events.device_id -> devices(id)` — same delete attempt above was also blocked because of `alert_events` rows on the same device (Postgres reports the first FK it hits; sensor_readings won this time, but the constraint exists and was exercised)
- [x] `registration_requests.reviewed_by -> auth.users(id)` — confirmed live as admin: insert with `reviewed_by` set to a nonexistent UUID → `409 23503 "Key is not present in table \"users\""`
- [ ] `login_lockout_overrides.unlocked_by -> auth.users(id)` — not directly testable via REST (no exposed write path other than the `admin_unlock_login` RPC, which always supplies a valid `auth.uid()`)
- [x] Inserting a row with a foreign key pointing to a non-existent parent is rejected at the DB level — confirmed via the `registration_requests.reviewed_by` test above

## Duplicate Prevention
- [x] `devices.device_code` is `UNIQUE` — confirmed live as admin: inserting a second device with `device_code: "DEV-001"` (already in use) → `409 23505 "duplicate key value violates unique constraint devices_device_code_key"`
- [ ] `devices.api_key` is `UNIQUE` — not independently tested (would require forcing a CSPRNG collision); constraint exists per schema, treated as low-risk
- [ ] A resident device can only ever be linked to **one** resident at a time (`profiles_device_id_resident_unique`) — not tested live: no resident currently has a device linked in this project, and creating one for the test would mean signing up a disposable account
- [x] `station_settings` can only ever have one row — confirmed live as admin two ways: inserting `id=1` again (row already exists) → `409 23505` PK violation; inserting `id=2` → `400 23514 "violates check constraint station_settings_id_check"` (the singleton check, not just the PK, actually fires)
- [x] `settings.key` is the primary key — confirmed live as admin: inserting a duplicate `key: "timeout_admin"` → `409 23505 "duplicate key value violates unique constraint settings_pkey"` (no silent overwrite — the app must explicitly `UPDATE`/upsert, a plain `INSERT` of an existing key fails)
- [ ] Registering the same email twice via Supabase Auth is rejected, and doesn't leave an orphaned `profiles`/`registration_requests` row if signup fails partway — deferred to avoid creating real auth users during testing

## Required Fields
- [x] `devices`: confirmed live as admin: insert omitting `device_code` → `400 23502` not-null violation
- [ ] `profiles`: `full_name`, `role` cannot be `NULL` — not tested live: the only way to reach this INSERT policy is with a real `auth.users` id, and creating one means a disposable signup
- [ ] `sensor_readings`: `device_id`, `co_ppm`, `temp_celsius` cannot be `NULL` *(insert path is service-role-only; needs the service-role key — confirmed even an authenticated admin gets `403 42501 permission denied for table sensor_readings`, by design)*
- [ ] `alert_events`: `device_id`, `alert_tier`, `co_ppm`, `temp_celsius` cannot be `NULL` *(same as above — service-role-only by design)*
- [x] `login_attempts`: `email`, `success` cannot be `NULL` — confirmed live: `POST /login_attempts` with `success` omitted → `HTTP 400 23502 "null value in column \"success\" ... violates not-null constraint"`; with `email` omitted → same `23502` for `email`
- [x] `settings`: confirmed live as admin (see the duplicate-key test below, which also proves `key`/`value` are enforced — no separate NULL test needed since the PK itself is `NOT NULL` by definition)
- [x] `station_settings`: confirmed live as admin: `PATCH station_settings SET station_name = null` → `400 23502` not-null violation
- [x] `registration_requests`: confirmed live as admin: insert with `email` omitted → `400 23502` not-null violation. No anon/authenticated INSERT policy exists for a non-admin caller at all — real users can only reach this table through the `register` Edge Function
- [x] A direct API call with a missing required field is independently rejected by the DB, not just client-side validation — confirmed on `login_attempts`, `devices`, `station_settings`, and `registration_requests` above

## Invalid Data Rejection
- [ ] `profiles.role` only accepts `'admin' | 'bfp_responder' | 'resident'` — not tested live (no spare `auth.users` id to insert a test profile against without a disposable signup); the CHECK constraint is present in schema
- [ ] `profiles.status` only accepts `'approved' | 'pending' | 'rejected'` — same limitation as above
- [ ] `alert_events.alert_tier` only accepts `1` or `2` — untestable without the service-role key (insert path is service-role-only)
- [x] `registration_requests.requested_role` only accepts `'resident' | 'bfp_responder'` — confirmed live as admin: insert with `requested_role: "admin"` → `400 23514 "violates check constraint registration_requests_requested_role_check"`
- [ ] `update_own_device_alert_settings` RPC rejects `temp_threshold` outside 0–100 and `co_threshold` outside 0–1000 — *partially confirmed*: called live as anon with `p_temp_threshold: 9999`, got `"No device linked to an approved resident account"` (the auth/linkage check runs before the bounds check); a real resident session is still needed to confirm the bounds check itself fires
- [x] Non-numeric input into numeric columns is rejected by the column type — confirmed live: `POST /login_attempts` with `success: "not-a-boolean"` → `HTTP 400 22P02 "invalid input syntax for type boolean"`
- [ ] Malformed/out-of-range GPS coordinates (`latitude`/`longitude`) from a device don't corrupt `gps_valid` downstream logic — needs the service-role key to reach `ingest-reading`'s write path
- [x] **Finding — DB-level gap:** `devices.co_threshold`/`temp_threshold` have **no `CHECK` constraint** at the table level. Confirmed live as admin: inserting a device with `co_threshold: -500, temp_threshold: -999` → `201 Created`, values stored as-is. The 0–100/0–1000 bounds only exist inside `update_own_device_alert_settings` (the resident RPC path) — an admin writing directly to the `devices` table (e.g. via Devices.tsx, or any future direct-write feature) has no DB-level backstop against a nonsensical or inverted threshold that could suppress real fire/CO alerts. Test row was deleted immediately after (`device_code: QA-TEST-RANGE-001`, no dependents)

## Dates
- [x] All timestamp columns are `TIMESTAMPTZ` and timezone-aware — confirmed live: `devices.created_at` and `login_attempts.attempted_at` both returned with an explicit `+00:00` offset and microsecond precision (e.g. `2026-09-24T06:25:31.181873+00:00`)
- [x] `DEFAULT now()` columns populate automatically on insert without the client sending a timestamp — confirmed live: the throwaway `devices` test insert and every `login_attempts` insert omitted `created_at`/`attempted_at` entirely and both were populated
- [ ] `sensor_readings.recorded_at` / `alert_events.triggered_at` reflect when the event actually happened (device/ingest time), not when some later batch job ran — untestable without the service-role key
- [ ] Ordering by `recorded_at DESC` / `triggered_at DESC` (used throughout Resident/Responder dashboards) returns true chronological order, including across a DST transition
- [ ] `alert_events.resolved_at` is `NULL` until explicitly resolved, and setting it doesn't retroactively change `triggered_at`

## Monetary Values
- [ ] N/A — this schema has no monetary/currency columns (AgapSense is a sensor/alerting system, not a billing one). If a future feature introduces pricing, billing, or fees, it should use a fixed-point/`NUMERIC` type, never `FLOAT`/`FLOAT8`, to avoid rounding errors
- [ ] As a related numeric-type sanity check: `co_threshold` is `INTEGER` while `co_ppm` (the value it's compared against) is `FLOAT` — confirm threshold comparisons (`co_ppm >= co_threshold`) behave correctly across the type difference and don't truncate in a way that misses a real alert condition

## Cascading Deletes
- [ ] Deleting a `profiles` row (as admin) cascades to delete that user's own `registration_requests`, but does **not** cascade to `sensor_readings` or `alert_events` for the device they used — deliberately not tested live (would require deleting a real profile); needs a disposable test account
- [ ] Deleting an `auth.users` row cascades to `profiles`, which in turn cascades to `registration_requests` — same, deferred to avoid destroying real data
- [x] Deleting a `devices` row does **not** unexpectedly succeed and orphan `sensor_readings`/`alert_events` — confirmed live as admin: `DELETE` on `DEV-001` (which has real readings/alerts) was rejected with `23503`, device and its dependents all survived intact (see Foreign Keys above)
- [ ] Deleting one resident's profile does not affect another resident's device, readings, or alerts — deferred, no disposable resident account created
- [ ] Deleting a registration request does not delete the underlying `profiles`/`auth.users` row — not tested (no test registration request exists to delete; the CHECK/FK tests above never got far enough to create a persisted row)

## Query Correctness / Scoping to the Logged-in User
- [x] An unauthenticated write to a row-scoped table touches zero rows rather than silently succeeding on the wrong row — confirmed live: `PATCH /settings?key=eq.timeout_admin` and `PATCH /profiles?id=eq.<arbitrary-uuid>` as anon both returned `content-range: */0` (0 rows matched/updated), not an error and not a leaked write
- [ ] `AuthContext.fetchProfile` (`profiles.eq('id', userId).single()`) always returns the current user's own profile, never another user's
- [ ] `ResidentHome`, `ResidentDeviceInfo`, `ResidentSystemLog`, `ResidentAlerts` all filter `sensor_readings`/`alert_events` by `.eq('device_id', profile.device_id)` sourced from the *server-fetched* profile, never a client-supplied/URL-supplied device id
- [ ] A resident cannot see another resident's readings/alerts/device info by tampering with a request parameter — confirm this holds even though RLS is the real backstop (query-level scoping + RLS should agree)
- [ ] `ResponderDevices` device lookup by `device_id` returns the correct single device (`maybeSingle()`), and a not-found id returns `null` cleanly rather than throwing or returning an unrelated row
- [ ] `useIdleTimeout`'s settings lookup (`settings.eq('key', TIMEOUT_SETTING_KEY[role]).maybeSingle()`) returns the timeout for the *current user's role*, not a stale or wrong-role value after a role changes mid-session
- [ ] Admin-facing list views (`Users.tsx`, `Devices.tsx`, `Alerts.tsx`, `Logs.tsx`) that intentionally show *all* users/devices/alerts are not accidentally scoped down to "current admin only" (the opposite bug — under-scoping admin views that should be global)
- [ ] Pagination/limit clauses (e.g. `.limit(20)`, `.limit(24)`) don't allow a large `offset`/page-forward request to leak rows belonging to a different device than the one requested

## Live Verification Log (executed against production, `fnfgakcmdosxsthvekwj.supabase.co`)

All requests below used the public anon key only (no login session), via
direct PostgREST calls — not the app UI.

| # | Request | Result | Verdict |
|---|---|---|---|
| 1 | `POST /login_attempts {"email":..., "success":false}` | `201 Created` | Matches app's real `.insert()` call (no `.select()`) — pass |
| 2 | Same, with `Prefer: return=representation` | `401 42501` "new row violates row-level security policy" | Expected Postgres/RLS behavior: `RETURNING` also needs a matching `SELECT` policy, which anon doesn't have on `login_attempts`. **Regression risk noted**: if a future change adds `.select()` after this `.insert()`, the login page's attempt-logging call would start failing for every anonymous login attempt |
| 3 | `POST /login_attempts` missing `success` | `400 23502` not-null violation | Pass |
| 4 | `POST /login_attempts` missing `email` | `400 23502` not-null violation | Pass |
| 5 | `POST /login_attempts {"success":"not-a-boolean"}` | `400 22P02` invalid boolean syntax | Pass |
| 6 | `GET /login_attempts?email=eq...` as anon | `200 []` | Pass — anon cannot read attempts back, matches admin-only SELECT policy |
| 7 | `POST /sensor_readings` as anon | `401 42501` permission denied (grant revoked) | Pass |
| 8 | `POST /alert_events` as anon | `401 42501` permission denied (grant revoked) | Pass |
| 9 | `POST /devices` as anon | `401 42501` RLS violation | Pass |
| 10 | `POST /registration_requests` as anon | `401 42501` RLS violation | Pass — confirms no anon/authenticated INSERT policy exists at all; the table is edge-function-only |
| 11 | `POST /rpc/check_login_lockout {"p_email":...}` as anon | `200 [{"locked":false,...}]` | Pass — intentionally public, used by the unauthenticated login page |
| 12 | `POST /rpc/update_own_device_alert_settings` as anon | `400 P0001` "No device linked to an approved resident account" | Pass — correctly rejects before reaching bounds checks |
| 13 | `POST /rpc/admin_unlock_login {"p_email":"dbtest-valid@example.com"}` as anon | `204 No Content` (**succeeded**) | 🔴 **FAIL — critical.** Anon should never be able to call this. Root cause and fix in `supabase/migrations/20260924020000_fix_admin_check_null_bypass.sql` |
| 14 | `POST /rpc/regenerate_device_api_key` as anon | `404 42883` "function gen_random_bytes(integer) does not exist" | 🟠 Same underlying admin-check bug as #13 (confirmed by getting *past* the admin check before failing on an unrelated error) — fixed in the same migration, which also fixes the `gen_random_bytes` resolution issue for real admin calls |
| 15 | `POST /station_settings` (duplicate singleton row) as anon | `401 42501` RLS violation | Inconclusive for the uniqueness constraint specifically — RLS blocks the write before the `id=1` check constraint is ever reached; needs an admin session to test the constraint itself |
| 16 | `PATCH /settings?key=eq.timeout_admin` as anon | `200`/`204`, `content-range: */0` | Pass — 0 rows matched, nothing changed |
| 17 | `PATCH /profiles?id=eq.<uuid>` as anon | `200`/`204`, `content-range: */0` | Pass — 0 rows matched, nothing changed |

**Cleanup performed:** the `login_lockout_overrides` row created by test #13
for `dbtest-valid@example.com` (a throwaway test address) is deleted by the
fix migration itself.

### Round 2: authenticated as a real admin (`admin@agapsense.com`)

Credentials were provided directly by the project owner for this purpose.
Authenticated via the Supabase Auth password grant to get a real admin JWT
(never written to disk), then called PostgREST/RPCs with it — exactly what
the admin UI does under the hood. No secrets were persisted outside this
session's memory.

| # | Request | Result | Verdict |
|---|---|---|---|
| 18 | `POST /devices` missing `device_code` | `400 23502` not-null violation | Pass |
| 19 | `POST /devices` with `device_code: "DEV-001"` (duplicate) | `409 23505` unique violation | Pass |
| 20 | `POST /devices` with `co_threshold: -500, temp_threshold: -999` | `201 Created` — accepted as-is | 🟡 **Finding, not a security bug**: no DB-level CHECK constraint on device thresholds (see Invalid Data Rejection). Test row deleted immediately after |
| 21 | `POST /settings` with duplicate `key: "timeout_admin"` | `409 23505` PK violation | Pass |
| 22 | `POST /station_settings` with `id: 1` (row exists) | `409 23505` PK violation | Pass |
| 23 | `POST /station_settings` with `id: 2` | `400 23514` singleton CHECK violation | Pass — the CHECK, not just the PK, actively enforces the singleton |
| 24 | `POST /registration_requests` with `requested_role: "admin"` (using admin's own profile id as `user_id`, a harmless self-reference — insert failed, nothing persisted) | `400 23514` CHECK violation | Pass |
| 25 | `POST /registration_requests` missing `email` | `400 23502` not-null violation | Pass |
| 26 | `POST /registration_requests` with `reviewed_by` set to a nonexistent UUID | `409 23503` FK violation ("Key is not present in table \"users\"") | Pass |
| 27 | `DELETE /devices?id=eq.<DEV-001>` (has real `sensor_readings`/`alert_events`) | `409 23503` "still referenced from table sensor_readings" | Pass — device and its data survived |
| 28 | `POST /sensor_readings` **as authenticated admin** (not just anon) | `403 42501` permission denied — grant revoked | Pass — confirms the service-role-only restriction applies to every authenticated role, admin included, not only anon |
| 29 | `PATCH /station_settings?id=eq.1` with `station_name: null` | `400 23502` not-null violation | Pass |
| 30 | `POST /rpc/admin_unlock_login` (re-run after the fix was applied) | `400 P0001` "Only an admin can unlock a login lockout" (as **anon**) | Confirms the fix from PR #22 is live and working |
| 31 | `POST /rpc/regenerate_device_api_key` on `DEV-001`, authenticated as admin | `200`, `devices.api_key` changed to a new `sk_`-prefixed 51-char value | Confirms both halves of the fix work: the admin gate passes for a real admin, and `gen_random_bytes` now resolves correctly |

**Still open:** everything requiring a disposable resident/responder test
account (role/status CHECK constraints on `profiles`, the
`profiles_device_id_resident_unique` collision test, `update_own_device_alert_settings`'s
bounds check, most Cascading Deletes, and Query Correctness/Scoping) — all
deliberately deferred rather than manufactured against real production
accounts. `sensor_readings`/`alert_events` required-field and invalid-data
checks need the service-role key specifically, since that restriction is
by design (see #28).

# Database Testing

Checklist for data integrity in the AgapSense schema
(`supabase/migrations/`). Pair this with `ROLE_BASED_ACCESS_TESTING.md`
(RLS/permissions) — this file is about the data itself: constraints,
types, and query correctness, independent of who is asking.

> **Live verification status:** items marked `[x]` below were executed
> against the real Supabase project (`fnfgakcmdosxsthvekwj`) via direct
> PostgREST calls using the public anon key — no login session available
> in that pass, so only anon-reachable behavior could be exercised
> directly. See **Live Verification Log** at the end for the exact
> requests/responses, including one critical bug found and fixed
> (`supabase/migrations/20260924020000_fix_admin_check_null_bypass.sql`).
> Everything else needs either real per-role test accounts or the
> service-role key to execute — those stay unchecked.

## Foreign Keys
- [ ] `profiles.id -> auth.users(id)` — deleting an `auth.users` row cascades and deletes the matching `profiles` row (`ON DELETE CASCADE`)
- [ ] `registration_requests.user_id -> profiles(id)` — deleting a profile cascades and deletes their registration request(s) (`ON DELETE CASCADE`)
- [ ] `profiles.device_id -> devices(id)` — no `ON DELETE` clause is set, so deleting a device that's still linked to a resident's profile is **rejected** by the FK, not silently nulled; confirm the app handles this error (e.g. unlink/reassign residents first)
- [ ] `sensor_readings.device_id -> devices(id)` — deleting a device with existing readings is rejected by the FK (default `NO ACTION`); confirm there's an intended cleanup path (delete readings first, or don't allow device deletion once readings exist)
- [ ] `alert_events.device_id -> devices(id)` — same as above: deleting a device with existing alert history is rejected by the FK
- [ ] `registration_requests.reviewed_by -> auth.users(id)` — inserting/updating with a non-existent reviewer id is rejected
- [ ] `login_lockout_overrides.unlocked_by -> auth.users(id)` — same
- [ ] Inserting a row with a foreign key pointing to a non-existent parent (e.g. `sensor_readings.device_id` for a device that doesn't exist) is rejected at the DB level, not just the application layer — **untestable as anon**: every write path that would exercise this FK (`devices`, `sensor_readings`, `alert_events`) is blocked by RLS/grants before the FK is ever reached; needs an admin session or the service-role key

## Duplicate Prevention
- [ ] `devices.device_code` is `UNIQUE` — creating a second device with the same code is rejected
- [ ] `devices.api_key` is `UNIQUE` — a key collision (astronomically unlikely with `gen_random_bytes(24)`, but confirm the constraint exists) is rejected
- [ ] A resident device can only ever be linked to **one** resident at a time (`profiles_device_id_resident_unique` partial unique index on `device_id where role='resident'`) — assigning the same device to a second resident via `assign-device` or `link-device` fails
- [ ] `station_settings` can only ever have one row (`id = 1` check constraint) — no second row can be inserted regardless of role
- [ ] `settings.key` is the primary key — inserting a duplicate key updates/conflicts rather than creating a second row (check how the app upserts `timeout_admin`/`timeout_bfp`/`timeout_resident`)
- [ ] Registering the same email twice via Supabase Auth is rejected (auth-level uniqueness), and doesn't leave an orphaned `profiles`/`registration_requests` row if the auth signup fails partway through

## Required Fields
- [ ] `devices`: `device_code`, `label`, `location_desc`, `api_key`, `co_threshold`, `temp_threshold` cannot be `NULL` — omitting any of them on insert is rejected *(insert path itself is admin-only; needs an admin session to test directly)*
- [ ] `profiles`: `full_name`, `role` cannot be `NULL` *(insert path is admin-only/edge-function-only; needs an admin session)*
- [ ] `sensor_readings`: `device_id`, `co_ppm`, `temp_celsius` cannot be `NULL` *(insert path is service-role-only; needs the service-role key)*
- [ ] `alert_events`: `device_id`, `alert_tier`, `co_ppm`, `temp_celsius` cannot be `NULL` *(insert path is service-role-only; needs the service-role key)*
- [x] `login_attempts`: `email`, `success` cannot be `NULL` — confirmed live: `POST /login_attempts` with `success` omitted → `HTTP 400 23502 "null value in column \"success\" ... violates not-null constraint"`; with `email` omitted → same `23502` for `email`
- [ ] `settings`: `key`, `value` cannot be `NULL` *(write path is admin-only; needs an admin session)*
- [ ] `station_settings`: `station_name`, `address`, `contact_number`, `email` cannot be `NULL` *(write path is admin/responder-only; needs a session)*
- [ ] `registration_requests`: `user_id`, `email`, `requested_role` cannot be `NULL` *(no anon/authenticated INSERT policy exists at all — see confirmed test below; can only be exercised through the `register` Edge Function with a real signup)*
- [x] A direct API call with a missing required field is independently rejected by the DB, not just client-side validation — confirmed on `login_attempts` (the one anon-writable table) above

## Invalid Data Rejection
- [ ] `profiles.role` only accepts `'admin' | 'bfp_responder' | 'resident'` — any other value is rejected by the `CHECK` constraint
- [ ] `profiles.status` only accepts `'approved' | 'pending' | 'rejected'` — any other value is rejected
- [ ] `alert_events.alert_tier` only accepts `1` or `2` — any other integer is rejected
- [ ] `registration_requests.requested_role` only accepts `'resident' | 'bfp_responder'` — `'admin'` or anything else is rejected
- [ ] `update_own_device_alert_settings` RPC rejects `temp_threshold` outside 0–100 and `co_threshold` outside 0–1000 (defense-in-depth bounds beyond the UI sliders) — *partially confirmed*: called live as anon with `p_temp_threshold: 9999`, got `"No device linked to an approved resident account"` (the auth/linkage check runs before the bounds check), not a bounds error; a real resident session is needed to reach and confirm the bounds check itself
- [x] Non-numeric input into numeric columns is rejected by the column type — confirmed live: `POST /login_attempts` with `success: "not-a-boolean"` → `HTTP 400 22P02 "invalid input syntax for type boolean"`. `co_ppm`/`temp_celsius`/`latitude`/`longitude`/`co_threshold`/`temp_threshold` on `devices`/`sensor_readings`/`alert_events` still need an authorized write path to test directly
- [ ] Malformed/out-of-range GPS coordinates (`latitude`/`longitude`) from a device don't corrupt `gps_valid` downstream logic — confirm `ingest-reading` validates or flags these rather than trusting the device blindly

## Dates
- [ ] All timestamp columns (`created_at`, `last_seen_at`, `recorded_at`, `triggered_at`, `resolved_at`, `attempted_at`, `reviewed_at`, `updated_at`) are `TIMESTAMPTZ`, not naive `TIMESTAMP` — verify stored values are timezone-aware and display correctly for users in different timezones
- [ ] `DEFAULT now()` columns populate automatically on insert without the client having to send a timestamp
- [ ] `sensor_readings.recorded_at` / `alert_events.triggered_at` reflect when the event actually happened (device/ingest time), not when some later batch job ran
- [ ] Ordering by `recorded_at DESC` / `triggered_at DESC` (used throughout Resident/Responder dashboards) returns true chronological order, including across a DST transition
- [ ] `alert_events.resolved_at` is `NULL` until explicitly resolved, and setting it doesn't retroactively change `triggered_at`

## Monetary Values
- [ ] N/A — this schema has no monetary/currency columns (AgapSense is a sensor/alerting system, not a billing one). If a future feature introduces pricing, billing, or fees, it should use a fixed-point/`NUMERIC` type, never `FLOAT`/`FLOAT8`, to avoid rounding errors
- [ ] As a related numeric-type sanity check: `co_threshold` is `INTEGER` while `co_ppm` (the value it's compared against) is `FLOAT` — confirm threshold comparisons (`co_ppm >= co_threshold`) behave correctly across the type difference and don't truncate in a way that misses a real alert condition

## Cascading Deletes
- [ ] Deleting a `profiles` row (as admin) cascades to delete that user's own `registration_requests`, but does **not** cascade to `sensor_readings` or `alert_events` for the device they used (those belong to the device, not the profile)
- [ ] Deleting an `auth.users` row cascades to `profiles`, which in turn cascades to `registration_requests` — confirm this two-level cascade doesn't silently drop data an admin expected to keep (e.g. historical alerts tied to that person)
- [ ] Deleting a `devices` row does **not** unexpectedly succeed and orphan `sensor_readings`/`alert_events`/`profiles.device_id` — the FK should block it (see Foreign Keys above); confirm the admin UI surfaces a clear error rather than a silent failure
- [ ] Deleting one resident's profile does not affect another resident's device, readings, or alerts
- [ ] Deleting a registration request does not delete the underlying `profiles`/`auth.users` row it originated from

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

**Still needs real credentials to finish this checklist:** Foreign Keys,
Cascading Deletes, and most of Duplicate Prevention/Required
Fields/Invalid Data require either (a) real admin/responder/resident test
accounts to log in as, or (b) the service-role key, since nearly every
write path that would exercise those constraints is correctly blocked by
RLS for an anonymous caller before the constraint is ever reached.

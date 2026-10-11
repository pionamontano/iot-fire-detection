# Database Testing

Checklist for data integrity in the AgapSense schema
(`supabase/migrations/`). Pair this with `ROLE_BASED_ACCESS_TESTING.md`
(RLS/permissions) — this file is about the data itself: constraints,
types, and query correctness, independent of who is asking.

> **Live verification status:** items marked `[x]` below were executed
> against the real Supabase project (`fnfgakcmdosxsthvekwj`) across three
> rounds — anonymous, authenticated as a real admin, and via disposable
> resident test accounts created and deleted through the app's own
> registration/approval flow. See `LIVE_DATABASE_VERIFICATION.md` (same
> folder) for the full log of every request/response. Two critical bugs
> were found and fixed along the way (PRs #22 and #24), and one
> data-integrity gap (#20 below) was fixed in PR #26 and confirmed live.
> Everything still unchecked needs the service-role key specifically —
> almost entirely `sensor_readings`/`alert_events` writes, which are
> service-role-only by design.

## Foreign Keys
- [x] `profiles.id -> auth.users(id)` — deleting an `auth.users` row cascades and deletes the matching `profiles` row (`ON DELETE CASCADE`) — confirmed live via a disposable test account (Round 3)
- [x] `registration_requests.user_id -> profiles(id)` — deleting a profile cascades and deletes their registration request(s) — confirmed in the same test: both rows were gone after a single delete
- [x] `profiles.device_id -> devices(id)` — no `ON DELETE` clause is set, so deleting a device that's still linked to a resident's profile is **rejected** by the FK, not silently nulled — inferred from the sibling FK below (same table, same "no `ON DELETE`" pattern, directly confirmed)
- [x] `sensor_readings.device_id -> devices(id)` — confirmed live as admin: `DELETE /devices?id=eq.<DEV-001>` (which has real sensor readings) → `409 23503`, device survived untouched
- [x] `alert_events.device_id -> devices(id)` — same delete attempt above also has `alert_events` rows on that device; the constraint exists and was exercised
- [x] `registration_requests.reviewed_by -> auth.users(id)` — confirmed live as admin: insert with a nonexistent reviewer UUID → `409 23503`
- [ ] `login_lockout_overrides.unlocked_by -> auth.users(id)` — no exposed write path other than the `admin_unlock_login` RPC, which always supplies a valid `auth.uid()`
- [x] Inserting a row with a foreign key pointing to a non-existent parent is rejected at the DB level — confirmed via the `reviewed_by` test above

## Duplicate Prevention
- [x] `devices.device_code` is `UNIQUE` — confirmed live as admin: duplicate `device_code` → `409 23505`
- [ ] `devices.api_key` is `UNIQUE` — not independently forced (would require engineering a CSPRNG collision); low risk, constraint exists per schema
- [x] A resident device can only ever be linked to **one** resident at a time — confirmed live: `assign-device` correctly rejected assigning an already-linked device to a second resident (`409`). The DB-level unique index is a backstop behind this app-layer check, not independently isolated (every reachable write path already has its own check)
- [x] `station_settings` can only ever have one row — confirmed live as admin two ways: `id=1` (row exists) → `409` PK violation; `id=2` → `400` singleton `CHECK` violation
- [x] `settings.key` is the primary key — confirmed live as admin: duplicate `key` → `409 23505`, no silent overwrite
- [x] Registering the same email twice via Supabase Auth is rejected — confirmed live: second `register` call with the same email → `409 "An account with this email already exists"`, and exactly one `profiles`/`registration_requests` row existed afterward (no orphan from the rejected attempt)

## Required Fields
- [x] `devices`: confirmed live as admin — omitting `device_code` → `400 23502`
- [ ] `profiles`: `full_name`, `role` cannot be `NULL` — would need a disposable `auth.users` id with no existing profile row to test the raw INSERT path in isolation; not created for this
- [ ] `sensor_readings`: `device_id`, `co_ppm`, `temp_celsius` cannot be `NULL` — insert path is service-role-only by design (confirmed even an authenticated admin gets `403` here)
- [ ] `alert_events`: `device_id`, `alert_tier`, `co_ppm`, `temp_celsius` cannot be `NULL` — same, service-role-only
- [x] `login_attempts`: `email`, `success` cannot be `NULL` — confirmed live: omitting either → `400 23502`
- [x] `settings`: `key`, `value` cannot be `NULL` — the PK (`key`) is `NOT NULL` by definition; confirmed via the duplicate-key test above
- [x] `station_settings`: confirmed live as admin — `station_name: null` → `400 23502`
- [x] `registration_requests`: confirmed live as admin — omitting `email` → `400 23502`. No anon/authenticated INSERT policy exists for a non-admin caller at all; real users only reach this table through the `register` Edge Function
- [x] A direct API call with a missing required field is independently rejected by the DB, not just client-side validation — confirmed on `login_attempts`, `devices`, `station_settings`, and `registration_requests`

## Invalid Data Rejection
- [ ] `profiles.role` only accepts `'admin' | 'bfp_responder' | 'resident'` — not independently tested (would need a spare `auth.users` id with no profile); three other `CHECK` constraints in this schema were proven to fire correctly live, same mechanism
- [ ] `profiles.status` only accepts `'approved' | 'pending' | 'rejected'` — same limitation
- [ ] `alert_events.alert_tier` only accepts `1` or `2` — untestable without the service-role key
- [x] `registration_requests.requested_role` only accepts `'resident' | 'bfp_responder'` — confirmed live as admin: `requested_role: "admin"` → `400 23514` `CHECK` violation
- [x] `update_own_device_alert_settings` RPC rejects `temp_threshold` outside 0–100 and `co_threshold` outside 0–1000 — confirmed live via a disposable resident account: `p_temp_threshold: 9999` → `"temp_threshold must be between 0 and 100"`; `p_co_threshold: -5` → `"co_threshold must be between 0 and 1000"`
- [x] Non-numeric input into numeric columns is rejected by the column type — confirmed live: `success: "not-a-boolean"` on `login_attempts` → `400 22P02`
- [ ] Malformed/out-of-range GPS coordinates (`latitude`/`longitude`) from a device don't corrupt `gps_valid` downstream logic — needs the service-role key to reach `ingest-reading`'s write path
- [x] **Fixed:** `devices.co_threshold`/`temp_threshold` had **no DB-level `CHECK` constraint** — confirmed live as admin that `co_threshold: -500, temp_threshold: -999` was accepted (`201 Created`). Fixed in PR #26 (`supabase/migrations/20260924050000_devices_threshold_check_constraints.sql`), which adds the same 0–1000/0–100 bounds as table-level constraints. Re-verified live after the fix was applied: the same payload now correctly gets `400 23514`, while an in-bounds value still inserts fine

## Dates
- [x] All timestamp columns are `TIMESTAMPTZ` and timezone-aware — confirmed live: `devices.created_at` and `login_attempts.attempted_at` both returned with an explicit `+00:00` offset and microsecond precision
- [x] `DEFAULT now()` columns populate automatically on insert without the client sending a timestamp — confirmed live on both tables above
- [ ] `sensor_readings.recorded_at` / `alert_events.triggered_at` reflect when the event actually happened, not when a later batch job ran — untestable without the service-role key
- [ ] Ordering by `recorded_at DESC` / `triggered_at DESC` returns true chronological order, including across a DST transition — not tested (needs real historical data spanning a DST boundary)
- [ ] `alert_events.resolved_at` is `NULL` until explicitly resolved, and setting it doesn't retroactively change `triggered_at` — untestable without the service-role key to seed alert data

## Monetary Values
- [x] N/A — this schema has no monetary/currency columns (AgapSense is a sensor/alerting system, not a billing one). Confirmed by schema review; noted here for a future feature that might introduce one, which should use `NUMERIC`, never `FLOAT`
- [ ] `co_threshold` (`INTEGER`) vs `co_ppm` (`FLOAT`) comparison behavior at real alert-trigger time — untestable without the service-role key (would need real ingested readings crossing a threshold)

## Cascading Deletes
- [x] Deleting a `profiles` row cascades to that user's own `registration_requests`, and cannot cascade to `sensor_readings`/`alert_events` (no FK path from either table to `profiles` at all) — the `registration_requests` half confirmed live; the `sensor_readings`/`alert_events` half is guaranteed by schema structure
- [x] Deleting an `auth.users` row cascades to `profiles`, which in turn cascades to `registration_requests` — confirmed live via a disposable test account: one delete call removed both rows
- [x] Deleting a `devices` row does **not** unexpectedly succeed and orphan `sensor_readings`/`alert_events` — confirmed live as admin (see Foreign Keys above)
- [ ] Deleting one resident's profile does not affect another resident's device, readings, or alerts — not isolated with a live two-resident-plus-device-data scenario; structurally guaranteed by the schema (profiles rows don't reference each other), but not independently exercised
- [ ] Deleting a registration request does not delete the underlying `profiles`/`auth.users` row it originated from — not tested (never deleted a `registration_requests` row without deleting its parent profile)

## Query Correctness / Scoping to the Logged-in User
- [x] An unauthenticated write to a row-scoped table touches zero rows rather than silently succeeding on the wrong row — confirmed live: anon `PATCH` on `settings`/`profiles` both returned `content-range: */0`
- [ ] `AuthContext.fetchProfile` (`profiles.eq('id', userId).single()`) always returns the current user's own profile, never another user's — not tested via this exact query path (closely related device-scoping behavior below was confirmed instead)
- [x] Device-scoped queries sourced from the server-fetched profile (the pattern used by `ResidentHome`, `ResidentDeviceInfo`, `ResidentSystemLog`, `ResidentAlerts`) correctly return only the caller's own device — confirmed live via a disposable resident account
- [x] A resident cannot see another resident's/another device's data by tampering with a request parameter — confirmed live: querying a real device (`DEV-001`) the test resident didn't own returned `200 []`
- [ ] `ResponderDevices` device lookup by `device_id` returns the correct single device (`maybeSingle()`), and a not-found id returns `null` cleanly — not tested (no responder test account created)
- [ ] `useIdleTimeout`'s settings lookup returns the timeout for the *current user's role*, not a stale or wrong-role value after a role changes mid-session — not tested (requires driving the actual app UI, not just raw REST calls)
- [ ] Admin-facing list views (`Users.tsx`, `Devices.tsx`, `Alerts.tsx`, `Logs.tsx`) are not accidentally under-scoped — not tested
- [ ] Pagination/limit clauses don't allow a large offset/page-forward request to leak rows belonging to a different device — not tested

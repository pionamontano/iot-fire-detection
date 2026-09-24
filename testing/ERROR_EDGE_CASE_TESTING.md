# Error & Edge Case Testing

Checklist for verifying how AgapSense behaves at its boundaries — malformed
or missing input, network/timeout failures, race conditions, and
already-known firmware quirks — rather than the happy path covered by
`ROLE_BASED_ACCESS_TESTING.md` (permissions) and `UI_UX_TESTING.md`
(layout/interaction). Most of these hit `supabase/functions/*` directly
with `curl`/a scratch script using a real device `api_key` or test
account, the same approach the other `testing/` docs use.

- [ ] Not yet run
- [ ] Run against the deployed Edge Functions, not local `supabase functions serve`, at least once — timeouts and cold starts behave differently

## 1. `trigger-alert` (device → server, Tier 1/2 alerts)

- [ ] Missing `x-device-key` header → `401`, no DB writes attempted
- [ ] `x-device-key` that doesn't match any device's `api_key` → `401` (query uses `.single()`, so a key matching zero rows must not throw an unhandled 500)
- [ ] Valid key for a device with `is_active = false` → `401 'Unauthorized or inactive device'`, confirming a deactivated device can't keep alerting
- [ ] Malformed JSON body (truncated, not JSON at all) → `400 'Invalid JSON payload'`, not a crash
- [ ] `tier` missing, `tier: 3`, `tier: "1"` (string), or `tier: 0` → `400 'Invalid or missing tier'` — the check is `tier !== 1 && tier !== 2`, so a string `"1"` must NOT pass
- [ ] `co_ppm` or `temp_celsius` missing, `null`, `NaN`-producing, `Infinity`, or a string → `400`, caught by `isValidNumber`
- [ ] Legacy field names (`alert_tier`, `temperature_c`, `lat`/`lng` instead of `tier`/`temp_celsius`/`latitude`/`longitude`) are accepted via the fallback destructuring (`body.tier ?? body.alert_tier`, etc.) — verify both old and new firmware field sets still work
- [ ] `gps_valid: true` with missing/non-numeric `latitude`/`longitude` → `400`; `gps_valid: false` (or omitted) with missing coords is accepted (coords are optional when not claimed valid)
- [ ] `latitude: 0, longitude: 0` (firmware's "never acquired a fix" sentinel) is treated as **no coordinates** — alert is created, GPS section says "Unavailable," not "0, 0" on a map
- [ ] A real Tier 2 event but reverse geocoding to Nominatim times out (>3s) or Nominatim is unreachable — alert still creates successfully, `address_resolved` falls back to `device.location_desc`, then to `'Unknown Location'`, never blocks the alert on a slow/dead upstream
- [ ] Nominatim returns a response with no usable `address` fields and no `display_name` → `address_resolved` is `null`, handled without throwing (`buildTieredAddress` returns `null`)
- [ ] Telegram bot token/chat ID unset or Telegram API unreachable → `sendTelegram` returns `false`, alert still creates, `telegram_sent: false`; the request never fails because Telegram failed
- [ ] **Deduplication**: a second Tier 1 alert for a device with an already-open (unresolved) alert **updates** the existing `alert_events` row instead of inserting a duplicate row
- [ ] **Escalation**: an open Tier 1 alert followed by a Tier 2 reading for the same device escalates `alert_tier` to 2 (`Math.max`) on the *same* row, not a new one
- [ ] **De-escalation guard**: a Tier 2 open alert followed by a Tier 1 reading does **not** silently downgrade the stored tier below 2 (`Math.max` protects this — confirm the assumption holds)
- [ ] No resident is linked to the alerting device (`profiles` has no matching `device_id`) → `owner_contact` returns `''`, response still succeeds (doesn't 500 on `maybeSingle()` finding nothing)
- [ ] Device has no `bfp_contact` configured → response returns `bfp_contact: ''`, not `null`/`undefined` leaking into the firmware's SMS body
- [ ] Two alerts for the same device arrive within milliseconds of each other (simulate concurrent requests) — verify the dedup query's race doesn't produce two open rows for one device
- [ ] Extremely large or negative `co_ppm`/`temp_celsius` (e.g. `-999999`, `1e308`) are still "valid numbers" per `isValidNumber` and get stored as-is — confirm the dashboard doesn't break rendering an extreme value, even if the Edge Function itself doesn't reject it

## 2. `ingest-reading` (device → server, routine telemetry)

- [ ] Same auth/malformed-JSON/invalid-number checks as `trigger-alert` §1 apply here too — missing key, inactive device, bad JSON, non-finite `co_ppm`/`temp_celsius`
- [ ] `(0, 0)` GPS sentinel is treated as no coordinates here too, same as `trigger-alert`
- [ ] `on_battery`, `sensor_ready`, `gps_valid` all default correctly when omitted (`false`, `true`, `false` respectively) rather than erroring on `undefined`
- [ ] **Auto-resolution**: a reading strictly below both `co_threshold` and `temp_threshold` while `sensor_ready: true` auto-resolves any open `alert_events` row for that device — confirm this doesn't fire when `sensor_ready: false` (a device reporting "sensor not ready" shouldn't be trusted to clear a real alert)
- [ ] A reading exactly **at** threshold (not below) does **not** auto-resolve — the check is strictly-less-than to avoid boundary flapping; verify a reading oscillating around the threshold doesn't rapidly open/close the same alert
- [ ] Device has `co_threshold`/`temp_threshold` unset (`null`) → defaults to `Infinity` in the comparison, so auto-resolution simply never triggers for that metric rather than throwing on `null < number`
- [ ] A burst of readings sent faster than the device's normal interval (simulate firmware retry storm) doesn't degrade response time or create duplicate `sensor_readings` rows beyond one-per-request
- [ ] `sensor_readings` insert fails (e.g. simulate a constraint violation) → the function surfaces a `400` with the DB error rather than silently returning `success: true` (check `insertResult.error` is actually thrown, not swallowed by `Promise.all`)

## 3. `login` (server-side lockout gate)

- [ ] Missing `email` or `password` → `400`, no `login_attempts` row inserted, no call to GoTrue
- [ ] 3rd consecutive failure for an email → subsequent attempt is rejected client-visibly as locked with `retry_after_seconds` reflecting the 10s tier; 5th failure escalates to 30s; 7th to 900s (per `20260917060000_login_lockout_check_function.sql`)
- [ ] While locked, a request with the **correct** password is still rejected (`429`, `locked: true`) without ever reaching GoTrue — lockout blocks even a correct credential during the window
- [ ] Immediately after the lockout window elapses, a correct login succeeds and the tier resets appropriately
- [ ] A failed login always inserts into `login_attempts` **unconditionally**, even when the failure came from GoTrue itself (bad password) vs. a malformed request that never reached GoTrue — confirm only genuine credential attempts are counted, not `400`s for missing fields
- [ ] GoTrue itself is unreachable/times out → function doesn't hang indefinitely and returns a clear error rather than leaving the client spinning
- [ ] Successful login returns real `access_token`/`refresh_token` that the client can `setSession()` with — verify a session obtained this way behaves identically to one from direct `signInWithPassword()` (RLS, expiry, refresh all work)
- [ ] Admin-issued lockout override (`login_lockout_overrides`) clears a lockout immediately — a request right after the override succeeds even though the raw `login_attempts` history still shows recent failures
- [ ] Two browser tabs racing a login attempt against a nearly-locked account (e.g. both send the 3rd failing attempt simultaneously) — verify at most the correct tier is applied, not a skipped or double-applied one

## 4. `register` (public sign-up)

- [ ] Missing `full_name`, `email`, `password`, or `requested_role` → `400` naming which are required
- [ ] `requested_role` outside `resident`/`bfp_responder` (e.g. `admin`, empty string, `null`) → `400` — a caller cannot self-register as admin by sending an arbitrary role string
- [ ] `contact_number` provided but not matching `09XXXXXXXXX` (e.g. missing leading `09`, wrong length, includes `+63`, contains letters) → `400 'Invalid phone number format'`
- [ ] `contact_number` omitted entirely → accepted (`contact_number: contact_number || null`), registration still succeeds
- [ ] `password` under 6 characters → `400`; exactly 6 → accepted
- [ ] Malformed email (`"not-an-email"`, `"a@b"`, `"@nodomain.com"`) → `400 'Invalid email address'`
- [ ] `requested_role: 'resident'` without `address` → `400`; `requested_role: 'bfp_responder'` without `organization` → `400`
- [ ] Registering with an email that already has an account → `409 'An account with this email already exists'`, and no orphaned `profiles`/`registration_requests` row is left behind
- [ ] **Rollback on partial failure**: if the `profiles` insert fails after the auth user was created, the auth user is deleted (no orphaned login-capable account with no profile); if the `registration_requests` insert fails after `profiles` succeeded, both the profile and the auth user are rolled back — force each failure path (e.g. temporarily break a constraint) and confirm no orphan rows survive
- [ ] `device_code` supplied that doesn't match any real device → registration still succeeds, response includes `device_code_recognized: false`, doesn't block signup (device may not be provisioned yet)
- [ ] `device_code` omitted → `device_code_recognized: null`, not `false` (distinguishes "didn't check" from "checked, not found")
- [ ] Submitting the exact same registration payload twice in quick succession (double-click / network retry) doesn't create two auth users or two `registration_requests` for the same email — second attempt should hit the `409` path
- [ ] Extremely long input strings (`full_name`, `address`, `verification_info`) don't crash the function or truncate silently in a way that corrupts stored data — check against any DB column length limits

## 5. `get-device-config`, `assign-device` / `link-device`, `create-user`, `manage-registration`, `confirm-sms-status`

- [ ] `get-device-config` — unknown/inactive device key → `401`, same pattern as §1/§2; verify it never returns another device's `bfp_contact`/thresholds when given a key for a different device
- [ ] `assign-device` / `link-device` — assigning a device that's already linked to a different resident is rejected with a clear collision error, not a silent overwrite (per `ROLE_BASED_ACCESS_TESTING.md` §1's "Create (constraint)" case) — verify the *edge function's* error message is actionable in the admin UI, not just a raw DB error
- [ ] `assign-device` / `link-device` — assigning a `device_code` that doesn't exist → clear "device not found" error, not a generic 500
- [ ] `create-user` — creating a user with an email that already exists → same `409`-style handling as `register`, no orphaned rows
- [ ] `create-user` — missing required fields → `400` with a specific message, not a stack trace
- [ ] `manage-registration` — approving a `registration_request` that's already been approved/rejected (double-approve, e.g. two admin tabs) → second call is a no-op or clear "already processed" error, not a corrupted state (e.g. duplicate role grants, or overwriting a rejection with an approval silently)
- [ ] `manage-registration` — rejecting a request leaves the associated auth user unable to log in in any useful way (session revoked or profile status enforced) even if they already have a cached session
- [ ] `confirm-sms-status` — `alert_event_id` for an alert belonging to a **different** device than the caller's key → `404 'alert_event_id not found for this device'`, confirming a device can't mark another device's alert as delivered
- [ ] `confirm-sms-status` — `role` outside `'owner'`/`'bfp'`, or `success` not a strict boolean (e.g. `"true"` string, `1`) → `400`
- [ ] `confirm-sms-status` — called twice for the same `alert_event_id`/`role` (retry after an ack was lost) is idempotent — second call just re-sets the same value, no error, no duplicate side effect

## 6. Cross-Cutting Network & Payload Edge Cases

- [ ] Every Edge Function above returns valid JSON with a sensible status code for **every** error path exercised — none should be reachable by a 500 with an HTML error page or an unhandled exception stack trace leaking to the device/client
- [ ] `OPTIONS` preflight requests return `200` with CORS headers for every function, so browser-originated calls (not just firmware) aren't blocked
- [ ] Request bodies with unexpected **extra** fields (firmware sending both old and new field names, or a client sending fields the function doesn't use) are ignored gracefully, not rejected
- [ ] A device firmware retry (network drop right after the device sends a request but before it reads the response) resends the same alert/reading — confirm this is handled by the dedup/idempotency behavior already checked in §1/§5, not a new duplicate-alert bug
- [ ] Simulate a slow/flaky connection between the frontend and Supabase (throttle in DevTools) — in-flight requests don't leave the UI in a stuck-loading state forever; a reasonable timeout surfaces an error state (cross-reference `UI_UX_TESTING.md` §5)
- [ ] Clock skew: a device with a wildly wrong system clock (if timestamps were ever client-supplied) doesn't corrupt ordering — confirm all timestamps used for dedup/escalation (`triggered_at`, `last_seen_at`) are server-generated (`new Date().toISOString()`), never trusted from the device payload

## 7. Frontend Resilience

- [ ] Supabase Realtime channel disconnects mid-session (kill network briefly) — reconnect doesn't duplicate event handlers or miss the update that happened while offline (cross-reference `UI_UX_TESTING.md` §3)
- [ ] Navigating directly to a role-restricted URL while logged out, or with an expired token, lands on `Login`/`SessionExpired`, not a blank/broken page or an infinite redirect loop
- [ ] `NotFound.tsx` renders for genuinely unknown routes and offers a way back, rather than a bare 404
- [ ] Submitting any form (login, register, threshold settings, device assignment) while offline shows a clear "can't reach the server" error instead of hanging or silently failing
- [ ] Rapid repeated submits of the same form (impatient double-click) are guarded against on the client (disabled button while pending) in addition to whatever the backend tolerates

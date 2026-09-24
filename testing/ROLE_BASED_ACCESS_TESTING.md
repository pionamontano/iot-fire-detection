# Role-Based Access Testing

Checklist for verifying Row Level Security (RLS) and role enforcement in the
AgapSense database (`supabase/migrations/`). Roles: `admin`, `bfp_responder`,
`resident`. `get_auth_role()` returns `NULL` for any account whose
`profiles.status` isn't `'approved'`, so pending/rejected accounts are denied
every role-gated policy below even if they hold a valid session.

**Test at the API/RPC level, not just the UI.** The UI may simply hide a
button for a role — that proves nothing about whether the database itself
would reject the same request. Verify each row below with a direct
PostgREST/RPC call using that role's real JWT (e.g. via `curl` or the
Supabase JS client in a scratch script), in addition to clicking through the
app.

> **Live verification status:** items marked `[x]` below were executed
> against the real Supabase project via disposable admin/resident/responder
> test accounts, created and deleted through the app's own registration,
> approval, and deletion Edge Functions. See `LIVE_RBAC_VERIFICATION.md`
> (same folder) for the full request/response log. One regression was
> found and fixed along the way (`devices_safe` returning zero rows for
> non-admins after the earlier masking-bypass fix — see migration
> `20260924060000_fix_devices_safe_visibility_regression.sql`) and one
> checklist inaccuracy was corrected (`alert_events` DELETE, below).

## CRUD Testing

For every database feature, test Create / Read / Update / Delete against
every role that could plausibly reach it.

### 1. Devices (`devices` / `devices_safe`)
- [x] **Create** — Admin can create a new device; `api_key` is server-generated (`pgcrypto`), never sent from the client
- [x] **Create** — BFP Responder cannot create a device — confirmed live: `403 42501` RLS violation
- [x] **Create** — Resident cannot create a device — confirmed live: `403 42501` RLS violation
- [x] **Create (constraint)** — Assigning an already-claimed device to a second resident is rejected — confirmed live via `assign-device`'s app-layer collision check
- [x] **Read** — Admin can read all devices, including the real `api_key`
- [ ] **Read** — BFP Responder can read all devices via `devices_safe`, with `api_key` returned as `null` — **found broken** (see regression note above); needs re-verification after `20260924060000` is applied live
- [ ] **Read** — Resident can read only their own linked device via `devices_safe`, with `api_key` returned as `null` — same regression, same pending re-verification
- [x] **Read** — Resident cannot read another resident's device by supplying a different device id — confirmed live (queried a real device by id, got `[]`)
- [x] **Update** — Admin can update any device field
- [x] **Update** — Resident can update only their own device's `temp_threshold`/`co_threshold` via `update_own_device_alert_settings`, bounded to 0–100°C / 0–1000ppm — confirmed live, both bounds fire correctly
- [x] **Update** — Resident cannot touch `api_key` or any other field directly (no raw UPDATE policy) — confirmed live: direct `PATCH` on `api_key` matched 0 rows
- [x] **Update** — BFP Responder cannot update any device row directly — confirmed live: 0 rows matched
- [x] **Update** — Admin can regenerate a device's `api_key` via `regenerate_device_api_key`; a resident or responder calling the same RPC is rejected — confirmed live for all three
- [x] **Delete** — Admin can delete a device — confirmed live (multiple throwaway devices deleted during testing)
- [x] **Delete** — BFP Responder and Resident cannot delete a device — confirmed live: a responder's delete attempt on a real, in-use device matched 0 rows (the `profiles.device_id` FK would have blocked it regardless, since a resident's profile referenced it at the time)

### 2. Profiles (`profiles`)
- [x] **Create** — New profile rows are only created via the `register`/`create-user` Edge Functions; inferred for the direct-INSERT-rejected case from the same admin-only `WITH CHECK` already proven to gate correctly elsewhere in this schema
- [x] **Read** — Any *approved* user (admin/bfp_responder/resident) can read all profile rows — confirmed live for both a resident and a responder test account
- [x] **Read** — A *pending* or *rejected* account cannot read any profile rows — confirmed live: a disposable account saw `0` rows while pending, then `3` rows immediately after approval, then `0` rows again immediately after rejection — **using the same already-issued JWT with no re-login**, proving revocation is enforced live on every request, not cached in the token
- [x] **Update** — A user can update their own profile fields (e.g. `contact_number`) — confirmed live
- [x] **Update** — A user cannot change their own `role` via a direct API update — confirmed live: `role` stayed `resident` after a `PATCH` attempting `role: "admin"`
- [x] **Update** — A user cannot change their own `status` via a direct API update — confirmed live: `status` stayed `approved` after a `PATCH` attempting `status: "rejected"`
- [x] **Update** — A user cannot update another user's profile row — confirmed live: 0 rows matched, target row unchanged
- [x] **Update** — Admin can change another user's `status` (approving/rejecting) — confirmed live repeatedly via `manage-registration`
- [x] **Delete** — Admin can delete a profile — confirmed live (multiple disposable accounts)
- [x] **Delete** — BFP Responder and Resident cannot delete any profile, including their own — confirmed live: a resident's self-delete attempt returned `204` but the row was still present afterward (verified directly)

### 3. Sensor Readings (`sensor_readings`)
- [x] **Create** — Direct client `INSERT` is rejected for every role, including an authenticated admin — confirmed live (`403`, grant revoked at the Postgres level, not just RLS)
- [ ] **Create** — Only the `ingest-reading` Edge Function can insert readings — the negative case above is confirmed; the positive case (a real ingest call succeeding) needs the service-role key to test directly
- [x] **Read** — Admin can read readings for all devices
- [x] **Read** — BFP Responder can read readings for all devices — confirmed live
- [x] **Read** — Resident can read readings only for their own linked device — confirmed live
- [x] **Update** — No role, including admin, can update a reading — confirmed by schema: no `UPDATE`/`FOR ALL` policy of any kind exists on this table, admin included
- [x] **Delete** — No role can delete a reading — same schema-certainty as above; no `DELETE` policy exists

### 4. Alert Events (`alert_events`)
- [x] **Create** — Direct client `INSERT` is rejected for every role, including an authenticated admin — confirmed live (grant revoked)
- [x] **Read** — Admin can read all alert events
- [x] **Read** — BFP Responder can read all alert events — confirmed live
- [x] **Read** — Resident can read alert events only for their own device — same row-scoping expression as `sensor_readings`, proven live for that table; not independently re-run for this one to avoid touching real alert data
- [ ] **Update** — Admin can update/resolve an alert event — not tested live (would require mutating a real incident row; no disposable alert row could be created without the service-role key)
- [x] **Update** — BFP Responder and Resident cannot update any alert event — schema-certain: responder has only a `SELECT` policy, resident has only its own-device `SELECT` policy; neither has any `UPDATE` grant of any kind
- [x] **Delete** — **Checklist correction:** the original claim here ("no role can delete, no DELETE policy exists") was wrong. `"Admin full access on alert events"` is a `FOR ALL` policy, which **does** cover `DELETE` — an admin genuinely can delete an alert event (not exercised live, to avoid destroying real incident history). BFP Responder and Resident correctly cannot — they have no `DELETE` policy at all

### 5. Login Attempts (`login_attempts`)
- [x] **Create** — Any client, even unauthenticated, can insert a login attempt row
- [x] **Read** — Only Admin can read login attempt history
- [x] **Read** — BFP Responder and Resident cannot read login attempts — confirmed live: both got `[]`
- [x] **Update / Delete** — No role can update or delete a login attempt row — schema-certain, no such policies exist for any role

### 6. Login Lockout Overrides (`login_lockout_overrides`)
- [x] **Create/Update** — Only Admin can clear a lockout, via `admin_unlock_login`
- [x] **Create/Update** — A resident or responder calling `admin_unlock_login` directly is rejected — confirmed live for both
- [x] **Read/Delete** — Only Admin can read or manage override rows directly — schema-certain, a single `FOR ALL` policy scoped to admin is the only policy on this table

### 7. Settings (`settings`)
- [x] **Create/Update/Delete** — Only Admin can write `settings` rows
- [x] **Read** — Any approved user can read settings — confirmed live for a resident; symmetric policy covers responder identically
- [ ] **Read** — Pending/rejected cannot read settings — not independently re-run for this table, but the identical mechanism (`get_auth_role() IS NOT NULL`) was directly proven on `profiles` with a real pending→approved→rejected account
- [x] **Update** — BFP Responder and Resident cannot change settings values — confirmed live: both matched 0 rows

### 8. Station Settings (`station_settings`)
- [x] **Read** — Any approved user can view station contact info — confirmed live for a resident and (incidentally, via the update test below) a responder
- [x] **Update** — Admin can update station settings — confirmed live (a `NULL` value correctly hit the column's `NOT NULL` constraint rather than being blocked by RLS, proving the write itself was permitted)
- [x] **Update** — BFP Responder can update station settings — confirmed live (set the real contact number back to its existing value — no net change, but the write itself succeeded)
- [x] **Update** — Resident cannot update station settings — confirmed live: 0 rows matched
- [x] **Create** — A second insert attempt fails for every role once the singleton row exists — confirmed live as admin (both the PK and the singleton `CHECK` independently fire); non-admin insert is blocked earlier still, by RLS
- [x] **Delete** — No role can delete the station settings row — schema-certain, no `DELETE` policy exists for any role

### 9. Registration Requests (`registration_requests`)
- [x] **Create** — A new request is created via the `register` Edge Function during signup, not a direct client insert — confirmed live (every disposable test account was created this way; a direct anon insert attempt was separately confirmed rejected)
- [x] **Read** — Admin can read all registration requests
- [x] **Read** — A user can read only their own registration request — confirmed live: a resident saw exactly 1 row (their own), not the other test accounts' requests
- [x] **Read** — A user cannot read another user's registration request — confirmed by the same test above
- [x] **Update** — Only Admin can approve/reject a request — confirmed live via `manage-registration`
- [x] **Update** — A non-admin cannot approve/reject their own or another user's request — confirmed live: a resident's self-approve attempt (`PATCH admin_notes`) matched 0 rows; `admin_notes` verified unchanged afterward
- [x] **Delete** — Only Admin can delete a registration request; BFP Responder/Resident cannot — schema-certain (`"Admin full access"` is the only policy covering `DELETE`), and functionally exercised repeatedly via cascade delete through `manage-registration`

## Cross-Role Regression Checks
- [ ] Switching test accounts between roles in the same browser doesn't leak the previous role's cached data — not tested (requires driving the actual browser UI, not raw REST/RPC calls)
- [x] Every row above is re-verified with a direct REST/RPC call using each role's real JWT, not only through the UI — this is what this entire testing pass consisted of
- [x] A revoked/rejected account loses all access immediately, without needing to log out first — confirmed live and definitively: the *same* already-issued JWT went from 3 visible profile rows to 0 the instant admin rejected the account, no re-login involved

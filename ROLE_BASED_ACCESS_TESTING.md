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

## CRUD Testing

For every database feature, test Create / Read / Update / Delete against
every role that could plausibly reach it.

### 1. Devices (`devices` / `devices_safe`)
- [ ] **Create** — Admin can create a new device (Devices.tsx); `api_key` is server-generated (`pgcrypto`), never sent from the client
- [ ] **Create** — BFP Responder cannot create a device (no INSERT policy for `bfp_responder`)
- [ ] **Create** — Resident cannot create a device
- [ ] **Create (constraint)** — Assigning an already-claimed device to a second resident is rejected (unique index `profiles_device_id_resident_unique` + `assign-device`/`link-device` collision checks)
- [ ] **Read** — Admin can read all devices, including the real `api_key`
- [ ] **Read** — BFP Responder can read all devices via `devices_safe`, with `api_key` returned as `null`
- [ ] **Read** — Resident can read only their own linked device (by `device_id`), with `api_key` returned as `null`
- [ ] **Read** — Resident cannot read another resident's device by supplying a different device id
- [ ] **Update** — Admin can update any device field (thresholds, `is_active`, `bfp_contact`, `label`, etc.)
- [ ] **Update** — Resident can update only their own device's `temp_threshold`/`co_threshold` via the `update_own_device_alert_settings` RPC (ResidentAlertSettings.tsx), bounded to 0–100°C / 0–1000ppm
- [ ] **Update** — Resident cannot touch `api_key`, `is_active`, `bfp_contact`, `device_code`, or another resident's device (no raw UPDATE policy grants them table access — only the narrow RPC)
- [ ] **Update** — BFP Responder cannot update any device row directly
- [ ] **Update** — Admin can regenerate a device's `api_key` via `regenerate_device_api_key` RPC; the same call from a non-admin role is rejected
- [ ] **Delete** — Admin can delete a device
- [ ] **Delete** — BFP Responder and Resident cannot delete a device

### 2. Profiles (`profiles`)
- [ ] **Create** — New profile rows are only created via the `register`/`create-user` Edge Functions (service role); a direct client `INSERT` from a non-admin is rejected (`"Admin insert access on profiles"`)
- [ ] **Read** — Any *approved* user (admin/bfp_responder/resident) can read all profile rows
- [ ] **Read** — A *pending* or *rejected* account cannot read any profile rows
- [ ] **Update** — A user can update their own profile fields (contact number, address, `setup_complete`, etc.)
- [ ] **Update** — A user cannot change their own `role` via a direct API update (silently reverted by `protect_profile_fields_trigger`)
- [ ] **Update** — A user cannot change their own `status` via a direct API update (same trigger)
- [ ] **Update** — A user cannot update another user's profile row
- [ ] **Update** — Admin can change another user's `role`/`status` (e.g. approving a pending resident)
- [ ] **Delete** — Admin can delete a profile
- [ ] **Delete** — BFP Responder and Resident cannot delete any profile, including their own

### 3. Sensor Readings (`sensor_readings`)
- [ ] **Create** — Direct client `INSERT` (anon or authenticated key) is rejected outright (`WITH CHECK (false)`), for every role
- [ ] **Create** — Only the `ingest-reading` Edge Function (service role, validates `x-device-key`) can insert readings
- [ ] **Read** — Admin can read readings for all devices
- [ ] **Read** — BFP Responder can read readings for all devices
- [ ] **Read** — Resident can read readings only for their own linked device
- [ ] **Update** — No role, including admin, can update a reading — no UPDATE policy exists
- [ ] **Delete** — No role can delete a reading — no DELETE policy exists

### 4. Alert Events (`alert_events`)
- [ ] **Create** — Direct client `INSERT` is rejected (`WITH CHECK (false)`); only `trigger-alert` (service role) can insert
- [ ] **Read** — Admin can read all alert events
- [ ] **Read** — BFP Responder can read all alert events
- [ ] **Read** — Resident can read alert events only for their own device
- [ ] **Update** — Admin can update/resolve an alert event (e.g. `resolved_at`)
- [ ] **Update** — BFP Responder can update/resolve an alert event
- [ ] **Update** — Resident cannot update any alert event
- [ ] **Delete** — No role can delete an alert event — no DELETE policy exists

### 5. Login Attempts (`login_attempts`)
- [ ] **Create** — Any client, even unauthenticated (pre-login), can insert a login attempt row
- [ ] **Read** — Only Admin can read login attempt history
- [ ] **Read** — BFP Responder and Resident cannot read login attempts
- [ ] **Update / Delete** — No role can update or delete a login attempt row (append-only audit trail)

### 6. Login Lockout Overrides (`login_lockout_overrides`)
- [ ] **Create/Update** — Only Admin can clear a lockout, via the `admin_unlock_login` RPC
- [ ] **Create/Update** — A non-admin calling `admin_unlock_login` directly is rejected
- [ ] **Read/Delete** — Only Admin can read or manage override rows directly

### 7. Settings (`settings`)
- [ ] **Create/Update/Delete** — Only Admin can write `settings` rows (e.g. per-role idle-timeout minutes)
- [ ] **Read** — Any approved user can read settings; pending/rejected cannot
- [ ] **Update** — BFP Responder and Resident cannot change settings values

### 8. Station Settings (`station_settings`)
- [ ] **Read** — Any approved user can view station contact info
- [ ] **Update** — Admin can update station settings
- [ ] **Update** — BFP Responder can update station settings
- [ ] **Update** — Resident cannot update station settings
- [ ] **Create** — A second insert attempt fails for every role once the singleton row exists (`id = 1` check constraint)
- [ ] **Delete** — No role can delete the station settings row — no DELETE policy exists

### 9. Registration Requests (`registration_requests`)
- [ ] **Create** — A new request is created via the `register` Edge Function during signup, not a direct client insert
- [ ] **Read** — Admin can read all registration requests
- [ ] **Read** — A user can read only their own registration request
- [ ] **Read** — A user cannot read another user's registration request
- [ ] **Update** — Only Admin can approve/reject a request (`admin_notes`, `reviewed_by`, `reviewed_at`) via `manage-registration`
- [ ] **Update** — A non-admin cannot approve/reject their own or another user's request
- [ ] **Delete** — Only Admin can delete a registration request; BFP Responder/Resident cannot

## Cross-Role Regression Checks
- [ ] Switching test accounts between roles in the same browser doesn't leak the previous role's cached data (profiles, devices, alerts)
- [ ] Every row above is re-verified with a direct REST/RPC call using each role's real JWT, not only through the UI
- [ ] A revoked/rejected account (admin flips `status`) loses all access described above immediately, without needing to log out first — or confirm it applies on the account's next request

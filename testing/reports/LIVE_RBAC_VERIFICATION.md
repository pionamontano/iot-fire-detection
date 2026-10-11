# Live RBAC Verification Log

Record of role-based access checks (see `ROLE_BASED_ACCESS_TESTING.md` for
the checklist) actually executed against the production Supabase project
(`fnfgakcmdosxsthvekwj.supabase.co`), kept separate so the checklist file
doesn't churn on every pass. All requests are direct PostgREST/RPC/Edge
Function calls, not the app UI.

## Setup

Four disposable accounts were created via the app's real `register` Edge
Function and approved via `manage-registration`/`assign-device` (the real
admin-approval paths), plus one throwaway device (`QA-RBAC-DEVICE-1`):

- **Resident X** — approved, linked to the throwaway device
- **Resident Z** — approved, no device (for cross-user profile tests)
- **Responder Y** — approved
- **Pending W** — used only for the pending/approved/rejected transition test

All four accounts and the throwaway device were deleted via the real
production API (`manage-registration` `delete` action + `DELETE /devices`)
immediately after use. Nothing was left behind.

## Results

| # | Request | Result | Verdict |
|---|---|---|---|
| 1 | `POST /devices` as responder | `403 42501` RLS violation | Pass |
| 2 | `POST /devices` as resident | `403 42501` RLS violation | Pass |
| 3 | `GET /devices_safe` as responder | `[]` | 🔴 **Regression** — should have returned all devices with `api_key: null`. Root cause: dropping the base table's non-admin SELECT policies (PR #24) also broke `devices_safe`'s own row visibility, since it's a `security_invoker` view. Fixed in `20260924060000_fix_devices_safe_visibility_regression.sql` |
| 4 | `GET /devices_safe` as resident X | `[]` | Same regression as #3, same fix |
| 5 | `PATCH /devices` (label) as responder | 0 rows matched | Pass |
| 6 | `PATCH /devices` (`api_key`) as resident X | 0 rows matched | Pass |
| 7 | `DELETE /devices` as responder, on the device linked to resident X | 0 rows matched, device survived | Pass (also backstopped by the `profiles.device_id` FK, since resident X's profile referenced it at the time) |
| 8 | `POST /rpc/regenerate_device_api_key` as resident X | `400 P0001` "Only an admin can regenerate a device API key" | Pass |
| 9 | Same RPC as responder Y | `400 P0001` same message | Pass |
| 10 | `GET /profiles` as resident X | `5` rows visible | Pass — any approved user sees all profiles |
| 11 | `GET /profiles` as responder Y | `5` rows visible | Pass |
| 12 | `PATCH /profiles` (`contact_number`) as resident X, own row | Success, 1 row updated | Pass |
| 13 | `PATCH /profiles` (`role: "admin"`) as resident X, own row | `200`, but `role` in the response is still `"resident"` | Pass — `protect_profile_fields_trigger` silently reverted it |
| 14 | `PATCH /profiles` (`status: "rejected"`) as resident X, own row | `200`, but `status` in the response is still `"approved"` | Pass — same trigger |
| 15 | `PATCH /profiles` on resident Z's row, as resident X | 0 rows matched | Pass |
| 16 | `DELETE /profiles` on resident X's own row, as resident X | `204`, but the row still existed on a follow-up admin query | Pass — 0 rows actually matched despite the 204 |
| 17 | `GET /sensor_readings` as responder Y | Returned a row for a real device | Pass |
| 18 | `GET /sensor_readings` as resident X | `[]` (their throwaway device has no readings) | Pass — correctly scoped, nothing to leak |
| 19 | `GET /alert_events` as responder Y | Returned a row for a real device | Pass |
| 20 | `PATCH /alert_events` (nonexistent id) as responder Y | `204`, 0 rows | Inconclusive by itself (can't distinguish "policy would have blocked a real row" from "no row matched") — not re-run against a real row to avoid mutating incident data |
| 21 | `PATCH /alert_events` (nonexistent id) as resident X | `204`, 0 rows | Same inconclusiveness as #20; resident's lack of any UPDATE policy is schema-certain regardless |
| 22 | `DELETE /alert_events` (nonexistent id) as responder Y | `204`, 0 rows | Same inconclusiveness; responder's lack of any DELETE policy is schema-certain regardless |
| 23 | `GET /login_attempts` as resident X | `[]` | Pass |
| 24 | `GET /login_attempts` as responder Y | `[]` | Pass |
| 25 | `POST /rpc/admin_unlock_login` as resident X | `400 P0001` "Only an admin can unlock a login lockout" | Pass |
| 26 | Same RPC as responder Y | `400 P0001` same message | Pass |
| 27 | `GET /settings` as resident X | Returned a row | Pass |
| 28 | `PATCH /settings` as resident X | 0 rows matched | Pass |
| 29 | `PATCH /settings` as responder Y | 0 rows matched | Pass |
| 30 | `GET /station_settings` as resident X | Returned the real station data | Pass |
| 31 | `PATCH /station_settings` (`contact_number`) as responder Y | `200`, write succeeded | Pass — set the value back to its existing real contact number, so no net change; confirmed `updated_at` was untouched afterward |
| 32 | `PATCH /station_settings` as resident X | 0 rows matched | Pass |
| 33 | `GET /registration_requests` as resident X | `1` row (their own) | Pass |
| 34 | `PATCH /registration_requests` (`admin_notes`) as resident X, own request | 0 rows matched; `admin_notes` confirmed unchanged (`"Approved"`) afterward | Pass |
| 35 | `GET /profiles` as a fresh disposable account, **while still pending** | `[]` | Pass |
| 36 | `GET /settings` as the same pending account | `[]` | Pass |
| 37 | Same account, `GET /profiles`, **immediately after admin approval** | `3` rows visible | Pass |
| 38 | Same account, same JWT (**no re-login**), `GET /profiles`, **immediately after admin rejection** | `0` rows | Pass — proves revocation is enforced live on every request (`get_auth_role()` re-checks `profiles.status` from the database each time), not cached in the JWT |

## Checklist corrections made from this pass

- **`alert_events` DELETE**: the checklist previously claimed no role, including admin, could delete an alert event. That's wrong — `"Admin full access on alert events"` is a `FOR ALL` policy, which covers `DELETE` too. Corrected in `ROLE_BASED_ACCESS_TESTING.md`; not exercised live to avoid destroying real incident history.

## Still not independently testable

- `ingest-reading`/`trigger-alert` actually succeeding (the positive case for `sensor_readings`/`alert_events` inserts) — service-role-only, needs that key specifically.
- Admin resolving a real `alert_events` row — avoided to prevent mutating real incident data; the permission itself is schema-certain via the `FOR ALL` policy.
- Cross-role browser-cache leakage — needs actual UI/browser testing, not raw API calls.

# AgapSense Requirements Traceability Matrix (Deliverable C)

Part of the baseline set started by [`system-specification.md`](system-specification.md) (v0.1, commit `5441cb78`). Full requirement text, acceptance criteria and limitations are in §5.5 of that document; this matrix links each requirement to its source, implementation, verification method and current status.

**Reading the status columns**

* **Spec status** — Verified / Partially Verified / Conflicting / Not Implemented / NS-RA (Not Specified — Requires Approval), as defined in the specification. "Verified" means *read in code*, not *works*.
* **Deploy** — `R` = implemented in repository only, not deployed (per `docs/CHANGELOG_AUDIT_REMEDIATION.md`); `L` = reported live-verified in `testing/reports/LIVE_*` (self-reported); `–` = no deployment information.
* **Test (this review)** — **Not Tested** for every row: no test suite, build, firmware compile or live call was run (dependency installation and external calls were out of scope). Rows whose tests are *reported by the repository authors* name them under "Evidence".
* **Source** — `O` owner-supplied objective (task brief); `C` implemented & consistent with objective, awaiting owner ratification (OQ-01); `SW/HW-x` = requirement ID cited in code comments whose parent document is not in the repository (**Unconfirmed Requirement**); `Rem` = introduced by the audit-remediation work (owner decisions recorded in the changelog).
* Hardware or third-party rows are **Cannot Verify in Current Environment** for delivery/behaviour even if code is verified.

## Summary

| Spec status | Count |
|---|---|
| Verified (code) | 41 |
| Partially Verified | 15 |
| Conflicting | 3 |
| Not Implemented | 1 |
| Not Specified — Requires Approval | 1 |
| **Total functional requirements** | **61** |
| Approved Requirement (owner-confirmed individually) | 0 — only the project-level objective is owner-supplied (OQ-01) |
| Tested in this review | 0 |
| Of the 41 Verified: implemented in repo but not deployed | 6 (FR-AUTH-010, FR-RESP-002, FR-IOT-012, FR-ALERT-002, FR-ALERT-003, FR-NOTIF-005) |
| Of the 41 Verified: external delivery/hardware accuracy not verifiable | FR-IOT-001 (accuracy), FR-NOTIF-001/002/003 (delivery) |

Per-area: AUTH 10 · ADMIN 7 · RESP 5 · RES 8 · IOT 12 · ALERT 6 · LOC 5 · NOTIF 8.

---

## FR-AUTH

| ID | Requirement (short) | Source | Implementing component | Verification method | Expected result | Spec status | Deploy | Evidence / missing evidence |
|---|---|---|---|---|---|---|---|---|
| FR-AUTH-001 | Public registration → pending profile + request, resident/responder only | C | `functions/register` | Integration test (HTTP) + DB inspection | Rows created `pending`; dup e-mail 409; role `admin` rejected | Verified | L | `register/index.ts:24-140`; live duplicate-email check reported in `LIVE_DATABASE_VERIFICATION.md`. Missing: password-policy/e-mail-verification approval |
| FR-AUTH-002 | Login via `login` with tiered lockout (3→10 s, 5→30 s, 7→900 s) and admin unlock | SW-2.6.2 (unconfirmed) | `functions/login`, `check_login_lockout`, `admin_unlock_login` | Integration test; UI test | Lockout escalates with decaying timer; unlock immediate | Verified | L | `login/index.ts:80-103`, `20260924090000`; live results self-reported. Direct GoTrue bypass accepted by owner |
| FR-AUTH-003 | UI blocks non-approved accounts (pending/rejected screens) | C | `AuthGuard.tsx` | UI test | Pending user sees "Account Pending" | Verified | L | `AuthGuard.tsx:55-79` |
| FR-AUTH-004 | Backend denies data access to non-approved accounts | C | RLS policies via `get_auth_role()` | Database-policy test as pending responder/resident | 0 rows on `alert_events`/`devices`/`sensor_readings` | **Conflicting** | ? | Repo `init.sql:192-195` has no status check; `LIVE_RBAC_VERIFICATION.md` row 38 reports revocation works live. **Missing:** live `pg_get_functiondef('public.get_auth_role')` (OQ-03) |
| FR-AUTH-005 | Route protection by role | C | `AuthGuard`, `App.tsx` | UI test | Wrong-role URL redirects | Verified | L | `AuthGuard.tsx:81-91`. UI-only, not authorisation |
| FR-AUTH-006 | Resident setup gate | C | `AuthGuard`, `ResidentSetup` | UI test | `/home` unreachable before setup | Verified | L | `AuthGuard.tsx:94-100` |
| FR-AUTH-007 | Per-role idle timeout from `settings` | SW-2.6.1 (unconfirmed) | `useIdleTimeout`, `Settings.tsx` | UI test with short timeout | Redirect to `/session-expired` | Partially Verified | L | Hook read only in part; live result self-reported |
| FR-AUTH-008 | Password reset by e-mail link | C | `ForgotPassword`, `ResetPassword` | E2E with mail | New password works | Partially Verified | – | Supabase mail/redirect config not verifiable |
| FR-AUTH-009 | Non-admin cannot change own role/status/device_id | C | `protect_profile_fields` trigger | DB-policy test | Value unchanged | Verified | L | `init.sql:236-261`. `is_active`, `setup_complete`, `telegram_chat_id` unprotected (KI-10) |
| FR-AUTH-010 | Only approved admins read other profiles | Rem | `is_approved_admin()` + policy | DB-policy test | Non-admin sees own row only | Verified | R | `20261019000000`; `profiles_rls.test.sql` (13 checks reported) — not run here |

## FR-ADMIN

| ID | Requirement (short) | Source | Component | Verification | Expected | Status | Deploy | Evidence / missing |
|---|---|---|---|---|---|---|---|---|
| FR-ADMIN-001 | Dashboard overview with Realtime | C | `Dashboard.tsx` | UI test | Counts match DB; live update | Partially Verified | – | `Dashboard.tsx:56-96`; Realtime Cannot Verify |
| FR-ADMIN-002 | User management (approve/reject/delete/create/assign) | C | `Users.tsx`, `manage-registration`, `create-user`, `assign-device` | Integration + UI | Status/ownership change as requested | Verified | L | Function files; `Users.tsx:124-250` |
| FR-ADMIN-003 | Device registration, edit, activate, regenerate key | C | `Devices.tsx`, RPCs, column default | Integration | Key server-generated; regen admin-only | Verified | L | `Devices.tsx:97-176`; `20260924000000`; `20260924020000` |
| FR-ADMIN-004 | Device Status (formerly System Overview): rename, power toggle, resolve | C | `Alerts.tsx`, `transition_incident` | UI + DB test | Closed incident has `resolved_by` | Verified | R (resolve) | `Alerts.tsx:132-172` |
| FR-ADMIN-005 | System Log + export | C | `Logs.tsx` | UI test | Entries and file | Partially Verified | – | KI-04 text defect |
| FR-ADMIN-006 | Interactive map and alert feed | C | `InteractiveMap.tsx` | UI test | Distinct live/last-known/registered markers | Partially Verified | – | Tiles Cannot Verify |
| FR-ADMIN-007 | Security settings (timeouts, unlock, push) | SW-2.6.x | `Settings.tsx` | UI + DB | `settings` rows updated | Verified | L | `Settings.tsx:28-65` |

## FR-RESP

| ID | Requirement (short) | Source | Component | Verification | Expected | Status | Deploy | Evidence / missing |
|---|---|---|---|---|---|---|---|---|
| FR-RESP-001 | Responder dashboard (devices, incidents, klaxon) | C | `ResponderDashboard.tsx` | UI test | Tier 2 → fire state, sound | Partially Verified | – | KI-02, KI-03; view-embedding query (`devices_safe` + `sensor_readings`) not verified |
| FR-RESP-002 | Incident handling only via `transition_incident` | Rem | `lib/incidents.ts`, SQL function | DB test + UI test | Allowed transitions only; actor server-set | Verified | R | `incident_lifecycle.test.sql` (64 reported), `tests/incidents.test.ts` — not run |
| FR-RESP-003 | Alert log filter/export | C | `ResponderAlertLogs.tsx` | UI test | | Partially Verified | – | |
| FR-RESP-004 | Profile + station info + Telegram link | C | `ResponderSettings.tsx` | UI + DB | Save succeeds | **Conflicting** | – | UI columns ≠ migration columns (KI-07) |
| FR-RESP-005 | Support request e-mail | C | `AdminSupportModal`, `admin-support-request` | Integration with Resend sandbox | Mail received | Partially Verified | – | `profiles.email` absent in migrations (KI-08) |

## FR-RES

| ID | Requirement (short) | Source | Component | Verification | Expected | Status | Deploy | Evidence / missing |
|---|---|---|---|---|---|---|---|---|
| FR-RES-001 | Mandatory setup | C | `ResidentSetup` | UI | See FR-AUTH-006 | Verified | L | |
| FR-RES-002 | Link device by code (resident, approved+active) | C / Rem | `functions/link-device` | Integration | 403 for pending; 409 if claimed | Verified | R (status gate) | `link-device/index.ts:42-143`; `recipients.test.mjs` reported |
| FR-RES-003 | Home dashboard | C | `ResidentHome.tsx` | UI | Live readings, alerts | Partially Verified | – | KI-01, KI-03 |
| FR-RES-004 | Edit own thresholds (RPC) | C | `update_own_device_alert_settings` | DB test | Out-of-range rejected | Verified | L | `20260917080000` |
| FR-RES-005 | Resolve address-drift prompt | C | `resolve_address_discrepancy` | DB test + UI | Approval copies address & coords | Verified | L | `20261016000000`, `20261018000000` |
| FR-RES-006 | Device info + system log | C | `ResidentDeviceInfo`, `ResidentSystemLog` | UI | | Partially Verified | – | |
| FR-RES-007 | Account edit | C | `ResidentAccount` | UI | | Partially Verified | – | |
| FR-RES-008 | Push opt-in + Telegram link token | C | `ResidentAlertSettings`, `register-push`, `create_telegram_link_token` | Integration | Subscription row | Partially Verified | – | Linking yields no alerts (KI-24) |

## FR-IOT

| ID | Requirement (short) | Source | Component | Verification | Expected | Status | Deploy | Evidence / missing |
|---|---|---|---|---|---|---|---|---|
| FR-IOT-001 | MQ-7 60 s/90 s cycle; ppm model; `sensor_ready` | HW-x (unconfirmed) | `sensors.cpp` | Bench test with reference CO | ppm within accepted tolerance (**tolerance NS-RA**) | Verified (code); accuracy Unverified | – | `sensors.cpp:57-123`. No calibration evidence |
| FR-IOT-002 | DS18B20 5 s read; invalid discarded | C | `sensors.cpp` | Bench (unplug probe) | Value rejected; **stale-flag absent** | Verified | – | `sensors.cpp:137-156`; KI-17 |
| FR-IOT-003 | GPS fix validity and cached fix | C | `gps.cpp` | Outdoor test | `valid` only with live lock | Verified | – | `gps.cpp:21-57` |
| FR-IOT-004 | Tier 1/2 FSM with debounce | HW-x (unconfirmed) | `connectivity.cpp` | Host sim; bench | T1 one sensor; T2 both; 3 to enter, 2 to clear | Verified | – | `connectivity.cpp:126-134,503-608`; `test_connectivity_sim.cpp` reported |
| FR-IOT-005 | 30 s telemetry POST | C | `connectivity.cpp` | Integration | Row per 30 s | Verified | – | `connectivity.cpp:615-630`; extra fields dropped by backend |
| FR-IOT-006 | Remote config every 10 min | C | `fetchRemoteConfig`, `get-device-config` | Integration | Threshold change adopted ≤ 10 min | Verified | – | `connectivity.cpp:328-374` |
| FR-IOT-007 | Wi-Fi provisioning and reconnect | C | WiFiManager, `main.cpp` | Bench | Portal on first boot / 30 s loss | Verified | – | `connectivity.cpp:410-415`; `main.cpp:218-249` |
| FR-IOT-008 | LED/buzzer indication | C | `connectivity.cpp` | Bench | Yellow/red+buzzer/blue per state | Verified | – | `connectivity.cpp:88-123` |
| FR-IOT-009 | Device key auth + pinned CA | C | `httpsPost`, functions | Integration | Bad key → 401 | Verified | – | `connectivity.cpp:146-159`; CA expiry unchecked |
| FR-IOT-010 | Battery flag | C | `readBatteryMv` | Bench | `on_battery` below 4000 mV | Partially Verified | – | hardware-dependent |
| FR-IOT-011 | Watchdog 30 s | C | `main.cpp` | Bench stress | No reset under failing posts | Verified (timing Unverified) | – | `main.cpp:149-152`; model-based timing only |
| FR-IOT-012 | Alert POST retry/backoff + SMS-result binding | Rem | `alert_retry.h`, `sms_result_hold.h`, `connectivity.cpp` | Host tests; hardware | Delivery after reconnect; no cross-incident binding | Verified (code, host-simulated) | R | `host_tests/run.sh` reported; **not compiled for ESP32, not run on hardware** |

## FR-ALERT

| ID | Requirement (short) | Source | Component | Verification | Expected | Status | Deploy | Evidence / missing |
|---|---|---|---|---|---|---|---|---|
| FR-ALERT-001 | Server recomputes tier from stored thresholds; below-threshold → 400 | C | `trigger-alert` | Integration | Mismatch rejected | Verified | L (earlier form) | `trigger-alert/index.ts:325-339` |
| FR-ALERT-002 | One open incident per device, idempotent `raise_alert` | Rem | `20261020000100`, `trigger-alert` | DB concurrency test | 1 incident under N racers | Verified | R (gated) | `alert_concurrency.sh` (30 racers reported); activation gate checklist open |
| FR-ALERT-003 | Incident lifecycle & immutability | Rem | `20261021000000` | DB test | Transition table enforced | Verified | R | `incident_lifecycle.test.sql`, `incident_concurrency.sh` reported |
| FR-ALERT-004 | Auto-resolve on strictly-below readings | C | `ingest-reading` | Integration | Open incidents closed | Verified (policy undecided) | L | `ingest-reading/index.ts:180-196`; D6.1 |
| FR-ALERT-005 | Connectivity states 2/15 min | SW-2.4.3 (unconfirmed) | `lib/deviceStatus.ts` + pages | Unit + UI | Same state on all pages | **Conflicting** | – | KI-03 |
| FR-ALERT-006 | Retention policy | — | none | — | — | NS-RA | — | No code or policy (OQ-12) |

## FR-LOC

| ID | Requirement (short) | Source | Component | Verification | Expected | Status | Deploy | Evidence / missing |
|---|---|---|---|---|---|---|---|---|
| FR-LOC-001 | Store coords + `gps_valid`; (0,0) = no fix | C | `ingest-reading`, `trigger-alert` | Integration | NULL stored for (0,0) | Verified | L | `ingest-reading/index.ts:158-175` |
| FR-LOC-002 | live / last-known / registered / unavailable classification (15 min) | Rem (owner "provisional") | `lib/location.ts`, `LocationBadge` | Unit | Correct kind per input | Verified | R | `tests/location.test.ts` reported; 15 min provisional (OQ-18) |
| FR-LOC-003 | Reverse geocoding (tiered address; cache; timeout) | HW-1.2.3 / SW-2.3.2 (unconfirmed) | `trigger-alert`, `ingest-reading` | Integration with Nominatim | Street, barangay, municipality | Verified (external Unverified) | L (earlier form) | `trigger-alert/index.ts:20-79` |
| FR-LOC-004 | Address-drift detection >100 m | C | `ingest-reading` | Integration | One pending prompt | Verified | L | `ingest-reading/index.ts:198-261` |
| FR-LOC-005 | Registered location data | C | `Devices.tsx`, `devices` | UI/DB | | Verified | L | |

## FR-NOTIF

| ID | Requirement (short) | Source | Component | Verification | Expected | Status | Deploy | Evidence / missing |
|---|---|---|---|---|---|---|---|---|
| FR-NOTIF-001 | Telegram station message T1/T2 | O/C | `trigger-alert` | Integration with test bot | Message arrives | Verified (code); delivery Unverified | – | No delivery evidence |
| FR-NOTIF-002 | Web Push to admins/responders; resident on T2 | C | `trigger-alert`, `send-push-notification` | E2E with browser | Notification shown | Verified (code); delivery Unverified | – | Push ledger [R] |
| FR-NOTIF-003 | SMS to owner + BFP on T2, 5-min debounce | O | `gsm.cpp`, `connectivity.cpp` | Hardware test | Two SMS received | Verified (code); **Cannot Verify in Current Environment** | – | `gsm.cpp:136-215`; host sim only |
| FR-NOTIF-004 | SMS outcome reporting | C | `confirm-sms-status` | Integration | Flags updated; success never overwritten | Verified | L (prior form) | `confirm-sms-status/index.ts:67-131` |
| FR-NOTIF-005 | Notification ledger (at-least-once) | Rem | `20261020000000`, `trigger-alert` | DB + edge tests | No duplicates on replay | Verified | R | `alert_ledger.test.sql` (27), edge tests reported |
| FR-NOTIF-006 | Per-user Telegram alerts | proposed (D5.4/D5.5) | none | — | — | **Not Implemented** | — | issue #95; channel name reserved only |
| FR-NOTIF-007 | Support e-mail | C | `admin-support-request` | Integration | Mail sent | Partially Verified | – | KI-08 |
| FR-NOTIF-008 | In-app notification bell | C | `HeaderWidgets.tsx` | UI | Latest 10 alerts | Partially Verified | – | |

---

## Coverage of non-functional / cross-cutting items

| Item | Verification method | Status | Evidence |
|---|---|---|---|
| RLS enforcement per role | DB-policy tests per table/role | Partially covered by self-reported live tests; not re-run | `testing/reports/ROLE_BASED_ACCESS_TESTING.md`, `LIVE_RBAC_VERIFICATION.md` |
| Edge Function boundary/error behaviour (malformed payloads, timeouts) | Integration vs deployed functions | **Not started** per `LIVE_TESTING_SUMMARY.md` ("Not yet started") | `ERROR_EDGE_CASE_TESTING.md` |
| Performance / load | Load test | None exists | — |
| Hardware field test (sensors, GPS, SIM800L) | Physical prototype test | **Cannot Verify in Current Environment** | none in repo |
| CI | `ci.yml` | Typecheck, lint, build only — no tests | `.github/workflows/ci.yml` |

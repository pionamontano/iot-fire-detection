# AgapSense System Specification (Baseline Draft v0.2)

> **Status: DRAFT BASELINE — requires project-owner approval before it is treated as controlled.**
> This document describes what the repository *demonstrably contains*, separates that from what is *approved*, *deployed* and *tested*,
> and records every conflict and unknown instead of resolving it silently. It is a documentation artefact only: no code, firmware,
> schema, configuration or deployment was changed to produce it.

Companion documents: [`scope-boundary-register.md`](scope-boundary-register.md) (Deliverable B),
[`requirements-traceability.md`](requirements-traceability.md) (C), [`open-questions-and-decisions.md`](open-questions-and-decisions.md) (D),
[`change-request-template.md`](change-request-template.md) (E).

---

## 5.1 Document Control

| Item | Value |
|---|---|
| Document title | AgapSense System Specification and Scope Boundary Definition |
| System name | AgapSense — IoT-Based Fire Detection and Location Tracking System Using Multi-Sensor Fusion and Dual-Path Communication |
| Version / status | 0.2 — incremental backend re-review, **draft, not owner-approved** |
| Date prepared | 2026-10-12 (baseline); updated 2026-10-13 |
| Repository / branch | `pionamontano/iot-fire-detection`, branch `claude/epic-brahmagupta-r9vi1d` (baseline); `fix/revoke-alert-events-direct-update` (0.2 update) |
| Commit inspected | `5441cb78e4fef320eecc613fc3c7058ec669647c` ("Add documentation of audit remediation changes (#98)"), working tree clean before this document was added |
| Commit inspected (0.2 update) | Working-tree snapshot anchored near `96716ffb0caf78e28b64c2777dfacbcfa365bdbb`, **not a fixed commit**: the branch had uncommitted/untracked changes in progress in `supabase/migrations/` during this review (files were renamed and added mid-review — see §5.1 limitation 5). Scope limited to `supabase/functions/*` (all 14, stable throughout) and `supabase/migrations/*` (35 files read at the time of inspection; the directory kept changing afterward, so this is a lower bound, not an exact current count) — frontend, firmware and docs were not re-read |
| Method | Read-only static inspection of source, SQL migrations, firmware, tests and existing documentation. **No test suite, build, firmware compile, deployment or live-service call was executed in this review.** |

### Inspection coverage

| Area | Coverage | Notes |
|---|---|---|
| Edge Functions (`supabase/functions/*/index.ts`, 14 functions) | Read in full | |
| Migrations (`supabase/migrations/*`, 33 files) | Read in full (comment-stripped for the older ones) | The *live* schema is not available (see limitations) |
| Firmware `src/` (main, sensors, connectivity, gsm, gps, config.example) | Read in full | `alert_retry.h`, `sms_result_hold.h`, `host_tests/` read only via documentation, not line by line |
| Frontend routing, auth, layouts, `src/lib/*`, `AuthGuard`, `AuthContext`, `useIdleTimeout` | Read | |
| Frontend pages (`src/pages/**`) | **Sampled**: data-access calls, handlers and headings extracted for every page; render logic read only where cited | Visual layout and every conditional branch were not reviewed |
| Existing docs (`README`, `docs/*`, `testing/reports/*`, `CONTRIBUTING`) | Read (testing reports: summary + selected sections) | Treated as *claims*, not proof |
| Tests (`tests/`, `supabase/tests/`, `firmware/.../host_tests/`) | Listed and described in docs; **not executed** | |
| Postman collection, `seed_script.ts`, `verify2.py`, `patch_*.cjs`, `scripts/*` | Not reviewed | Auxiliary tooling; classified Unverified |
| **[0.2 update]** Edge Functions (all 14, re-read in full) | Re-read in full | Findings: KI-08 (rewritten), KI-26, KI-28; test-suite break noted separately (see PR review, not duplicated here) |
| **[0.2 update]** Migrations (`supabase/migrations/*`, 35 files as of this update, including one untracked file) | Read in full, in order, reconstructed as current effective schema (later migrations superseding earlier ones) | Findings: KI-25, KI-27, KI-29; frontend/firmware/docs were **not** re-read for this update |

### Known limitations of this review

1. **No access to the live Supabase project, Vercel deployment, Telegram, Resend, Web Push services, SIM800L/ESP32 hardware, or any private credential.** Everything about runtime behaviour is therefore *inferred from code* unless a document is cited as a self-reported result.
2. **The live database may differ from the repository.** The repository's own documents state that production's migration history differs from `supabase/migrations/` and that the live definition of `get_auth_role()` has never been inspected (`docs/CHANGELOG_AUDIT_REMEDIATION.md` §11, `docs/ALERT_DELIVERY_AND_INCIDENT_INVARIANTS.md` §4).
3. **No owner-supplied requirements document is in the repository.** Code comments cite requirement IDs (`SW-2.1.1` … `SW-2.6.3`, `HW-1.1.5` … `HW-1.5.2`) from a specification that is *not present*. Those IDs are recorded here as *referenced, unconfirmed requirements*.
4. Test results quoted from `docs/` or `testing/reports/` are **self-reported by the repository authors and were not re-executed** here.
5. **[0.2]** During the 0.2 incremental review, the working tree was under active concurrent edit (a migration file was renamed mid-review — `20261022000000_support_requests.sql` → `20261022000001_support_requests.sql` — and others were added). All 0.2 findings were re-verified against the file paths current at the time each was written into this document, but the repository may have moved on further by the time it is read; treat filenames/line numbers in KI-08 and KI-25–KI-29 as accurate as of this update's citations, not as a live guarantee.

### Change history

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-10-12 | First specification baseline (this document). |
| 0.2 | 2026-10-13 | Incremental backend-only re-review (all Edge Functions, full migration history re-read as current effective schema). Resolved the `get_dashboard_stats()` Unverified note into confirmed KI-25. Added KI-25–KI-29 (dashboard-stats privilege exposure, login-lockout case-sensitivity bypass, `get_device_api_key_secure()` missing `search_path` pin, `manage-registration` duplicate-device gap, `reviewed_by`/`unlocked_by` FK convention break). Rewrote KI-08, B7, C8, FR-RESP-005, FR-NOTIF-007 and §5.10/§5.12 Resend entries: the Resend e-mail support path they described was replaced by an in-app admin inbox (`support_requests` table, PR #107) before this update; added the `support_requests` table to §5.8 and new gaps found in its replacement. |

### Relationship to existing documents (not overwritten)

| Existing document | Assessment | Evidence |
|---|---|---|
| `docs/AGAPSENSE_SYSTEM_SPECIFICATION.md` | **Stale; not authoritative.** Written at commit `df2cfe4…` (before audit remediation). Left untouched. | Cites paths that do not exist (`src/pages/Dashboard.tsx`, `src/pages/RegisterResident.tsx`); says the Web Push service worker "is absent" while `public/sw.js` exists; describes responders updating `alert_events` directly, now superseded by `transition_incident()`; says no GUI edits `station_settings` while `ResponderSettings.tsx` does. |
| `docs/FEATURES.md` | **Partly inaccurate.** | Lists `ResponderTeam.tsx` and `ResponderDevices.tsx` (not in `src/pages/responder/`, which holds 3 files); says SMS goes to "Resident and BFP (Responders)" — the BFP SMS goes to the single per-device `devices.bfp_contact` number (`trigger-alert/index.ts:456`, `get-device-config/index.ts:72`); says pending users are blocked by RLS "mathematically" — see KI-09. |
| `docs/ALERT_DELIVERY_AND_INCIDENT_INVARIANTS.md`, `docs/CHANGELOG_AUDIT_REMEDIATION.md`, `docs/STAGING_DRY_RUN_RUNBOOK.md`, `docs/FIRMWARE_GUIDE.md`, `docs/MIGRATION_GUIDE.md` | Consistent with code in every place checked; used as secondary evidence. | |

> **Owner action:** decide whether `AGAPSENSE_SYSTEM_SPECIFICATION.md` and `FEATURES.md` are to be superseded by this document (OQ-14).

### Status vocabulary used throughout

**Verified** (read in code/authoritative doc) · **Approved Requirement** (explicitly established by the owner — *none located beyond the project description in the task brief*) ·
**Partially Verified** · **Unverified** · **Conflicting** · **Not Implemented** · **Proposed**.
Separate axes are always kept apart: **Implemented (in repo)** ≠ **Tested** ≠ **Deployed** ≠ **Approved**.

### Deployment state (important context for every status below)

* Audit-remediation work (PR #94: profiles RLS, recipient eligibility, notification ledger, `raise_alert`, incident lifecycle, firmware retry) **is merged to `main` but, per `docs/CHANGELOG_AUDIT_REMEDIATION.md` header and §11, has not been deployed** to any shared database, Edge Function runtime, or device. Items marked *Implemented (repo) — not deployed* below describe code, not the running system.
* Earlier fixes (`20260917…`–`20261018…` migrations and `login` function) are reported as deployed and re-verified live in `testing/reports/LIVE_TESTING_SUMMARY.md` (self-reported; not re-verified here).

---

## 5.2 System Overview

**Purpose (project description supplied by the owner).** Real-time detection of fire-related conditions in residences in the City of Malolos, Bulacan; reporting of device location; monitoring by administrators, BFP responders and residents; and alert delivery over a primary Wi-Fi path with a GSM/SMS path.

**Problem addressed.** Early fire/CO detection with location-bearing alerts delivered to residents and the Bureau of Fire Protection (BFP).

**Stakeholders / users.** System Administrator, BFP Responder, Resident; the IoT device acts as a non-human client (§5.4).

**Operating environment.** ESP32-based node (MQ-7 CO sensor, DS18B20 temperature sensor, NEO-6M GPS, SIM800L GSM, LEDs/buzzer) → HTTPS to Supabase Edge Functions → PostgreSQL/Auth/Realtime → React SPA (Vite, hosted on Vercel per `vercel.json`; hosting itself Unverified). External: OpenStreetMap Nominatim (reverse geocoding) and OSM tiles via Leaflet, Telegram Bot API, Web Push (VAPID), cellular network for SMS. Support requests are stored in-app (`support_requests` table, no external service) since #107 [0.2].

**High-level capabilities (what the code does).**
1. Sense CO and temperature; classify Tier 1 (one sensor over its threshold) / Tier 2 (both) with debounce; indicate locally; post to the backend.
2. Backend re-derives the tier from stored per-device thresholds, records one incident per device, notifies by Telegram (shared station chat) and Web Push, and returns SMS recipient numbers to the device.
3. The device sends Tier 2 SMS directly through the SIM800L, independent of Wi-Fi, and reports per-SMS outcome back.
4. Role-based web UI for approval workflow, device management, monitoring, incident handling, thresholds and settings.

**Components and responsibilities**

| Component | Responsibility | Key paths |
|---|---|---|
| ESP32 firmware | Sensing, local alert FSM, LEDs/buzzer, GPS, HTTPS posts, SMS via GSM, Wi-Fi provisioning | `firmware/agapsense-firmware/src/` |
| Edge Functions (Deno) | Device ingestion/alerting, auth gate, registration, device assignment, push, Telegram webhook, support e-mail | `supabase/functions/` |
| PostgreSQL + RLS + RPCs | System of record, authorisation, incident lifecycle, notification ledger | `supabase/migrations/` |
| Web SPA | Presentation for three roles; direct PostgREST reads/writes under RLS; RPC calls | `src/` |
| Service worker | Display Web Push notifications | `public/sw.js` |

**System boundary and external dependencies.** See §5.12.

---

## 5.3 Scope Definition

> Basis for "In Scope": the project description in the task brief (the only owner-supplied statement of objectives) plus features that are implemented *and* consistent with it. No separate approved requirements document was found, so each In-Scope item is "owner-described objective" (O) or "implemented and consistent with objective, awaiting confirmation" (C). Both are listed for owner ratification (OQ-01).

### A. In Scope

| # | Capability | Basis | Rationale / evidence |
|---|---|---|---|
| A1 | Multi-sensor (CO + temperature) fire detection with two alert tiers | O | `connectivity.cpp:126-134`; `trigger-alert/index.ts:325-339` |
| A2 | GPS location capture and reporting; reverse geocoding to an address | O | `gps.cpp`; `trigger-alert/index.ts:38-79` |
| A3 | Wi-Fi primary data path; GSM/SMS second path | O (with "subject to verification" caveat) | `connectivity.cpp`, `gsm.cpp`; see §5.7 for the precise (non-fallback) semantics |
| A4 | Alert delivery via Telegram and SMS | O | `trigger-alert/index.ts:189-199`; `gsm.cpp:136-215` |
| A5 | Web application with Admin, BFP Responder and Resident roles | O (roles named in brief) | `src/App.tsx:64-96` |
| A6 | Registration with administrator approval | C | `register`, `manage-registration`, `AuthGuard.tsx` |
| A7 | Device registration, ownership (one resident per device), API-key authentication | C | `Devices.tsx`, `20260917040000_*`, `regenerate_device_api_key` |
| A8 | Incident monitoring and responder handling (acknowledge → responding → resolved/false alarm) | C | `transition_incident()`, `ResponderDashboard.tsx` |
| A9 | Per-device configurable thresholds (admin; resident via RPC) | C | `Devices.tsx`, `update_own_device_alert_settings` |
| A10 | Map-based device/incident location display | C | `InteractiveMap.tsx`, `lib/location.ts` |
| A11 | Login lockout, idle timeout | C (cited as `SW-2.6.x` in comments) | `login`, `check_login_lockout`, `useIdleTimeout.ts` |

### B. Implemented but Unverified (behaviour or integration not confirmed in this review)

| # | Item | Why unverified |
|---|---|---|
| B1 | Telegram station notifications | Requires bot token/chat; delivery never demonstrated in repo evidence |
| B2 | Web Push to admins/responders/resident | VAPID keys, browser subscriptions, push services not observable; UI wiring to `subscribeUserToPush` found only on Admin Settings and Resident Alert Settings (responder push UI not found) |
| B3 | SIM800L SMS path and `+CMGS` outcome reporting | Hardware; only host-simulated tests reported |
| B4 | Nominatim reverse geocoding + 24 h in-memory cache | External service, per-isolate cache |
| B5 | Realtime (`postgres_changes`) live updates | Needs live Supabase; remediation notes say profile-filtered Realtime "not verified live" |
| B6 | Idle-timeout hook, password reset flow | Only partly read; live-verified per self-reported reports |
| B7 | Support request inbox (in-app, `support_requests` table; replaced Resend e-mail, #107) | Insert path verified in code (service-role, bypasses RLS by construction); admin-side inbox UI not re-read in the 0.2 update; see KI-08 |
| B8 | OSM tile rendering, Vercel hosting | External |
| B9 | Auxiliary tooling (`seed_script.ts`, `verify2.py`, `patch_*.cjs`, Postman collection) | Not reviewed |

### C. Incomplete or Defective

| # | Item | Summary | Reference |
|---|---|---|---|
| C1 | Per-user Telegram alerts | Account linking exists; **no code sends alerts to `profiles.telegram_chat_id`**; webhook tells users "You will receive fire alerts here" | KI-24, issue #95 |
| C2 | Backend enforcement of account approval | `get_auth_role()` in the repo ignores `profiles.status`; live behaviour unknown | KI-09 |
| C3 | Fabricated display metrics (resident "System Uptime 99.98%", responder "connectivity %") | Hard-coded values | KI-01, KI-02 |
| C4 | `station_settings` UI vs schema mismatch | UI reads/writes `station_name`, `email`; migrations define `team_name`, `commander_name` … | KI-07 |
| C5 | Auto-resolution policy and device-clear display | Owner decision D6.1 pending (Step 6.3) | KI-13, issue #96 |
| C6 | Direct `UPDATE` on `alert_events` still granted (Step 6c) | Revoke migration written (`20261022000000`), not deployed; apply only after 6.1/6.2 are live | issue #97 |
| C7 | Stale-sensor detection in firmware | `last_co_ms`/`last_temp_ms` written, never read | KI-17 |
| C8 | *(Resolved by #107, confirmed 0.2)* `admin-support-request` no longer reads a `profiles.email` column or sends e-mail; it inserts into `support_requests` via service-role. New gaps found in the replacement (unapproved accounts can file requests; `category` unvalidated) | See updated KI-08 | KI-08 |

### D. Proposed but Not Approved

Nothing here is part of the baseline. See §19 (Recommendations) and the Decision Register. Examples already proposed *inside the repository* but explicitly pending owner decision: keep-alive re-assert (D5.2), UTC label on message times (D5.6), SMS duplicate-on-reboot mitigation (D5.7), admin reopen (D6.4), incident backfill (D6.3), per-user Telegram (D5.4/D5.5).

### E. Out of Scope (current baseline; *assumptions marked for owner ratification*)

| # | Exclusion | Rationale | Status |
|---|---|---|---|
| E1 | Cellular data (GPRS/HTTP) transport over the GSM module | Firmware uses the SIM800L for SMS only; no data-over-GSM code exists. **Not** "absent therefore excluded": the brief says "dual-path communication", so this is flagged as OQ-02 rather than excluded | **Needs owner ruling** |
| E2 | Replacing Supabase, React, Leaflet/OSM, Nominatim, Telegram, ESP32 platform | Stack named by owner | Defensible |
| E3 | Other detection modalities (smoke particulate, flame, humidity) | Brief names MQ-7 CO + DS18B20 temperature only (note UI/log text mentions "smoke"; see KI-04) | Defensible |
| E4 | Automatic dispatch of fire trucks / integration with BFP CAD systems | No such integration in brief or code | Assumption |
| E5 | Email/OAuth/social login, 2FA | Only e-mail+password exists; none requested | Assumption |
| E6 | Mobile native apps | Web app + push only | Assumption |
| E7 | Resident self-registration as admin | `register` accepts only `resident` / `bfp_responder` (`register/index.ts:38`) | Verified behaviour; intent assumed |

---

## 5.4 Stakeholders and User Roles

Roles are exactly those in `profiles.role` CHECK (`20260717000000_init.sql:29`): `admin`, `bfp_responder`, `resident`; account state in `profiles.status` ∈ {`approved`,`pending`,`rejected`} and `profiles.is_active`. **No other roles exist and none are proposed.**

> **Frontend vs backend.** Route protection (`AuthGuard.tsx`) is a *UI convenience*. Authority is the database (RLS/grants/RPC) and Edge Functions. The two are compared per role below.

### Administrator (`admin`)

| Aspect | Detail | Evidence |
|---|---|---|
| Purpose | Approve users, manage devices/thresholds, monitor all incidents, security settings | |
| UI pages | `/dashboard`, `/admin/map`, `/admin/devices`, `/admin/users`, `/admin/status` ("Device Status"; `/admin/alerts` redirects there), `/admin/logs`, `/admin/settings/security` | `App.tsx:64-75`; nav `AdminLayout.tsx:21-32` (map has route but no sidebar entry — navigation reaches it from elsewhere; not traced) |
| Backend authority | RLS `FOR ALL` via `get_auth_role()='admin'` on `devices`, `alert_events` (incl. DELETE), `settings`, `station_settings`, `registration_requests`, `address_discrepancies`, `login_lockout_overrides`; read on `sensor_readings`, `login_attempts`; sole reader of other users' profiles (`is_approved_admin()`); executes `manage-registration`, `create-user`, `assign-device`, `regenerate_device_api_key`, `admin_unlock_login` | init.sql:278-352; `20261019000000`; function files |
| Data visibility | Everything, including `devices.api_key` (via `get_device_api_key_secure` in `devices_safe`) | `20261015000000` |
| Restrictions | Cannot self-register; admin bootstrap is a manual SQL insert (`init.sql:372-378`). Manual close of an incident is admin-only from `active` (`transition_incident`) | |
| Gap | `AuthGuard` checks `status='approved'` but not `is_active`; Edge admin checks do not check `is_active` either | `AuthGuard.tsx:55`; `assign-device/index.ts:42` |

### BFP Responder (`bfp_responder`)

| Aspect | Detail | Evidence |
|---|---|---|
| Purpose | Monitor incidents and devices, handle incidents, maintain station info | |
| UI pages | `/responder`, `/responder/alerts`, `/responder/settings` | `App.tsx:78-84` |
| Backend authority | `SELECT` on `devices` (column-restricted, no `api_key`), `sensor_readings`, `alert_events`; incident changes through `transition_incident()` (approved+active checked inside); **also** direct column `UPDATE` on `alert_events` (`incident_status, acknowledged_by, acknowledged_at, outcome_notes, resolved_at`) and **`FOR ALL` on `station_settings`** by role only | `20261012000001`, init.sql:341-342 |
| Data visibility | All devices' readings/incidents (not scoped to a station or area — no such concept in schema) | init.sql:301-302 |
| Prohibited | User management, device edits, API keys, other users' profiles | enforced by RLS absence of policies (Verified in repo) |
| Concern | Role-only RLS (KI-09/KI-11) — a pending/rejected responder account may hold these rights if live `get_auth_role()` matches the repo definition | |

### Resident (`resident`)

| Aspect | Detail | Evidence |
|---|---|---|
| Purpose | Monitor own device, edit its thresholds, review location-drift prompts, manage own contact | |
| UI pages | `/setup` (mandatory first), `/home`, `/home/alerts`, `/home/settings`, `/home/devices`, `/account` (`/home/logs` redirects to `/home/alerts`) | `App.tsx:87-95` |
| Backend authority | Read own device (`devices_safe`/column grants), own `sensor_readings`/`alert_events` (`device_id = own`); `update_own_device_alert_settings()` (CO 0–1000, temp 0–100; approved resident only); `resolve_address_discrepancy()` (own rows; approval overwrites the device's registered address and coordinates); self-update of own profile (non-protected columns); `link-device` Edge Function | `20260917080000`, `20261016000000`, `link-device/index.ts` |
| Prohibited | Other residents' data; role/status/device_id changes via direct update (trigger resets them) | `protect_profile_fields` init.sql:236-261 |
| Concerns | `protect_profile_fields` does not cover `is_active`, `setup_complete`, `telegram_chat_id` (KI-10). A resident's approval of a drift prompt changes the *device-wide* registered location used by all subsequent drift checks (design as implemented) | |

### IoT device / system process (non-human)

* Authenticates with `x-device-key` matched to `devices.api_key` (+ `is_active`) in `ingest-reading`, `trigger-alert`, `get-device-config`, `confirm-sms-status`. All use the **service-role** client, bypassing RLS; each function scopes writes to the key's own `device.id`.
* The device sends the public anon key as `Authorization: Bearer` (`connectivity.cpp:158`); this is not an identity.
* Direct client INSERT into `sensor_readings`/`alert_events` is revoked and RLS-denied (`20260917010000`).

---

## 5.5 Functional Requirements

**Normative language.** Because no owner-approved requirements document exists, requirements are written as *"Currently implements …"* (observed) rather than "shall". Items the owner ratifies in OQ-01 convert to "shall". Status columns use §5.1 vocabulary plus *Repo*/*Deployed* qualifiers. Acceptance criteria describe how the stated behaviour would be demonstrated; none was executed in this review.

Deployment qualifier key: **[R]** = implemented in repo only (not deployed per repo docs); **[L]** = reported live-verified (self-reported); **[–]** = no deployment information.

### FR-AUTH — Authentication and account lifecycle

| ID | Requirement (current behaviour) | Source | Role | Status | Evidence | Acceptance criteria | Limitations / questions |
|---|---|---|---|---|---|---|---|
| FR-AUTH-001 | Public registration (`register`) for roles `resident` and `bfp_responder` only; creates the auth user (`email_confirm:true`), a `profiles` row with `status='pending'`, and a `registration_requests` row; rolls back both on failure. Validates required fields, PH mobile `09XXXXXXXXX`, e-mail shape, password ≥ 6 chars; resident requires address, responder requires organization | Implemented (C) | Public | Verified [L] | `register/index.ts:24-140` | Register each role → pending profile + request exist; duplicate e-mail → 409; admin role request → 400 | Password policy minimum is 6 (Not Specified — Requires Approval). E-mail is auto-confirmed (no ownership verification) — OQ-15 |
| FR-AUTH-002 | Sign-in goes through `login`: checks `check_login_lockout`, forwards credentials to GoTrue, records every attempt in `login_attempts`, returns tokens or a lockout response. Lockout tiers within a 15-min window: ≥3 failures→10 s, ≥5→30 s, ≥7→900 s; admin override via `admin_unlock_login` | `SW-2.6.2` (cited, unconfirmed) | Public | Verified [L] | `login/index.ts:80-103`; `20260924090000`; `20260924010000` | 3 bad logins → 429/locked with decreasing countdown; admin unlock → immediate success | Direct calls to GoTrue `/auth/v1/token` bypass the lockout; owner accepted this trade-off (`LIVE_TESTING_SUMMARY.md`). Lockout keyed by e-mail only, not IP |
| FR-AUTH-003 | UI shows Pending/Rejected screens and blocks app routes for any non-`approved` profile | C | All | Verified | `AuthGuard.tsx:55-79`; policy allowing own-profile read `20261019000000` | Pending account logs in → sees "Account Pending", no dashboard | UI only; see FR-AUTH-004 |
| FR-AUTH-004 | Backend data access is denied to non-approved accounts | C (stated aim of `20260917030000`, FEATURES.md) | All | **Conflicting** | repo `get_auth_role()` = `SELECT role FROM profiles …` with **no status check** (`init.sql:192-195`); `20261019000000` header says so; older migration comments and `LIVE_RBAC_VERIFICATION.md` row 38 say live behaviour revokes immediately | Query `alert_events` as a *pending responder* via PostgREST → expect 0 rows | Live definition never inspected (OQ-03). Only profile reads and `transition_incident`/Edge functions are explicitly status-checked |
| FR-AUTH-005 | Route protection by role with redirect to the role's home | C | All | Verified | `AuthGuard.tsx:81-91`; `App.tsx` | Resident opening `/admin/users` → redirected to `/home` | UI-only |
| FR-AUTH-006 | Resident must complete `/setup` (valid, confirmed mobile number) before any other resident page | C | Resident | Verified | `AuthGuard.tsx:94-100`; `ResidentSetup.tsx:30-55` | New resident cannot reach `/home` before setup | Phone format checked only client-side + register function |
| FR-AUTH-007 | Per-role idle timeout, minutes read from `settings` keys `timeout_admin`, `timeout_bfp`, `timeout_resident` (UI defaults 15/15/60), sign-out → `/session-expired` | `SW-2.6.1` (cited) | All | Partially Verified [L] | `useIdleTimeout.ts:1-40` (head read); `Settings.tsx:115-134` | Idle beyond limit → redirected to session-expired | Remainder of hook not read; defaults live in UI, not DB |
| FR-AUTH-008 | Password reset by e-mail link (`resetPasswordForEmail` → `/reset-password` → `updateUser`) | C | Public | Partially Verified | `ForgotPassword.tsx:17`, `ResetPassword.tsx:61` | Request link → set new password | Depends on Supabase e-mail + redirect URL config (Unverified) |
| FR-AUTH-009 | Non-admin users cannot change their own `role`, `status` or `device_id` (trigger reverts them) | C | All | Verified [L] | `init.sql:236-261` | Direct PATCH of own role → unchanged | Trigger omits `is_active`, `setup_complete`, `telegram_chat_id` (KI-10) |
| FR-AUTH-010 | Only approved admins can read other users' profiles | C (remediation Step 1) | Admin | Verified [R] | `20261019000000` (`is_approved_admin()`); test `profiles_rls.test.sql` (reported 13 checks) | Resident reads another profile → 0 rows | Not deployed; see FR-AUTH-004 |

### FR-ADMIN — Administrator

| ID | Requirement (current behaviour) | Source | Status | Evidence | Acceptance | Limitations |
|---|---|---|---|---|---|---|
| FR-ADMIN-001 | Dashboard: device list with connectivity state, active (unresolved) alerts, user count, recent readings, with Realtime refresh | C | Partially Verified | `Dashboard.tsx:56-96` | Counts match DB; new alert appears without reload | Realtime not verifiable offline |
| FR-ADMIN-002 | User management: list profiles and registration requests; approve (optionally assigning a device), reject, delete (auth-user delete cascades); create a pre-approved user; assign/unassign a device | C | Verified (code) | `Users.tsx:76-250`; `manage-registration/index.ts:67-126`; `create-user/index.ts`; `assign-device/index.ts` | Approve → profile `approved`, request marked reviewed | `create-user` inserts without `status`, so new rows take DB default `approved` (init.sql:33) — intended per "pre-approved" comment; role value validated only by DB CHECK |
| FR-ADMIN-003 | Device registration: create (code, label, address text, coordinates, thresholds, BFP contact), edit thresholds/contact, activate/deactivate, regenerate API key (RPC, admin-only, key shown once in UI) | C | Verified (code) | `Devices.tsx:97-176`; `20260924000000`; `20260924050000` (CHECK 0–1000 / 0–100) | New device appears with server-generated key (`sk_`+48 hex, `20260917050000`) | Key stored plaintext in `devices.api_key` (existing design) |
| FR-ADMIN-004 | "Device Status" (formerly "System Overview"): fleet status, manual resolve through `transition_incident`. Enable/disable (`is_active`) moved to Devices → Edit device, behind a typed confirmation; disabled devices have their own "Disabled" status | C | Verified (code) [R for resolve] | `DeviceStatus.tsx:158-167` | Resolve → incident closed with `resolved_by` set | Direct `devices.update` from the browser relies on admin RLS |
| FR-ADMIN-005 | System Log merges recent alert events, login attempts, device registrations (50 each), with export | C | Partially Verified | `Logs.tsx:50-130,161` | Entries visible, export produces file | Fixed description text for every alert (KI-04); only latest 50 per source |
| FR-ADMIN-006 | Interactive map of devices (live/last-known/registered markers) and a live alert feed | `A10` | Partially Verified | `InteractiveMap.tsx:111-132`; `lib/location.ts` | Markers distinct per state | Tiles external (B8) |
| FR-ADMIN-007 | Security settings: session timeouts, unlock a locked login, push-notification toggle | `SW-2.6.x` | Verified (code) | `Settings.tsx:28-65` | Saved values appear in `settings` | Settings saved with client `upsert` (admin RLS) |

### FR-RESP — BFP Responder

| ID | Requirement (current behaviour) | Source | Status | Evidence | Acceptance | Limitations |
|---|---|---|---|---|---|---|
| FR-RESP-001 | Dashboard: devices with state (fire / fault(pre-alert) / offline / normal), unresolved incidents feed, map, audible "klaxon" for unacknowledged critical fire | C | Partially Verified | `ResponderDashboard.tsx:225-300` | Tier 2 incident shows as fire | "Connectivity %" is simulated (KI-02); offline cut-off is 5 min (KI-03) |
| FR-RESP-002 | Incident handling only via `transition_incident()`: acknowledge, responding, resolved, false alarm (confirmation on close; errors mapped to messages) | remediation 6.1/6.2 | Verified (code) **[R: DB function must be deployed first]** | `lib/incidents.ts`; `20261021000000`; `ResponderDashboard.tsx:230-240`; test `incident_lifecycle.test.sql` (reported 64) | Full transition table in §5.9 | Without the migration, actions fail with `PGRST202` message (`incidents.ts:62`) |
| FR-RESP-003 | Alert log with filtering and export | C | Partially Verified | `ResponderAlertLogs.tsx:61-130` | Filters narrow list | |
| FR-RESP-004 | Own profile (name, contact) and Telegram link; station information editor (`station_settings` id=1) | C | **Conflicting** (schema) | `ResponderSettings.tsx:49-135`; init.sql:90-100 | Save station info succeeds | Columns `station_name`, `email` not in migrations (KI-07) |
| FR-RESP-005 | Support request filed in-app via `admin-support-request` into `support_requests`, reviewed by an admin inbox (replaced Resend e-mail, #107) | C | Verified (backend code, 0.2); admin-inbox UI not re-read in 0.2 | `AdminSupportModal.tsx:40`; `admin-support-request/index.ts`; `20261022000001_support_requests.sql` | Row appears in `support_requests` | Any authenticated caller, not just approved accounts; `category` unvalidated (KI-08) |

### FR-RES — Resident

| ID | Requirement (current behaviour) | Source | Status | Evidence | Acceptance | Limitations |
|---|---|---|---|---|---|---|
| FR-RES-001 | Mandatory setup of mobile number (see FR-AUTH-006) | C | Verified | | | |
| FR-RES-002 | Link a device by `device_code` (`link-device`): caller must be resident, approved, active; device must exist, be active, not be linked to another resident; cannot silently replace an existing link | C; Step 2 | Verified (code) [R: approved/active gate] | `link-device/index.ts:42-143`; unique index `20260917040000` | Linking an already-claimed device → 409 | Device code is the only proof of ownership (OQ-16) |
| FR-RES-003 | Home: device status, current readings, last 24 readings chart, latest 10 alerts, activity log, Realtime refresh | C | Partially Verified | `ResidentHome.tsx:101-143,254-283` | | "System Uptime" hard-coded (KI-01); online = 5 min (KI-03) |
| FR-RES-004 | Edit CO and temperature thresholds of own device via `update_own_device_alert_settings` (CO 0–1000 ppm, temp 0–100 °C) | C | Verified | `20260917080000`; `ResidentAlertSettings.tsx:141-190` | Out-of-range → rejected | Residents can lower thresholds arbitrarily; no policy limit (Not Specified — Requires Approval) |
| FR-RES-005 | Review "address discrepancy" prompts; approving copies GPS-derived address+coordinates onto the device's registered location | C | Verified (code) | `ResidentHome.tsx:303-330`; `20261016000000`; `20261018000000` | Approve → `devices.location_desc/latitude/longitude` updated | Changes the location used for all later drift checks; no admin review step |
| FR-RES-006 | Device information page (recent readings) and Alert History of own alerts | C | Partially Verified | `ResidentDeviceInfo.tsx:37-38`; `ResidentAlerts.tsx` | | |
| FR-RES-007 | Account page: name/contact edit | C | Partially Verified | `ResidentAccount.tsx:47-70` | | Direct profile update, client-side validation only |
| FR-RES-008 | Notification preferences: Web Push opt-in; Telegram link-token generation | C | Partially Verified | `ResidentAlertSettings.tsx:71-140`; `create_telegram_link_token` | Push subscribe row appears | Telegram link has no downstream alert use (KI-24) |

### FR-IOT — Device and firmware

| ID | Requirement (current behaviour) | Source | Status | Evidence | Acceptance | Limitations |
|---|---|---|---|---|---|---|
| FR-IOT-001 | MQ-7 cycle: 60 s heating at full duty (≈5 V), 90 s measuring at PWM 72/255 (≈1.4 V); ADC 32-sample average every 5 s only while measuring; `ppm = 100·(Rs/R0)^-1.513`, R0 fixed 10 kΩ; `sensor_ready` becomes true after the first complete cycle (~150 s) | `HW-1.x` (cited) | Verified (code); accuracy Unverified | `sensors.cpp:57-123`; `config.example.h` | Hardware bench test against reference gas | No per-unit calibration (R0 constant); ppm model not validated; CO value is held (stale) during heating |
| FR-IOT-002 | DS18B20 read every 5 s at 12-bit; invalid (disconnected, <-55 or >125 °C) readings discarded and last valid kept | C | Verified (code) | `sensors.cpp:137-156` | Unplug probe → reading rejected | **No staleness limit**: a failed probe leaves the last valid value in use indefinitely (KI-17) |
| FR-IOT-003 | GPS: NEO-6M parsed continuously; fix is `valid` only if location valid and age < 5 s; otherwise the last good fix is republished with `valid=false`; initial value 0,0 | C | Verified (code) | `gps.cpp:21-57` | | HDOP/satellites are collected but not transmitted or used for validity |
| FR-IOT-004 | Alert FSM (evaluated every 2 s, only after `sensor_ready`): Tier 1 = exactly one sensor ≥ its threshold, Tier 2 = both; 3 consecutive readings to enter (and to escalate T1→T2), 2 consecutive safe readings to clear/de-escalate | `HW-1.x` (cited) | Verified (code) | `connectivity.cpp:126-134,503-608`; `ALERT_DEBOUNCE_COUNT`=3, `ALERT_RESOLUTION_COUNT`=2 | Simulated readings walk the FSM | Host simulation reported; compiled firmware not verified (OQ-10) |
| FR-IOT-005 | Telemetry POST to `ingest-reading` every 30 s when ONLINE (CO, temp, lat/lng, gps_valid, battery_mv, rssi, on_battery, sensor_ready, mq7_phase); a failure sets DEGRADED | C | Verified (code) | `connectivity.cpp:175-205,615-630` | | Backend persists only `co_ppm, temp_celsius, latitude, longitude, gps_valid, on_battery, sensor_ready`; `battery_mv`, `rssi`, `mq7_phase` are discarded (`ingest-reading/index.ts:129-138,166-175`) |
| FR-IOT-006 | Remote config: at boot and every 10 min fetch `co_alert_ppm`, `temp_alert_c`, `owner_number`, `bfp_number` from `get-device-config` | C | Verified (code) | `connectivity.cpp:328-374,478-482` | Admin changes threshold → device adopts within ≤ 10 min | Offline at boot → compiled-in defaults only (KI-06, KI-19) |
| FR-IOT-007 | Wi-Fi provisioning by WiFiManager captive portal (`AgapSense-Setup`, open AP); reconnect attempts every 60 s; portal relaunched after 30 s disconnected | C | Verified (code) | `connectivity.cpp:410-415,446-458`; `main.cpp:218-249` | | Open AP without password is a design choice, flagged OQ-17 |
| FR-IOT-008 | Local indicators: yellow = Tier 1, red + buzzer = Tier 2, blue = online (blinks when DEGRADED) | C | Verified (code) | `connectivity.cpp:88-123` | | |
| FR-IOT-009 | Device authenticates every Edge call with `X-Device-Key`; HTTPS validated against a pinned root CA (`setCACert`) | C | Verified (code) | `connectivity.cpp:146-159` | | Pinned CA expiry/rotation Unverified |
| FR-IOT-010 | Battery state: ADC divider ×2, `on_battery` when < 4000 mV | C | Partially Verified | `readBatteryMv`, `config.example.h` | | Calibration/hardware dependent |
| FR-IOT-011 | Hardware watchdog (30 s) on tasks; fed before blocking posts | C | Verified (code); timing Unverified | `main.cpp:149-152`; `connectivity.cpp:621,693,727` | | Real timing unproven |
| FR-IOT-012 | Alert POST retry with backoff (5/10/20/40/60 s; 3 tries on permanent 4xx; highest tier wins); SMS outcome late-binding to the right incident | remediation 5.3 | Implemented (repo) — host-simulated only **[R]** | `alert_retry.h`, `sms_result_hold.h`; `connectivity.cpp:687-741`; `host_tests/` (reported) | `host_tests/run.sh` passes | Compiled-for-ESP32 and on-hardware behaviour not verified; must be deployed after backend (deploy order) |

### FR-ALERT — Alerts and incidents

| ID | Requirement (current behaviour) | Source | Status | Evidence | Acceptance | Limitations |
|---|---|---|---|---|---|---|
| FR-ALERT-001 | Backend recomputes the tier from the device's stored thresholds (`>=`): both → 2; one → 1; neither → HTTP 400 `below_threshold`. The firmware-sent tier is ignored | C | Verified [L-prior version] | `trigger-alert/index.ts:325-339` | POST sub-threshold → 400 | A device whose stored thresholds differ from its local ones is rejected |
| FR-ALERT-002 | At most one open incident per device (`resolved_at IS NULL`); `raise_alert()` upserts atomically, tier only ever increases; repeated/late posts return the same incident | remediation 5.1/5.2 | Verified (code) **[R, gated]**; legacy select-then-insert fallback runs until migration applied (`persistence:"legacy"`) | `20261020000100`; `trigger-alert/index.ts:385-406,470-520`; tests reported | 20 concurrent posts → 1 incident | Index creation aborts if duplicate open incidents exist |
| FR-ALERT-003 | Incident lifecycle `active → acknowledged → responding → resolved / false_alarm`; closed ⇔ status∈{resolved,false_alarm} ⇔ `resolved_at` set; closed incidents are immutable; guard trigger normalises legacy writers | remediation 6.1 | Verified (code) **[R]** | `20261021000000` | See §5.9 table | CHECK is `NOT VALID` until an approved backfill (D6.3) |
| FR-ALERT-004 | Auto-resolution: a telemetry post with `sensor_ready` and both readings **strictly below** thresholds sets `resolved_at` on all of the device's open incidents (including acknowledged/responding ones) | C | Verified (code); **policy undecided** | `ingest-reading/index.ts:180-196` | | D6.1 pending; closes responder-owned incidents without responder action (KI-13) |
| FR-ALERT-005 | Device connectivity state: online <2 min, reconnecting 2–15 min, offline >15 min or never, from `last_seen_at` | `SW-2.4.3` (cited) | Verified in `lib/deviceStatus.ts`; **Conflicting** across pages | `deviceStatus.ts:11-12` vs `ResidentHome.tsx:168,254`, `ResponderDashboard.tsx` (5 min) | | KI-03 |
| FR-ALERT-006 | Retention/archival of readings and alerts | — | **Not Specified — Requires Approval** | No retention/cleanup code or policy found | | `sensor_readings` grows unbounded (30 s per device) — OQ-12 |

### FR-LOC — Location

| ID | Requirement (current behaviour) | Source | Status | Evidence | Acceptance | Limitations |
|---|---|---|---|---|---|---|
| FR-LOC-001 | Coordinates (lat/lng) and `gps_valid` stored with each reading and incident; (0,0) treated as "no fix" and stored as NULL | C | Verified | `ingest-reading/index.ts:158-175`; `trigger-alert/index.ts:345-347,390-391` | | A non-live cached fix is stored with `gps_valid=false`; no column records when the fix was actually acquired |
| FR-LOC-002 | UI classifies a device position as **live** (valid coordinates, `gps_valid`, reported ≤ 15 min ago), **last known**, **registered** (admin-entered install coordinates — never "live") or **unavailable**; never invents a position | owner decision "15 minutes" per CHANGELOG; `SW-2.4.4`? (not confirmed) | Verified (code) | `lib/location.ts:17,59-87`; `tests/location.test.ts` (reported) | | 15-min value is "provisional owner-approved" in code comments (OQ-18) |
| FR-LOC-003 | Reverse geocoding via Nominatim: builds "house+road, barangay (suburb/village/neighbourhood/quarter), municipality (city/municipality/town/county)", falls back to `display_name`; 3 s timeout; in-memory cache 24 h keyed by lat/lon to 4 decimals (~11 m) per function isolate | `HW-1.2.3`/`SW-2.3.2` (cited) | Verified (code); external service Unverified | `trigger-alert/index.ts:20-79`; `ingest-reading/index.ts:20-69` | | Failure → `null`, UI/Telegram fall back to `devices.location_desc` or "Unknown Location". Nominatim usage-policy/rate-limit exposure Unverified |
| FR-LOC-004 | Address-drift detection: if a *live* fix (`gps_valid`) is > 100 m from the device's registered coordinates and the device has a resident, create a `pending` `address_discrepancies` row unless a pending one exists or an earlier one lies within 50 m; requires the geocoded address to contain a comma | C | Verified (code) | `ingest-reading/index.ts:198-261` | Move a test device > 100 m → one pending prompt | Dead branch at line 239 (distance ≤ 100 inside a > 100 block). Insert is one of several parallel writes whose errors are not checked individually |
| FR-LOC-005 | Registered install location = admin-entered `devices.location_desc` (text) + `devices.latitude/longitude`; resident profile also has a free-text `address` | C | Verified | `Devices.tsx:152-165`; `register/index.ts:113` | | The two address texts are not reconciled |

### FR-NOTIF — Notifications

| ID | Requirement (current behaviour) | Source | Status | Evidence | Acceptance | Limitations |
|---|---|---|---|---|---|---|
| FR-NOTIF-001 | Telegram: one message to the **single shared station chat** (`TELEGRAM_CHAT_ID`) for Tier 1 and for Tier 2 (text differs; Tier 2 includes GPS and a Google Maps link) | O/C | Verified (code); delivery Unverified | `trigger-alert/index.ts:117-143,189-199,413-422` | Message arrives in the chat | Plain text; times printed in UTC without label (D5.6) |
| FR-NOTIF-002 | Web Push to all approved+active admins (Tier 1 and 2) and, on Tier 2 only, responders and the resident linked to the device | C | Verified (code); delivery Unverified | `trigger-alert/index.ts:201-261`; `send-push-notification/index.ts` | Subscribed browser shows notification | Responder push opt-in UI not found; recipients not area-scoped |
| FR-NOTIF-003 | SMS (SIM800L, text mode) on **Tier 2 only**: owner SMS (Filipino evacuation text + Maps link + address) and BFP SMS (device id, time, readings, link, address). 5-min debounce between SMS pairs; queued independently of Wi-Fi and of the alert POST result | O | Verified (code); hardware **Cannot Verify** | `connectivity.cpp:667-681`; `gsm.cpp:136-215,222-298` | SMS received on two handsets | Single-segment limit (~160 chars) — truncation order designed to keep the link; GPS may be 0,0 (KI-18); no SMS for Tier 1 (by design) |
| FR-NOTIF-004 | Per-SMS outcome (`+CMGS` seen) reported to `confirm-sms-status` → `alert_events.sms_sent_owner/_bfp`; failure never overwrites an earlier success | C | Verified (code) | `confirm-sms-status/index.ts:67-131` | | "Sent" means the modem returned `+CMGS`, not that the handset received it |
| FR-NOTIF-005 | Notification ledger (`alert_notifications`): claim before send, record outcome; ≤ 3 attempts; stale `pending` reclaimable after 2 min; fail-open if ledger unavailable; delivery semantics are **at-least-once** | remediation 5.1/5.2 | Verified (code) **[R]** | `20261020000000`; `trigger-alert/index.ts:145-178` | Replay → no duplicate send | Not deployed; reclaim happens only when a later request touches the same key |
| FR-NOTIF-006 | Per-user Telegram alerts to residents/responders | Proposed in repo (D5.4/D5.5) | **Not Implemented** | channel `telegram_user` reserved in `20261020000000` CHECK; no sender code | — | KI-24, issue #95 |
| FR-NOTIF-007 | Support request stored in-app (`support_requests` table); no e-mail is sent (Resend path removed, #107) | C | Verified (backend code, 0.2) | `admin-support-request/index.ts`; `20261022000001_support_requests.sql` | | KI-08 |
| FR-NOTIF-008 | In-app notification bell lists the 10 latest alert events with Realtime refresh | C | Partially Verified | `HeaderWidgets.tsx:34-55` | | Same query for all roles — result governed by RLS |

**Requirement count:** 10 AUTH · 7 ADMIN · 5 RESP · 8 RES · 12 IOT · 6 ALERT · 5 LOC · 8 NOTIF = **61 functional requirements** (statistics in `requirements-traceability.md`).

---

## 5.6 Nonfunctional Requirements

No quantitative NFR was found in any owner-level source. Items below are *observed*; targets are marked **Not Specified — Requires Approval (NS-RA)**.

| Area | Observed (verified in code) | Target |
|---|---|---|
| Security / authorisation | RLS on all tables; device writes service-role only (`20260917010000`); `api_key` masked via `devices_safe`/`get_device_api_key_secure` (`20261015000000`); admin-only RPCs (`is distinct from 'admin'` after NULL-bypass fix `20260924020000`); lockout; Telegram webhook secret compared in constant time (`telegram-webhook:15-25`); push endpoint restricted to service role or self/admin (`send-push-notification:37-60`) | Password policy NS-RA; session lifetime NS-RA; API-key rotation policy NS-RA |
| Security concerns | CORS `*` on all functions; `register` auto-confirms e-mail; open provisioning AP; plaintext `api_key`; `SECURITY DEFINER` `get_device_api_key_secure` without pinned `search_path` | — (see KI) |
| Data integrity | CHECK constraints on roles, statuses, tiers, thresholds; unique one-resident-per-device index; one-open-incident index [R]; lifecycle guard [R] | — |
| Reliability / fault handling | Persist-first-then-notify; bounded provider timeouts (default 3.5 s each, 4 s dispatch budget); fail-open ledger; firmware retry [R]; watchdog | Availability, RTO/RPO NS-RA |
| Performance | Telemetry every 30 s per device; alert POST synchronous at transition; HTTP timeout 10 s; geocode 3 s | Response-time / capacity targets NS-RA; no load test evidence |
| Availability / recovery | Reliant on Supabase, Vercel, Telegram, push services; no backups/DR documented except "fresh backup" before production migration (`CHANGELOG §11`) | NS-RA |
| Maintainability | TypeScript strict-ish, oxlint, CI typecheck/lint/build (`.github/workflows/ci.yml`); **CI does not run the test suites** (only typecheck, lint, build) | — |
| Usability / accessibility | Responsive layouts reported tested at 375/768/1440 px; field-level validation anti-pattern noted by owner's own testing; no accessibility standard claimed | NS-RA |
| Privacy of location data | RLS limits residents to own device; admins/responders see all; coordinates sent to Nominatim (third party) and embedded in SMS/Telegram/Google Maps links; no retention policy; no privacy notice found | Data-protection compliance basis (e.g., RA 10173) NS-RA — OQ-13 |
| Deployment / configuration | Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optional `VITE_VAPID_PUBLIC_KEY`; function secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `RESEND_API_KEY`, optional `ALERT_DISPATCH_BUDGET_MS`, `ALERT_PROVIDER_TIMEOUT_MS`, `ALERT_STRICT_DB`; firmware `config.h` (git-ignored; template `config.example.h`) | — |

---

## 5.7 System Architecture and Technology Boundaries

```
 ESP32 node ──HTTPS (Wi-Fi, X-Device-Key)──► Edge Functions ──service role──► PostgreSQL ──Realtime──► React SPA
  │  MQ-7, DS18B20, NEO-6M                    ingest-reading  trigger-alert        │  RLS / RPC           (PostgREST + RPC
  │                                           get-device-config confirm-sms-status  │                       under user JWT)
  └─SIM800L──SMS──► owner & BFP phones        │                                    └──► Telegram Bot API, Web Push, Nominatim
```

**Responsibility ownership**

| Responsibility | Owner component | Data movement |
|---|---|---|
| Sensing, debounce, local indication | Firmware | sensors → FSM → LEDs/buzzer |
| Authoritative tier & threshold | Backend (`trigger-alert` uses DB thresholds); firmware thresholds are a local copy refreshed every 10 min | DB → `get-device-config` → device |
| Incident record | PostgreSQL (`raise_alert`, `transition_incident`, guard trigger) | device → `trigger-alert` → `alert_events` |
| Reverse geocoding | Edge Function (not the device) | coordinates → Nominatim → `alert_events.address_resolved` / `address_discrepancies` |
| SMS dispatch | **Firmware** (backend only supplies numbers and address) | numbers ← `trigger-alert`/`get-device-config`; outcome → `confirm-sms-status` |
| Telegram / Push dispatch | Backend | `trigger-alert` → providers; outcome → `alert_notifications` [R] |
| Authorisation | Database (RLS, grants, RPC checks); Edge Functions for privileged operations | |
| Presentation | SPA; route guard is advisory | |

**Wi-Fi / GSM semantics (clarification of "dual-path").** The data path (telemetry, alert POST, config, SMS-status) is **Wi-Fi/HTTPS only**. The GSM module is used **only to send Tier 2 SMS**. SMS are queued immediately at Tier 2 entry *regardless* of Wi-Fi state (`connectivity.cpp:667-681`) — they are a **parallel, independent** path, not a fallback that activates when Wi-Fi fails. Tier 1, telemetry, and config have no GSM path. When Wi-Fi is down, the SMS still go out but without server-resolved address/time and with the last-known (or placeholder) phone numbers (KI-19). This precise behaviour must be ratified or corrected by the owner (OQ-02).

**Architectural decisions to hold stable unless explicitly approved**

1. Backend-authoritative tier calculation from `devices` thresholds.
2. Persist-first, notify-second alert flow with at-least-once delivery (duplicates accepted over loss).
3. Device writes only through Edge Functions with service role; no direct client INSERT on `sensor_readings`/`alert_events`.
4. Incident state changes only via `transition_incident()`; closed ⇔ `resolved_at` set.
5. SMS composed and sent by the firmware; address/time supplied by the backend.
6. Role set and `profiles.status` approval model.
7. Supabase (Auth, Postgres, Edge, Realtime), React/Vite/Tailwind/React-Router, Leaflet+OSM, Nominatim, Telegram, Web Push, ESP32 hardware set.
8. Location truthfulness rule: never present registered/cached coordinates as live GPS.

**Hosting / deployment.** SPA: Vercel SPA rewrite (`vercel.json`). Backend: Supabase project(s) — production project exists per `testing/reports`. CI: typecheck, lint, build only. Firmware: PlatformIO (`platformio.ini`, board `esp32dev`).

---

## 5.8 Data Specification

### Tables (from migrations; **live schema unverified**)

| Table | Purpose | Key columns / constraints | Access (RLS summary) |
|---|---|---|---|
| `devices` | Registered nodes | `id` PK; `device_code` UNIQUE; `label`; `location_desc` NOT NULL (registered address text); `api_key` UNIQUE (default `'sk_'||hex(24 bytes)`); `co_threshold int` default 200 CHECK 0–1000; `temp_threshold float` default 60.0 CHECK 0–100; `bfp_contact`; `is_active`; `last_seen_at`; `latitude`,`longitude` (registered); `local_ip` | Admin ALL; responder/resident SELECT on non-secret columns only (`20261015000000` column grant); view `devices_safe` |
| `profiles` | User profile, extends `auth.users` (CASCADE) | `role`, `status` (default **'approved'**), `is_active`, `setup_complete`, `contact_number`, `address`, `device_id` → `devices`; `telegram_chat_id`; partial UNIQUE `(device_id) WHERE role='resident'` | Own row + approved admin all; admin insert/delete; self-update (trigger-protected columns) |
| `sensor_readings` | Telemetry | `device_id`, `co_ppm`, `temp_celsius`, `latitude`, `longitude`, `gps_valid`, `on_battery`, `sensor_ready`, `recorded_at`; index `(device_id, recorded_at DESC)` | SELECT by role/own device; INSERT service-role only |
| `alert_events` | Incident record | `alert_tier` ∈ {1,2}; readings; coords; `address_resolved`; `telegram_sent`, `sms_sent_owner`, `sms_sent_bfp`; `triggered_at`; `resolved_at`; `incident_status`, `acknowledged_by/at`, `outcome_notes`; [R] `resolved_by`, `resolution_source`; [R] unique open-per-device index | Admin ALL; responder SELECT + column UPDATE; resident SELECT own device; INSERT service-role only |
| `alert_notifications` [R] | Delivery ledger | UNIQUE `(alert_event_id, tier, channel, recipient_key)`; `status`, `attempts`, `retryable`, `provider_status/ref`, `error` | service role only |
| `address_discrepancies` | GPS-vs-registered drift prompts | `device_id`, `resident_id`, `gps_derived_address`, `registered_address`, lat/lng, `status` ∈ pending/approved/rejected | Admin ALL; resident SELECT own; update only via RPC |
| `registration_requests` | Review metadata for sign-ups | `user_id` → `profiles` (CASCADE), `requested_role`, `device_code` (free text), `organization`, `position`, `verification_info`, review fields; [0.2] `reviewed_by` → `auth.users` (convention break, see KI-29) | Admin ALL; user reads/creates own |
| `support_requests` [0.2] | In-app support/contact requests (replaced Resend e-mail, #107) | `user_id` → `profiles` (CASCADE); `category`, `message` (no CHECK/length limit — KI-08); `status` ∈ open/resolved; `reviewed_by` → `auth.users` (convention break, see KI-29) | Admin ALL (`get_auth_role()='admin'`); user insert/select own — but function inserts via service-role, bypassing these checks entirely (KI-08) |
| `push_subscriptions` | Web Push endpoints | `user_id`, `endpoint` UNIQUE, `p256dh`, `auth` | Owner CRUD; service reads |
| `telegram_link_tokens` | One-time link tokens (15 min) | `token` PK, `user_id`, `expires_at` | No client grants; RPC + webhook only |
| `login_attempts` | Lockout evidence | `email`, `success`, `attempted_at`, `ip_address` (never populated by `login`) | Admin read; no client insert |
| `login_lockout_overrides` | Admin unlocks | `email` PK, `unlocked_at/by` | Admin only |
| `settings` | Key/value (session timeouts) | `key` PK | Admin ALL; approved users SELECT |
| `station_settings` | Singleton station info | `id=1` CHECK; **migration columns:** `team_name, commander_name, contact_number, address, latitude, longitude, alert_radius_km`; **UI uses:** `station_name, address, contact_number, email` | Admin ALL, **responder ALL**, resident SELECT |

### Functions / triggers / views
`get_auth_role()`, `is_approved_admin()`, `get_dashboard_stats()` (SECURITY DEFINER, unused by pages found; EXECUTE open to PUBLIC — Confirmed, KI-25 [0.2]), `protect_profile_fields` (trigger), `handle_new_user` (no-op), `generate_device_api_key`/`set_device_api_key` (legacy base64 key path, superseded by column default), `regenerate_device_api_key`, `get_device_api_key_secure`, `check_login_lockout`, `admin_unlock_login`, `update_own_device_alert_settings`, `resolve_address_discrepancy`, `create_telegram_link_token`, `claim_/complete_notification` [R], `raise_alert` [R], `alert_events_lifecycle_guard` [R], `transition_incident` [R]; view `devices_safe` (security_invoker).

> **Note — `get_dashboard_stats()`** counts all devices/alerts/profiles with `SECURITY DEFINER`, no internal caller check and no `SET search_path` (init.sql:198-218). **[0.2 — resolved, now Confirmed]** Postgres grants `EXECUTE` to `PUBLIC` by default on newly created functions, and no migration in the full history (re-read in the 0.2 update) revokes it or adds a caller-role check — so this is executable by any authenticated (and possibly `anon`) caller today, bypassing every RLS policy that otherwise hides these counts from non-admin roles. See KI-25. No frontend call was found.

### Location and address data — kept distinct

| Datum | Where stored | Source | Meaning | Precedence (as implemented) |
|---|---|---|---|---|
| Raw live/cached device coordinates | `sensor_readings.latitude/longitude(+gps_valid)`, `alert_events.latitude/longitude` | Device GPS; `gps_valid=false` ⇒ cached last fix | Observed device position | UI "live" requires `gps_valid` and age ≤ 15 min |
| Registered install coordinates | `devices.latitude/longitude` | Admin entry, or overwritten by resident-approved drift prompt | Reference position for drift detection and "registered" markers | Never labelled live |
| Registered address text | `devices.location_desc` | Admin entry / drift approval | Human-readable installation address | Fallback text in Telegram/UI |
| Reverse-geocoded address (alert) | `alert_events.address_resolved` | Nominatim from the alert's coordinates | Address at time of alert | Used in Telegram/SMS/push when present, else `location_desc` |
| Reverse-geocoded address (drift) | `address_discrepancies.gps_derived_address` | Nominatim from drifted coordinates | Candidate new address | Copied onto the device only on resident approval |
| Resident profile address | `profiles.address` | User-entered at registration | Residence address | Independent; never reconciled with device address |

### Authoritative vs derived
Authoritative: `devices` thresholds/ownership, `alert_events` lifecycle columns, `profiles.status/role`. Derived/display: `devices.local_ip` (see KI-05), connectivity labels (from `last_seen_at`), location kind, all dashboard counts, "uptime"/"connectivity %" (fabricated).

### Lifecycle and retention
Not specified (FR-ALERT-006). `registration_requests`/`profiles` removed by auth-user delete (CASCADE). `alert_events.acknowledged_by` has no `ON DELETE` action, so deleting a responder who acknowledged an incident is blocked (noted in repo docs).

---

## 5.9 Business Rules and System Logic

| Rule | Behaviour as implemented | Source of truth / location |
|---|---|---|
| BR-01 Role assignment | Registration requests a role; admin approval flips `status`; role is set at profile insert and cannot be changed by the user | `register`, `manage-registration`, trigger |
| BR-02 Device registration & ownership | Admin creates devices; one resident per device (partial unique index); resident self-links with a device code or admin assigns; unassign by admin | `link-device`, `assign-device`, `20260917040000` |
| BR-03 Sensor thresholds | Stored per device (CO ppm, temp °C); admin and the owning resident may edit within 0–1000 / 0–100; device refreshes every ≤ 10 min | `devices`, RPC, `get-device-config` |
| BR-04 Tier classification | Tier 2: CO ≥ T_co **and** temp ≥ T_temp; Tier 1: exactly one; evaluated on device (debounced) and again on server (authoritative) | `connectivity.cpp:126-134`; `trigger-alert:325-339` |
| BR-05 Debounce / duplicates | Device: 3 consecutive readings; 2 consecutive safe to clear; SMS pair at most once per 5 min (volatile timer); server: one open incident per device [R], ledger de-duplication [R] | `config.example.h`; `20261020000*` |
| BR-06 Incident status transitions | active→acknowledged (responder, admin); acknowledged→responding / resolved / false_alarm (responder, admin); responding→resolved / false_alarm (responder, admin); admin may also close from `active`; closed = terminal; repeat = no-op | `transition_incident()` [R] |
| BR-07 Auto-resolution | Telemetry with `sensor_ready` and both readings strictly below thresholds closes all open incidents of the device | `ingest-reading:180-196` (policy pending, D6.1) |
| BR-08 Location staleness | UI: live ≤ 15 min and `gps_valid`; else last-known; device GPS fix valid ≤ 5 s old | `lib/location.ts`, `gps.cpp` |
| BR-09 Notification recipients | Telegram: shared station chat. Push: approved+active admins & responders (T1,T2) + the device's resident (T2). SMS: owner = approved+active resident linked to the device (`profiles.contact_number`), BFP = `devices.bfp_contact`; Tier 2 only | `trigger-alert:204-213,359-377`; `get-device-config:57-65` |
| BR-10 Communication fallback | Alert POST: retry/backoff [R]; SMS is parallel, not conditional (§5.7) | |
| BR-11 Error handling | Backend DB faults → 500 retryable (`trigger-alert`); other functions return 400/401 for many fault types (KI-12) | |
| BR-12 Administrative operations | Approve/reject/delete users; create pre-approved users; assign device; regenerate API key; unlock login; edit settings | Edge/RPC |
| BR-13 Responder handling | Via `transition_incident` only (UI); direct column UPDATE still granted in production until Step 6c (`20261022000000`) is deployed | |
| BR-14 Resident operations | Link device, edit thresholds, resolve drift prompt, edit own contact, push/Telegram preferences | |

**Intended vs implemented where they differ** — documented in the Known Issues (§5.15): DB `approved` default for profiles vs "pending" workflow (only enforced because `register` always sets `pending`); tier computed by two parties with potentially different thresholds; auto-resolve closing responder-owned incidents; per-user Telegram promised in UI copy but not delivered.

---

## 5.10 Notification and Communication Specification

Terminology: **generated** (message composed) → **provider-accepted** (HTTP 2xx / `+CMGS`) → **delivered** (reached device/handset) → **acknowledged** (human acted). The system records at most *provider-accepted*; nothing records *delivered* or *acknowledged* for any channel except `incident_status='acknowledged'` (a responder action, not a recipient receipt).

### Telegram (station chat)
| Aspect | Detail |
|---|---|
| Trigger | Every `trigger-alert` request that passes validation; one message per `(incident, tier)` once the ledger is deployed |
| Recipients | One chat id from `TELEGRAM_CHAT_ID`; same chat for all devices |
| Mechanism | Bot API `sendMessage`, plain text, 3.5 s timeout |
| Config | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (absent ⇒ silently skipped) |
| Success/failure | 2xx ⇒ `telegram_sent=true` and ledger `sent`; 4xx (except 429) non-retryable; 429/5xx/timeout retryable |
| Retry | Only when a *later* alert request for the same incident arrives (≤ 3 attempts); no background retry [R] |
| Audit | `alert_notifications` [R]; `alert_events.telegram_sent` |
| Evidence level | Code only; **no delivery demonstrated** |

### Web Push
| Aspect | Detail |
|---|---|
| Trigger | As above, via `send-push-notification` (service-role caller) |
| Recipients | Approved+active admins/responders; resident (T2) — eligibility re-checked inside the sender |
| Mechanism | `web-push` with VAPID, 3 s timeout, `topic` for partial dedupe; expired endpoints reported, never deleted |
| Config | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (function module throws at load if unset: `setVapidDetails` runs at import — behaviour with unset keys Unverified); client `VITE_VAPID_PUBLIC_KEY` (a fallback public key is hard-coded in `pushNotifications.ts:38`) |
| Audit | Ledger [R]; per-recipient result array |
| Limitations | Requires user opt-in; icon `/icon-192x192.png` referenced by `sw.js` is not in `public/` (KI-20); click handler opens `/` |

### SMS (SIM800L, firmware-originated)
| Aspect | Detail |
|---|---|
| Trigger | Entering Tier 2 (CLEAR→T2 or T1→T2) and ≥ 5 min since the last SMS pair (`lastSmsSent_ms`, volatile) |
| Recipients | Owner (`profiles.contact_number` of linked approved+active resident) and BFP (`devices.bfp_contact`); numbers come from `trigger-alert` response (freshest), else `get-device-config`, else compile-time placeholders |
| Mechanism | `AT+CMGS` text mode; body ≤ 220 bytes; queue of 2 (owner+BFP); one send per GSM task tick (5 s); 15 s modem wait |
| Success | `+CMGS` in response ⇒ `success=true`; reported by `confirm-sms-status` |
| Retry | **None** for the SMS itself; failed SMS is not re-sent. Result *reports* are retried (5…60 s, 8 attempts) [R] |
| Audit | `alert_events.sms_sent_owner/_bfp` |
| Limitations | Duplicates possible after reboot (D5.7); empty/placeholder numbers fail (KI-19); coordinates may be 0,0 (KI-18); hardware **Cannot Verify** |

### Support request inbox (in-app) [0.2 — replaced Resend e-mail, #107]
Triggered by the `AdminSupportModal`; `admin-support-request` inserts into `support_requests` via service-role (no e-mail, no `RESEND_API_KEY`). Caller only needs a valid session — `profiles.status`/`is_active`/`role` are not checked, so unapproved accounts can file a request; `category` is checked for truthiness only, not validated against the UI's category list or length-limited (KI-08).

### In-app Realtime
`postgres_changes` channels on `devices`, `alert_events`, `profiles`, `sensor_readings`; unfiltered subscriptions; availability depends on Supabase Realtime (WebSocket) — not testable in the reviewers' sandbox per `LIVE_TESTING_SUMMARY.md`.

**Not required merely because useful:** e-mail alerts, per-user Telegram, WhatsApp, voice calls — none is in the baseline.

---

## 5.11 User Interface and Module Inventory

| Role | Page (route) / component | Purpose | Data sources | Actions | Auth (UI / backend) | Status | Known gaps |
|---|---|---|---|---|---|---|---|
| Public | `Login` (`/login`) | Sign in via `login` function | `functions/login` | Sign in, lockout countdown | none | Verified | |
| Public | `RegisterResident`, `RegisterResponder` | Register | `functions/register` | Submit | none | Verified | Field-level validation anti-pattern (owner's own report) |
| Public | `PendingApproval`, `SessionExpired`, `ForgotPassword`, `ResetPassword`, `NotFound` | Account/session screens | Supabase Auth | | none | Verified/Partial | |
| Admin | `Dashboard` | Fleet overview | `devices`, `alert_events`, `profiles`, `sensor_readings` | View | AuthGuard(admin) / RLS admin | Partial | |
| Admin | `InteractiveMap` | Map + alert feed | `devices`, `sensor_readings`, `alert_events` | View | same | Partial | no sidebar entry |
| Admin | `Devices` ("Devices") | CRUD devices, keys | `devices`; RPC | Create, edit, toggle, regenerate key | same | Verified | |
| Admin | `Users` | Approvals, create, assign | `profiles`, `registration_requests`, `devices`; Edge | Approve/reject/delete/create/assign | same | Verified | No UI to set `is_active` found |
| Admin | `DeviceStatus` ("Device Status") | Fleet + incident close | `devices`, `alert_events`, `sensor_readings` | Resolve | same | Verified | |
| Admin | `Logs` ("System Log") | Event/log view + export | `alert_events`, `login_attempts`, `devices` | Filter, export | same | Partial | KI-04 |
| Admin | `Settings` (`/admin/settings/security`) | Timeouts, unlock, push | `settings`; RPC | Save, unlock | same | Verified | |
| Responder | `ResponderDashboard` | Live incidents/devices | `devices_safe`, `alert_events` | Acknowledge/responding/resolve/false alarm | AuthGuard(bfp) / RLS + RPC | Partial | KI-02, KI-03 |
| Responder | `ResponderAlertLogs` | History | `alert_events`, `devices_safe` | Filter, export | same | Partial | |
| Responder | `ResponderSettings` | Profile, station info, Telegram | `profiles`, `station_settings`; RPC | Save | same | Conflicting | KI-07 |
| Resident | `ResidentSetup` | First-run contact number | `profiles` | Save | AuthGuard(resident) | Verified | |
| Resident | `ResidentHome` | Own device dashboard + link + drift prompt | `devices_safe`, `sensor_readings`, `alert_events`, `address_discrepancies`; Edge/RPC | Link device, refresh, approve/reject drift | same / RLS | Partial | KI-01, KI-03 |
| Resident | `ResidentAlertSettings` | Thresholds, contact, push, Telegram | `devices_safe`, RPC, `profiles` | Save | same | Verified | KI-24 |
| Resident | `ResidentDeviceInfo`, `ResidentAlerts` | Device info, alert history | `devices_safe`, `sensor_readings`, `alert_events` | Refresh | same | Verified | `ResidentAlerts.tsx` is routed at `/home/alerts` ("Alert History"); it replaced the resident System Log |
| Resident | `ResidentAccount` | Name/contact | `profiles`, `devices_safe` | Save | same | Partial | |
| Shared | `AdminLayout`/`ResponderLayout`/`ResidentLayout`, `HeaderWidgets` (search, bell, user menu), `AdminSupportModal`, `LoadErrorBanner`, `GlobalErrorBoundary`, `LocationBadge` | Shell and helpers | | | | | |

The existing information architecture (routes above) is preserved; no new page is introduced by this document.

---

## 5.12 External Integrations and Dependencies

| Service | Purpose | Data exchanged | Configuration | Failure mode / dependency |
|---|---|---|---|---|
| Supabase (Postgres, Auth/GoTrue, Realtime, Edge) | Core backend | everything | project URL, anon key, service-role key (function secret) | Total outage ⇒ no ingestion/alerts/UI; SMS path still works on device but without backend data |
| OpenStreetMap Nominatim | Reverse geocoding | lat/lon, custom User-Agent | none (public API) | Rate limits/timeouts ⇒ address null; falls back to registered address text; 24 h per-isolate cache |
| OSM tile servers via Leaflet | Map tiles | tile requests from browsers | none | Tile blocking ⇒ blank map |
| Telegram Bot API | Station alerts, account linking | message text, chat ids | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET` (webhook registered with `secret_token`) | 403/blocked bot ⇒ non-retryable |
| Web Push services (browser vendors) | Push | encrypted payloads | VAPID keys | Expired endpoints reported only |
| *(removed, #107)* ~~Resend~~ | Support requests now stored in `support_requests` (in-app admin inbox), no external service involved [0.2] | user id, role, contact info, message | none (no `RESEND_API_KEY` needed) | DB insert failure ⇒ 500 |
| Cellular network / SIM800L | SMS | SMS bodies with coordinates | SIM with credit, coverage | Coverage, credit, antenna, 2G availability ⇒ silent failure (reported as `false`) |
| Google Maps (links only) | Navigation URLs in messages | coordinates in URL | none | None (links only) |
| Vercel | SPA hosting | | `vercel.json` | Unverified |
| Leaflet, lucide-react, Playwright (listed as runtime dependency) | Libraries | | `package.json` | `playwright` is in `dependencies` (not devDependencies) — unusual (Observation) |

Internet-dependent behaviours: all device→backend traffic, geocoding, Telegram, Push, tiles. Physical-hardware-dependent: sensing, GPS lock (needs sky view), SMS.

No credentials or phone numbers are reproduced in this document.

---

## 5.13 Error Handling and Operational Constraints

| Situation | Verified behaviour | Not implemented / desired (unapproved) |
|---|---|---|
| Invalid/missing CO or temp | DS18B20 invalid ⇒ last valid retained (FR-IOT-002); CO <=0 ADC ⇒ 0 ppm; backend rejects non-finite numbers (400) | Staleness/fault flag; reporting sensor fault to backend |
| GPS unavailable / stale | Cached fix sent with `gps_valid=false`; (0,0) stored as NULL; UI labels last-known; SMS still sent with whatever coordinates exist (KI-18) | Suppress/annotate SMS link when no fix |
| Wi-Fi disconnected | Device state OFFLINE; reconnect every 60 s; portal after 30 s; alert POST deferred and retried when ONLINE [R]; Tier 2 SMS still sent | Cellular-data fallback for the POST (OQ-02) |
| GSM transmission fails | Result `false` reported; no re-send; SMS-modem init failure only logged | SMS retry |
| Supabase / network unavailable | `trigger-alert` returns retryable 500s on DB faults (deployed only after 5.2); firmware retries [R]; UI shows `LoadErrorBanner` on failed admin reads | Offline buffering of telemetry (none: telemetry skipped when not ONLINE) |
| Notification provider failure | Recorded as failed in ledger [R]; incident already persisted; retry on a later request only | Background retry worker |
| Auth expires | Supabase session refresh; idle timeout sign-out; RLS re-evaluated each request | |
| Database access denied | Specific messages in incident UI; other pages show generic errors (some silent, e.g. `fetchStationSettings` swallows errors) | |
| Reverse geocode fails | `null`; message uses registered address or "Unknown Location" | |
| Device unregistered/offline/inactive | `401 Unauthorized or inactive device`; admin pages label offline from `last_seen_at` | Firmware treats 4xx as permanent after 3 tries [R] |

The system does **not** claim fail-safe emergency operation. No field test, soak test or hardware test evidence exists in the repository.

---

## 5.14 Acceptance Criteria and Verification Matrix

The full matrix is in [`requirements-traceability.md`](requirements-traceability.md). Summary of evidence available:

| Evidence type | Where | Executed in this review |
|---|---|---|
| Node tests (`tests/*.test.ts`, `tests/edge/*.test.mjs`) | `npm test` (`node --test`) | **No** (dependencies not installed; installation prohibited) |
| Local PostgreSQL suites | `supabase/tests/local/*` | **No** |
| Firmware host tests | `firmware/.../host_tests/run.sh` | **No** |
| Live production checks (RBAC, auth, DB) | `testing/reports/LIVE_*` | **No** (self-reported) |
| Hardware / field tests | none | **Cannot Verify in Current Environment** |

Every requirement is therefore **Not Tested** in this review; the traceability matrix distinguishes "reported by repository authors" from "no evidence".

---

## 5.15 Known Issues and Specification Gaps

### Confirmed implementation defects (static evidence)

| ID | Defect | Impact | Evidence | Scope relation | Action |
|---|---|---|---|---|---|
| KI-01 | Resident "System Uptime" displays constant `99.98%` when online | Misleading metric on a safety system | `ResidentHome.tsx:268` | Existing feature, defective | Correct (or remove claim) — owner decide |
| KI-02 | Responder "connectivity %" is a constant per state (98/92/100/0) | Misleading | `ResponderDashboard.tsx` (`connectivity` in `fetchData`) | Same | Correct |
| KI-03 | Three different "online" definitions (2/15 min helper vs flat 5 min on resident & responder pages) | Inconsistent status across roles | `deviceStatus.ts:11-12`; `ResidentHome.tsx:168,254`; `ResponderDashboard.tsx` | Violates cited `SW-2.4.3` | Correct |
| KI-04 | Admin log writes the same text ("Thermal threshold exceeded … or smoke detected") for every alert; sensors are CO/temperature, not smoke | Inaccurate log | `Logs.tsx` (alert mapping ≈ line 84) | Existing | Correct text |
| KI-05 | `devices.local_ip` is filled from `x-forwarded-for`/`x-real-ip` of the request, i.e. the client's *public/forwarded* address, not a LAN address; UI labels it "Device local IP"; firmware does not send `local_ip` | Mislabelled data | `ingest-reading/index.ts:177`; `Devices.tsx:364` | Existing | Clarify intent |
| KI-06 | Threshold defaults disagree: DB temp 60 °C (`init.sql:18`), admin form default 65 (`Devices.tsx`), firmware fallback 70 (`TEMP_ALERT_PPM_DEFAULT`, misnamed "PPM") ; CO 200 everywhere | Wrong behaviour if first config fetch fails or device created via form | files cited | Existing | Owner to define canonical default |
| KI-07 | `station_settings`: UI and TS type use `station_name`, `email`, `key_personnel`; migrations define `team_name`, `commander_name`, `alert_radius_km`… | Station editor fails on a DB built from the repo; live schema unknown | `ResponderSettings.tsx:49-135`; `lib/supabase.ts:105-116`; `init.sql:90-100` | Conflicting | Owner: which is intended (OQ-04) |
| KI-08 | **[0.2 — rewritten]** `admin-support-request` (post-#107 in-app inbox, not the old Resend path) inserts into `support_requests` using the service-role client, so the table's RLS is bypassed by construction. The function itself checks only that the caller has a valid session — not `profiles.status='approved'`/`is_active`/role — so any authenticated account, including pending/unapproved ones, can file a request; `category` is checked for truthiness only, not restricted to the UI's fixed list, and neither `category` nor `message` has a length limit; `full_name` is still selected from `profiles` but never used (dead code left over from the deleted Resend template) | Unapproved accounts can reach the admin inbox; unbounded/arbitrary `category` values can be stored and later rendered in the admin UI; minor storage-abuse vector | `admin-support-request/index.ts:30-37,44-48`; `20261022000001_support_requests.sql` (no CHECK on `category`, no length constraint) | New gaps in the #107 replacement; old Resend-specific defect (missing `profiles.email` column) no longer applies | Confirm unapproved-account access is intended; add `category` validation + length limits if not; drop the unused `full_name` select |
| KI-09 | Repo `get_auth_role()` ignores `profiles.status`; every `get_auth_role()`-based policy (devices, sensor_readings, alert_events, settings, station_settings…) therefore admits **pending/rejected** accounts holding a role. Contradicted by older migration comments and by a live RBAC test that observed immediate revocation | If live = repo: a self-registered responder (pending) could read all incidents/devices, edit `station_settings` and update incident columns before approval | `init.sql:192-195`; `20261019000000` header; `LIVE_RBAC_VERIFICATION.md` row 38; `CHANGELOG §12` ("none yet") | Security — **Conflicting** | **Owner clarification + live inspection first** (OQ-03); no redesign authorised |
| KI-10 | `protect_profile_fields` protects only `role,status,device_id` | A user can alter own `is_active`, `setup_complete`, `telegram_chat_id` via PostgREST; no UI to deactivate users was found, so practical risk depends on operations | `init.sql:236-261`; `Users.tsx` (no `is_active`) | Existing | Clarify intent for `is_active` |
| KI-11 | Responder role has `FOR ALL` on `station_settings` and (in production, until Step 6c is deployed) direct column UPDATE on `alert_events` | Wider than the UI exposes | `init.sql:341-342`; `20261012000001`; revoke migration `20261022000000` | Fixed in code (#97), not yet deployed | Deploy after 6.1/6.2 |
| KI-12 | Error-code hygiene: `ingest-reading` and `confirm-sms-status` map DB faults to 401/400; firmware treats 4xx as permanent for `confirm-sms-status` ⇒ dropped report | Lost delivery reports on transient faults | `ingest-reading:272-277`; `confirm-sms-status:137-143`; CHANGELOG §9 | Known/accepted risk | Owner decision |
| KI-13 | Auto-resolve closes acknowledged/responding incidents without a responder | Responder work may vanish from the live feed | `ingest-reading:180-196` | Pending D6.1 | Owner decision |
| KI-14 | Dead code: `<= 100` geocode shortcut inside a `> 100` branch | None functionally | `ingest-reading:239` | Existing | Optional |
| KI-17 | Firmware never uses `last_co_ms`/`last_temp_ms`; a failed temperature probe keeps the last valid value forever; CO is held across the heating phase | Fault can silently suppress or fabricate a reading | `sensors.cpp:96,151`; no reader | Detection logic — change needs review (rule 8) | Owner decision |
| KI-18 | SMS bodies use `fix.lat/lng` even when no fix was ever acquired (0,0) and when `gps_valid=false` | Misleading map link in emergency SMS | `connectivity.cpp:670-675`; `gsm.cpp:150-163` | Existing | Owner decision |
| KI-19 | Unlinked/unapproved resident ⇒ `owner_number` is `""`; `fetchRemoteConfig` default operator keeps a present-but-empty string ⇒ SMS to empty number fails; compile-time placeholder numbers apply if the first fetch never succeeds | Owner SMS silently fails in those cases | `get-device-config:67-78`; `connectivity.cpp:362-368` | Partially verified (ArduinoJson semantics assumed) | Hardware test |
| KI-20 | `sw.js` icon `/icon-192x192.png` is not in `public/` | Missing push icon | `public/` listing | Cosmetic | Optional |
| KI-24 | Telegram account linking stores `telegram_chat_id`; no sender uses it; webhook says "You will receive fire alerts here" | User expectation not met | grep: only `telegram-webhook:76-79` writes it | Incomplete (#95) | Owner D5.4/D5.5 |
| KI-25 [0.2] | `get_dashboard_stats()` is `SECURITY DEFINER` with no `SET search_path` and no internal caller check; Postgres grants `EXECUTE` to `PUBLIC` by default on new functions and no migration (full 35-file history re-read) revokes it. Corroborating pattern: from `20261017000000` onward, every other sensitive function the team wrote gets an explicit `REVOKE ALL ... FROM PUBLIC/anon/authenticated` in the same migration (`create_telegram_link_token`, `resolve_address_discrepancy`, `is_approved_admin`, `claim_/complete_notification`, `raise_alert`, `transition_incident`) — `get_dashboard_stats()` is among the `SECURITY DEFINER` functions that never received this treatment (also true of `protect_profile_fields()` and the dead-code `handle_new_user()`, all three from the same original `init.sql`, and of `get_device_api_key_secure()` — KI-27, a later and more unusual case), consistent with being a pre-convention oversight rather than an intentionally public RPC | Any authenticated (possibly `anon`) caller can execute it directly (e.g. PostgREST `rpc/get_dashboard_stats`) and get system-wide device/alert/user counts, bypassing every RLS policy hiding these from non-admin roles | `20260717000000_init.sql:197-218`; no later `REVOKE EXECUTE`/role check found; no frontend caller found | Resolves the prior "Unverified" note in §5.8 — Confirmed static defect (subject to the standing live-vs-repo caveat in §5.1 limitation 2) | Security — add `REVOKE EXECUTE ... FROM PUBLIC` + explicit admin-only grant, or an internal role check |
| KI-26 [0.2] | `check_login_lockout()` keys the failure counter on `email` with a case-sensitive comparison; `login/index.ts` never lower-cases `email` before calling it or writing `login_attempts`; Supabase Auth (GoTrue) authenticates e-mail case-insensitively | An attacker can defeat the app-level lockout tiers by varying case per attempt (`victim@x.com`, `Victim@x.com`, `VICTIM@X.com`…) — each is counted as a fresh, unlocked identity while GoTrue treats them as the same account | `login/index.ts:67-112`; `check_login_lockout()` (migration `20260924090000`) | New — security | Lower-case the e-mail before every lockout read/write and RPC call |
| KI-27 [0.2] | `get_device_api_key_secure()` is `SECURITY DEFINER` without `SET search_path`. Unlike the pre-convention gaps in `init.sql` (KI-25), this function was created on `20261015000000` — chronologically *after* the hardening convention began (first seen `20260917060000`, made explicit/systematic from `20260924020000`) — making it the only `SECURITY DEFINER` function created after the convention started that doesn't follow it | Low current exploitability (`authenticated`/`anon` lack `CREATE` on the database by default; the function also has its own internal `v_role = 'admin'` check, unlike `get_dashboard_stats()`), but breaks the project's own hardening convention and is the exact class of bug `20260924020000` exists to close | `20261015000000_fix_devices_safe_security_invoker.sql:6-22` | New — hardening consistency | Add `SET search_path = public, pg_temp` to match the convention |
| KI-28 [0.2] | `manage-registration`'s `approve` action writes `profiles.device_id` with no check that the device isn't already claimed by another resident, unlike `assign-device`/`link-device`, which both guard this | If two profiles end up sharing a `device_id`, `trigger-alert`'s Tier-2 SMS lookup uses `.maybeSingle()`, which errors on multiple matches; the error is swallowed and `owner_contact` resolves to `''` — **the resident's SMS fire alert silently never sends** | `manage-registration/index.ts:67-77`; `trigger-alert/index.ts:359-369` | New — safety-critical (alert delivery) | Add the same pre-write uniqueness check used in `assign-device`/`link-device` to the approve path |
| KI-29 [0.2] | `support_requests.reviewed_by`, `registration_requests.reviewed_by` and `login_lockout_overrides.unlocked_by` reference `auth.users(id)` directly, while every other actor-tracking column in the schema (`acknowledged_by`, `resolved_by`, `user_id`, `resident_id`…) references `public.profiles(id)` | Not a functional bug (1:1 PK), but breaks a PostgREST embed like `profiles!reviewed_by(full_name)` — the same pattern already used for the analogous `user_id` column — if ever attempted on these columns | `20260717000000_init.sql:116`; `20260924010000_admin_login_unlock.sql:20`; `20261022000000_support_requests.sql:14` | New — schema convention | Optional: point new actor-tracking FKs at `profiles(id)` going forward |

### Incomplete requirements (tracked by the repository)
Step 5.4 (per-user Telegram, #95) · Step 6.3 (auto-resolve/device-clear/admin reopen, #96) · keep-alive re-assert (D5.2) · UTC label on message times (D5.6) · backfill of legacy incidents (D6.3).
Step 6c (revoke direct `UPDATE` on `alert_events`, #97) is implemented in code (`20261022000000`) but not yet deployed.

### Conflicting implementations
KI-03, KI-06, KI-07, KI-09; `FEATURES.md` vs code (§5.1); `devices_safe` has been redefined seven times after `init.sql` (`20260917020000`, `…070000`, `20260924060000`, `20261011…`, `20261013…`, `20261014…`, final `20261015…`) — final definition governs (Verified), earlier ones are superseded.

### Missing or unclear requirements
Retention (FR-ALERT-006); password/session policy; SLA/availability/performance targets; whether GSM data fallback is required (OQ-02); who must receive Tier 1 (currently admins only, plus the station Telegram chat; responders and residents get nothing on Tier 1); coverage/area scoping of responders; privacy basis for location data.

### Unverified integrations
Telegram, Web Push, SMS/SIM800L, Nominatim, Realtime, OSM tiles, Vercel (§5.12). *(Resend removed from this list in 0.2 — the integration was removed from the codebase by #107, not merely unverified.)*

### Unresolved architectural decisions
D5.2, D5.4, D5.5, D5.6, D5.7, D6.1, D6.3, D6.4, D6.5 (the last is referenced in `CHANGELOG §11` but not defined in any inspected document).

Other observations (not defects): `get_device_api_key_secure` is `SECURITY DEFINER` without a pinned `search_path`; `get_dashboard_stats()` unauthenticated-in-body `SECURITY DEFINER`; CORS `*`; `playwright` under `dependencies`; CI doesn't run tests; a production device row `QA-UITEST-DEVICE` needs manual cleanup (`LIVE_TESTING_SUMMARY.md`).

---

## 5.16 Explicit Exclusions and Scope Change Rules

### Exclusions (see §5.3-E; marked ones need ratification)
No cellular-data transport (pending OQ-02) · no alternative sensors · no framework/database/host/map/geocoder/messaging/hardware-platform migration · no auto-dispatch integrations · no additional user roles · no social login/2FA · no native mobile apps · no per-user Telegram until D5.4/D5.5 approved.

### Change-control rules
1. Existing behaviour must not be redesigned only because an alternative is cleaner or more modern.
2. Bug fixes preserve approved functionality and architecture wherever possible.
3. A defect in an existing feature does not authorise unrelated redesign.
4. New functionality needs a documented requirement and explicit approval.
5. Schema changes need justification, impact assessment and a migration plan.
6. Changes to authentication, RLS, roles, device ownership or notification recipients require security and regression review.
7. New integrations require justification, configuration requirements, failure handling and approval.
8. Changes to hardware, thresholds, communication paths or detection logic require explicit review (physical-prototype risk).
9. Existing APIs, data contracts, route structures and component responsibilities are not changed unnecessarily (firmware parses `alert_event_id`, `owner_contact`, `bfp_contact`, `address_resolved`, `triggered_at`, `co_alert_ppm`, `temp_alert_c`, `owner_number`, `bfp_number`).
10. Unresolved questions are recorded (Decision Register), not answered by assumption.

Template: [`change-request-template.md`](change-request-template.md).

---

## 5.17 Glossary and Terminology

| Term | Meaning in this document |
|---|---|
| Device / node | One ESP32 unit registered in `devices` |
| Sensor reading | One `sensor_readings` row (CO ppm, temp °C, location, flags) |
| Alert / incident | `alert_events` row; one open incident per device (target state [R]); "alert" in firmware = FSM tier entry |
| Tier 1 / Tier 2 | One sensor over threshold / both sensors over threshold |
| Responder | `bfp_responder` account (BFP personnel) — not a station-scoped identity |
| Resident | `resident` account linked to one device |
| GPS coordinates | Latitude/longitude from the NEO-6M (live) or cached |
| Registered location | Admin/resident-approved install address + coordinates on `devices` |
| Reverse geocoding | Coordinates → address text via Nominatim |
| Communication fallback | In this codebase: SMS sent in parallel to the Wi-Fi path on Tier 2; **not** a switch-over of the data path |
| Notification delivery | Generated → provider-accepted → delivered → acknowledged (§5.10); only provider-accepted is recorded |
| System availability | Not defined (NS-RA) |
| `[R]` | Implemented in repo, not deployed |
| NS-RA | Not Specified — Requires Approval |

---

## 19. Recommendations and Future Considerations (NOT part of the baseline)

> None of these are requirements. Each needs owner approval before any work. They are ordered by safety impact, not by effort.

| # | Current limitation | Evidence | Proposed change | Why it may help | Scope impact | Risks / dependencies | Owner approval |
|---|---|---|---|---|---|---|---|
| R1 | Backend approval enforcement unclear (KI-09) | §5.15 | First **inspect** the live `get_auth_role()`/policies read-only (runbook Phase 0); only then decide whether any change is needed | Removes the largest security uncertainty | None until inspected | Any change touches RLS ⇒ rule 6 review | Yes |
| R2 | Fabricated metrics (KI-01/02) | cited | Replace constants with derived values or remove the widgets | Honest dashboards | Bug fix within existing pages | Low | Yes (which metric?) |
| R3 | Stale-sensor blindness (KI-17) | `sensors.cpp` | Use existing timestamps to flag stale temperature/CO | Prevents masked Tier 2 | Detection logic ⇒ rule 8 | Physical retest | Yes |
| R4 | SMS with 0,0 coordinates (KI-18) | `gsm.cpp` | Omit/annotate link when no fix | Avoids misleading responders | Firmware message text | Hardware retest | Yes |
| R5 | One definition of "online" (KI-03) | `deviceStatus.ts` | Use existing helper on resident/responder pages | Consistency with cited SW-2.4.3 | Bug fix | Low | Yes |
| R6 | Tests not in CI | `ci.yml` | Run existing `npm test` in CI | Regression safety | CI config only | Needs deps/PG for some suites | Yes |
| R7 | No retention policy | FR-ALERT-006 | Decide retention for `sensor_readings` | Cost/privacy | New requirement + possible schema work | Data-protection input | Yes |
| R8 | Stale docs | §5.1 | Mark `AGAPSENSE_SYSTEM_SPECIFICATION.md`/`FEATURES.md` superseded | Prevent drift | Docs only | None | Yes |
| R9 | Documentation of requirement IDs `SW-x/HW-x` | comments | Supply the original specification for import into this baseline | Converts "unconfirmed" to "approved" | Docs only | None | Owner supplies |

---

## Appendix A — Evidence index (principal files)

`supabase/functions/trigger-alert/index.ts`, `ingest-reading/index.ts`, `get-device-config/index.ts`, `confirm-sms-status/index.ts`, `link-device`, `assign-device`, `register`, `manage-registration`, `create-user`, `login`, `register-push`, `send-push-notification`, `telegram-webhook`, `admin-support-request` · `supabase/migrations/*` (esp. `20260717000000_init.sql`, `20261015…`, `20261019…`, `20261020…`, `20261021…`) · `firmware/agapsense-firmware/src/{main,sensors,connectivity,gsm,gps}.cpp/.h`, `config.example.h` · `src/App.tsx`, `components/AuthGuard.tsx`, `contexts/AuthContext.tsx`, `lib/{incidents,location,deviceStatus,deviceColumns,supabase,pushNotifications}.ts`, `pages/**` · `docs/*`, `testing/reports/*`.

Line numbers are those of the inspected commit; for functions inspected through concatenated output, ranges were recomputed per file and may be off by a few lines — function names are the stable reference.

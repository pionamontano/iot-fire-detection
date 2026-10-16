# AgapSense Scope Boundary Register (Deliverable B)

> **0.3 update (2026-10-16):** rows whose status changed since 0.1/0.2 have been updated; boundary decisions marked "Was …" need the owner's confirmation. Known Issue status: [`system-specification.md`](system-specification.md) §5.15.

Companion to [`system-specification.md`](system-specification.md) §5.3 (baseline v0.1, commit `5441cb78`; rows updated 2026-10-16 against `d74dc81`).

**Classification key:** **A** In Scope · **B** Implemented but Unverified · **C** Incomplete or Defective · **D** Proposed, Not Approved · **E** Out of Scope (current baseline).
**Boundary:** *Included* = may be maintained and bug-fixed under the existing design; *Excluded* = must not be added/changed without an approved change request (see [`change-request-template.md`](change-request-template.md)); *Hold* = behaviour is disputed — do not change either way until the linked decision (OQ-xx) is made.
**Deploy:** `R` repo only (not deployed), `L` reported live, `–` unknown. "Approval needed" refers to the project owner. The only approval on record is the project description in the task brief; everything else needs ratification under OQ-01.

| Capability / component | Class | Current status | Evidence | Boundary | Approval needed |
|---|---|---|---|---|---|
| CO + temperature multi-sensor detection, Tier 1/Tier 2 | A | Verified (code); accuracy Unverified; hardware untested | `connectivity.cpp:126-134`; `trigger-alert:325-339` | Included — thresholds/logic changes need rule-8 review | Ratify (OQ-01); calibration plan (OQ-10) |
| MQ-7 reading: duty-cycle build (60 s/90 s) and constant-5V build (v2.2.0, per `platformio.ini` the deployed wiring); ppm model | A | Verified (code) | `sensors.cpp` (both branches); `platformio.ini` | Included; no recalibration or sensor swap without review. Release workflow builds the wrong variant (spec KI-32) | Accuracy tolerance NS-RA |
| DS18B20 temperature reading | A | Verified (code); stale-value gap | `sensors.cpp:137-156`; KI-17 | Included; freshness logic = **Hold** | OQ-09 |
| GPS capture (NEO-6M), cached fix, `gps_valid` | A | Verified (code) | `gps.cpp` | Included | — |
| Reverse geocoding (Nominatim, tiered address) | A | Verified (code); service Unverified | `trigger-alert:20-79` | Included; provider change excluded | Provider swap needs approval |
| Wi-Fi data path (HTTPS, WiFiManager provisioning with WPA2 portal and per-node identity in NVS) | A | Verified (code); portal flow untested on hardware (OQ-26) | `connectivity.cpp`; `identity.cpp` | Included | — |
| Tier 2 SMS via SIM800L, parallel to Wi-Fi | A | Verified (code); hardware Cannot Verify | `gsm.cpp`, `connectivity.cpp:667-681` | Included as built | Confirm semantics (OQ-02) |
| GSM **data** fallback (alert POST over cellular) | D / E? | Not Implemented | no code | **Hold** — excluded until owner rules | OQ-02 |
| Telegram station-chat notification (Tier 2 only) | B | Verified (code); delivery Unverified | `trigger-alert` | Included | Evidence of delivery (test) |
| Web Push to admin/responder/resident | B | Verified (code); delivery Unverified; opt-in UI for all three roles | `send-push-notification`; `Settings.tsx`, `ResponderSettings.tsx`, `ResidentAlertSettings.tsx` | Included | — |
| Per-user Telegram alerts | B | **Implemented** (2026-10-16): linked chats get their role's alerts (`telegram_user` ledger channel); delivery Unverified | `trigger-alert`; KI-24 fixed; issue #95 | Was "Excluded until D5.4/D5.5"; implemented since — owner to ratify | OQ-23 |
| Email alerts / voice / other channels | E | Not present | — | Excluded | New requirement |
| Notification ledger + idempotent `raise_alert` | A (remediation) | Verified (code), `R`, gated | `20261020000*`, `trigger-alert` | Included — deploy only through approved order | Production deployment approval (OQ-05) |
| Incident lifecycle (`transition_incident`, guard trigger) | A (remediation) | Verified (code), `R` | `20261021000000` | Included | Deployment approval; D6.3 backfill |
| Auto-resolve on normal readings | A | Verified (code): D6.1 — two consecutive safe readings, only `active` incidents | `ingest-reading`; KI-13 fixed | Was **Hold**; implemented per D6.1 — owner to confirm closed | OQ-07 |
| Admin reopen of closed incident | D | Not implemented (blocked by design) | guard trigger | Excluded | D6.4 |
| Revoking direct `UPDATE` on `alert_events` | A (remediation) | Verified (code), `R` | `20261022000000`; issue #97 | Included — deploy only after 6.1/6.2 are live | Deployment approval |
| Registration with admin approval | A | Verified (code), `L` | `register`, `manage-registration` | Included | — |
| Backend enforcement of approval and deactivation (RLS) | A | Verified (code + local tests), `R` | `20261031000000`, `20261030000000`; KI-09 fixed. Open gap: self-reactivation (KI-10) | Was **Hold**; changed in repo — confirm on production (OQ-03) | OQ-03 |
| Roles: admin, bfp_responder, resident | A | Verified | `init.sql:29` | Included; **no new roles** | Any new role |
| Admin dashboard, live map, Device Status, devices, users (incl. edit/deactivate), system log, support requests, settings | A | Verified/Partial | spec §5.11 | Included; IA preserved | — |
| Admin interactive map | A | Partial (tiles external) | `InteractiveMap.tsx` | Included | — |
| Responder dashboard (Tier 2 only), alert logs | A | Partial | KI-02, KI-03 fixed | Included | — |
| Responder station-information editor | A | Verified (code) | `20261103000000`; KI-07 fixed. Responders hold `FOR ALL` on the table (KI-11) | Was **Hold**; schema now matches | OQ-04 |
| Resident setup, Dashboard, Alert History, Alert Settings, Device Information, Account | A | Verified/Partial | spec §5.11 | Included | — |
| Resident threshold editing (RPC) | A | Verified | `20260917080000` | Included | Bounds & default ratification (OQ-08) |
| Address-drift detection and resident approval | A | Verified (code), `L` | `ingest-reading:198-261`; `20261016000000` | Included; approval overwrites device location by design | Confirm design (no admin review) |
| Device registration, ownership, API-key auth/regeneration | A | Verified | `Devices.tsx`; migrations | Included; key storage/rotation redesign excluded | OQ-16/17 for policy |
| Login lockout, `login` function, admin unlock | A | Verified, `L` | `login`, `check_login_lockout` | Included | — |
| Direct-to-GoTrue brute-force protection (CAPTCHA/rate limit) | D | Not implemented; owner accepted risk | `LIVE_TESTING_SUMMARY.md` | Excluded | Owner decision recorded earlier |
| Idle timeout (per role) | A | Partial, `L`; **off by default** (no settings seeded, KI-30) | `useIdleTimeout.ts`; `Settings.tsx` | Included; seeding defaults = bug fix | Default values |
| Password reset by e-mail | B | Partial | `ForgotPassword.tsx` | Included | — |
| Support requests (in-app inbox, replaced Resend in #107) | A | Verified (code); open gaps (KI-08) | `admin-support-request`, `resolve-support-request`, `SupportRequests.tsx` | Included | OQ-21 |
| Location labelling: live / last-known / registered / unavailable | A (remediation) | Verified (code) | `lib/location.ts` | Included — rule: never present non-live position as live | 15 min value (OQ-18) |
| Fabricated metrics ("System Uptime 99.98%", "connectivity %") | — | **Removed** (KI-01/02 fixed) | — | — | — |
| Online/offline status definition | A | Verified: one helper everywhere (KI-03 fixed) | `lib/deviceStatus.ts` | Included | — |
| Account deactivation (`manage-user`) | A | Verified (code) | `manage-user`; `20261030000000` | Included; self-reactivation gap (KI-10) is a bug fix | Security review (rule 6) |
| OTA firmware updates and firmware releases | A | Verified (code); untested on hardware | `connectivity.cpp`; `get-device-config`; `firmware_releases`; KI-31, KI-32 | Included; image signing = proposal | Owner (MD5 / signing policy) |
| Data retention / archival | D | Not specified | FR-ALERT-006 | Excluded | OQ-12 |
| Privacy notice / consent flows | D | Not present | — | Excluded | OQ-13 |
| SLA, availability, performance targets | D | NS-RA | — | Excluded | OQ-24 |
| Realtime updates (Postgres changes) | B | Code only | `Dashboard.tsx`, others | Included | — |
| Hosting (Vercel) and CI (typecheck, lint, unit tests, Playwright e2e, build) | B | Unverified / present | `vercel.json`, `ci.yml` | Included; adding DB/firmware suites to CI = proposal | Recommendation R8 |
| Staging/maintenance SQL (`supabase/staging`, `maintenance`) | A (support) | Present, not run | runbook | Included; **never run against production without approval** | Deployment approval |
| Auxiliary tooling (Postman collection; `seed_script.ts`, `verify2.py`, `patch_*.cjs`, `scripts/*` are no longer in the repo) | B | Not reviewed | `testing/postman/` | Unreviewed — do not run against production | OQ-25 |
| Replace Supabase / React / Leaflet / Nominatim / Telegram / ESP32 | E | — | brief | Excluded | New requirement |
| Other sensors (smoke, flame, humidity) | E | — | brief names MQ-7 + DS18B20 | Excluded | New requirement |
| CAD / dispatch integration, native mobile apps, social login/2FA | E (assumed) | — | absent from brief | Excluded (assumption) | Confirm (OQ-01) |

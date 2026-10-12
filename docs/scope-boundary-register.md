# AgapSense Scope Boundary Register (Deliverable B)

Companion to [`system-specification.md`](system-specification.md) §5.3 (baseline v0.1, commit `5441cb78`).

**Classification key:** **A** In Scope · **B** Implemented but Unverified · **C** Incomplete or Defective · **D** Proposed, Not Approved · **E** Out of Scope (current baseline).
**Boundary:** *Included* = may be maintained and bug-fixed under the existing design; *Excluded* = must not be added/changed without an approved change request (see [`change-request-template.md`](change-request-template.md)); *Hold* = behaviour is disputed — do not change either way until the linked decision (OQ-xx) is made.
**Deploy:** `R` repo only (not deployed), `L` reported live, `–` unknown. "Approval needed" refers to the project owner. The only approval on record is the project description in the task brief; everything else needs ratification under OQ-01.

| Capability / component | Class | Current status | Evidence | Boundary | Approval needed |
|---|---|---|---|---|---|
| CO + temperature multi-sensor detection, Tier 1/Tier 2 | A | Verified (code); accuracy Unverified; hardware untested | `connectivity.cpp:126-134`; `trigger-alert:325-339` | Included — thresholds/logic changes need rule-8 review | Ratify (OQ-01); calibration plan (OQ-10) |
| MQ-7 voltage cycling (60 s/90 s) and ppm model | A | Verified (code) | `sensors.cpp:57-123` | Included; no recalibration or sensor swap without review | Accuracy tolerance NS-RA |
| DS18B20 temperature reading | A | Verified (code); stale-value gap | `sensors.cpp:137-156`; KI-17 | Included; freshness logic = **Hold** | OQ-09 |
| GPS capture (NEO-6M), cached fix, `gps_valid` | A | Verified (code) | `gps.cpp` | Included | — |
| Reverse geocoding (Nominatim, tiered address) | A | Verified (code); service Unverified | `trigger-alert:20-79` | Included; provider change excluded | Provider swap needs approval |
| Wi-Fi data path (HTTPS, WiFiManager provisioning) | A | Verified (code) | `connectivity.cpp` | Included | — |
| Tier 2 SMS via SIM800L, parallel to Wi-Fi | A | Verified (code); hardware Cannot Verify | `gsm.cpp`, `connectivity.cpp:667-681` | Included as built | Confirm semantics (OQ-02) |
| GSM **data** fallback (alert POST over cellular) | D / E? | Not Implemented | no code | **Hold** — excluded until owner rules | OQ-02 |
| Telegram station-chat notification | B | Verified (code); delivery Unverified | `trigger-alert:117-199` | Included | Evidence of delivery (test) |
| Web Push to admin/responder/resident | B | Verified (code); delivery Unverified; responder opt-in UI not found | `send-push-notification`; `Settings.tsx`, `ResidentAlertSettings.tsx` | Included | Confirm responder opt-in intent |
| Per-user Telegram alerts | C / D | Not Implemented (link only) | KI-24; issue #95 | Excluded until D5.4/D5.5 decided; link UI = **Hold** | OQ-23 |
| Email alerts / voice / other channels | E | Not present | — | Excluded | New requirement |
| Notification ledger + idempotent `raise_alert` | A (remediation) | Verified (code), `R`, gated | `20261020000*`, `trigger-alert` | Included — deploy only through approved order | Production deployment approval (OQ-05) |
| Incident lifecycle (`transition_incident`, guard trigger) | A (remediation) | Verified (code), `R` | `20261021000000` | Included | Deployment approval; D6.3 backfill |
| Auto-resolve on normal readings | C | Verified (code); policy undecided | `ingest-reading:180-196`; KI-13 | **Hold** | OQ-07 |
| Admin reopen of closed incident | D | Not implemented (blocked by design) | guard trigger | Excluded | D6.4 |
| Revoking direct `UPDATE` on `alert_events` | A (remediation) | Verified (code), `R` | `20261022000000`; issue #97 | Included — deploy only after 6.1/6.2 are live | Deployment approval |
| Registration with admin approval | A | Verified (code), `L` | `register`, `manage-registration` | Included | — |
| Backend enforcement of approval (RLS) | C | **Conflicting** | KI-09 | **Hold** — no RLS change before live inspection | OQ-03 |
| Roles: admin, bfp_responder, resident | A | Verified | `init.sql:29` | Included; **no new roles** | Any new role |
| Admin dashboard, users, devices, system overview, logs, settings | A | Verified/Partial | spec §5.11 | Included; IA preserved | — |
| Admin interactive map | A | Partial (tiles external) | `InteractiveMap.tsx` | Included | — |
| Responder dashboard, alert logs | A | Partial; metric defects | KI-02, KI-03 | Included; bug fixes allowed after owner picks metrics | OQ-22 |
| Responder station-information editor | C | **Conflicting** schema | KI-07 | **Hold** | OQ-04 |
| Resident setup, home, alert settings, device info, system log, account | A | Verified/Partial | spec §5.11 | Included | — |
| Resident threshold editing (RPC) | A | Verified | `20260917080000` | Included | Bounds & default ratification (OQ-08) |
| Address-drift detection and resident approval | A | Verified (code), `L` | `ingest-reading:198-261`; `20261016000000` | Included; approval overwrites device location by design | Confirm design (no admin review) |
| Device registration, ownership, API-key auth/regeneration | A | Verified | `Devices.tsx`; migrations | Included; key storage/rotation redesign excluded | OQ-16/17 for policy |
| Login lockout, `login` function, admin unlock | A | Verified, `L` | `login`, `check_login_lockout` | Included | — |
| Direct-to-GoTrue brute-force protection (CAPTCHA/rate limit) | D | Not implemented; owner accepted risk | `LIVE_TESTING_SUMMARY.md` | Excluded | Owner decision recorded earlier |
| Idle timeout (per role) | A | Partial, `L` | `useIdleTimeout.ts` | Included | — |
| Password reset by e-mail | B | Partial | `ForgotPassword.tsx` | Included | — |
| Support e-mail (Resend) | B | Partial; possibly broken | KI-08 | Included **Hold** pending check | OQ-21 |
| Location labelling: live / last-known / registered / unavailable | A (remediation) | Verified (code) | `lib/location.ts` | Included — rule: never present non-live position as live | 15 min value (OQ-18) |
| Fabricated metrics ("System Uptime 99.98%", "connectivity %") | C | Defect | KI-01/02 | Fix = bug fix once metric chosen | OQ-22 |
| Online/offline status definition | C | Conflicting | KI-03 | Bug fix to single helper allowed after confirmation | CT-3 |
| Data retention / archival | D | Not specified | FR-ALERT-006 | Excluded | OQ-12 |
| Privacy notice / consent flows | D | Not present | — | Excluded | OQ-13 |
| SLA, availability, performance targets | D | NS-RA | — | Excluded | OQ-24 |
| Realtime updates (Postgres changes) | B | Code only | `Dashboard.tsx`, others | Included | — |
| Hosting (Vercel) and CI (typecheck/lint/build) | B | Unverified / present | `vercel.json`, `ci.yml` | Included; adding tests to CI = proposal | Recommendation R6 |
| Staging/maintenance SQL (`supabase/staging`, `maintenance`) | A (support) | Present, not run | runbook | Included; **never run against production without approval** | Deployment approval |
| Auxiliary scripts (`seed_script.ts`, `verify2.py`, `patch_*.cjs`, `scripts/*`, Postman) | B | Not reviewed | repo root | Unreviewed — do not execute | OQ-25 |
| Replace Supabase / React / Leaflet / Nominatim / Telegram / ESP32 | E | — | brief | Excluded | New requirement |
| Other sensors (smoke, flame, humidity) | E | — | brief names MQ-7 + DS18B20 | Excluded | New requirement |
| CAD / dispatch integration, native mobile apps, social login/2FA | E (assumed) | — | absent from brief | Excluded (assumption) | Confirm (OQ-01) |

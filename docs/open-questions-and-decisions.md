# AgapSense Open Questions and Decisions Register (Deliverable D)

Part of the baseline started by [`system-specification.md`](system-specification.md) (v0.1, commit `5441cb78`). Every item here is something **only the project owner can authorise or clarify**. Until answered, the specification records the uncertainty and implementers must not resolve it by assumption (change rule 10).

Priority: **P1** = safety or security exposure, or it determines what the baseline *is*; **P2** = behavioural correctness / user-visible truthfulness; **P3** = documentation, hygiene, future planning.

## A. Open questions (OQ)

| ID | Pri | Question / decision needed | Why it matters | Evidence | Default until answered |
|---|---|---|---|---|---|
| OQ-01 | P1 | Which implemented features and objectives form the **approved** baseline? Please supply the original specification that code comments cite (`SW-2.1.1`…`SW-2.6.3`, `HW-1.1.5`…`HW-1.5.2`) or ratify the "In Scope" list (spec §5.3-A). | Without it, every requirement is "implemented and consistent", never "Approved" (0 of 61 are owner-confirmed individually). | Comment IDs in `trigger-alert`, `gsm.h`, `deviceStatus.ts`, `useIdleTimeout.ts`, `login/index.ts`; no such document in repo | Treat all as *Unconfirmed Requirement* |
| OQ-02 | P1 | Is "dual-path communication" satisfied by **Wi-Fi data + parallel SMS on Tier 2** (as built), or must the GSM module also carry data (alert POST over GPRS) when Wi-Fi is down? | Defines the central claim of the project title; today Tier 1, telemetry and config have no GSM path and SMS is not conditional on Wi-Fi failure. | `connectivity.cpp:667-681`; `gsm.cpp` (SMS only); spec §5.7 | Current behaviour documented as-is; no GSM data path in scope |
| OQ-03 | P1 | Run the **read-only** Phase 0 inspection from `docs/STAGING_DRY_RUN_RUNBOOK.md` on the live project and share the live definition of `get_auth_role()` plus policies/grants of `alert_events`, `profiles`, `devices`. Does the live function enforce `status='approved'`? | Decides whether a *pending/rejected* responder can read incidents/devices, edit `station_settings` and update incident columns (KI-09/KI-11). Repo and live evidence conflict. | `init.sql:192-195`; `20261019000000` header; `LIVE_RBAC_VERIFICATION.md` row 38; CHANGELOG §12 | Treat as **Conflicting**; make no RLS change |
| OQ-04 | P1 | Which `station_settings` shape is intended: migrations (`team_name`, `commander_name`, `contact_number`, `address`, lat/lng, `alert_radius_km`) or UI (`station_name`, `email`, `key_personnel`)? Does the live table have the UI's columns? | Responder "Station Information" cannot work on a DB built from the repo; changing either side is a schema/contract change (rules 5, 9). | KI-07 | Leave both unchanged |
| OQ-05 | P1 | Is the **baseline the repository (`main`) or production**? Production's migration history differs from the repo, and the audit-remediation work is not deployed. Approve (or reject) the deploy order and staging dry run. | Statuses in this spec are repo-based; production may differ in either direction. | CHANGELOG §11; runbook | Spec describes the repo; deployment status noted per row |
| OQ-06 | P1 | Should **residents** receive any notification on Tier 1? Today Tier 1 notifies admins/responders only (Telegram station chat + push) and the resident gets nothing; Tier 2 adds resident push and SMS. | A resident not told of a "warning" may be a safety gap or an intentional anti-panic choice (FEATURES.md: "No SMS is sent to avoid panic"). | `trigger-alert/index.ts:204-210`; FEATURES.md | Keep current behaviour |
| OQ-07 | P1 | **D6.1 — auto-resolution policy.** Should telemetry below thresholds close incidents automatically, including `acknowledged`/`responding` ones, or only flag "readings normal" and leave closing to people? | Today it silently closes responder-owned incidents. | `ingest-reading:180-196`; issue #96 | Unchanged |
| OQ-08 | P2 | What are the **canonical default thresholds** (DB 60 °C, admin form 65 °C, firmware fallback 70 °C; CO 200 ppm)? May a resident lower thresholds to any value 0–100 / 0–1000? Are the 0–1000 / 0–100 bounds approved? | Wrong default changes when alerts fire if the first config fetch fails or a device is created via the form. | KI-06; `20260917080000`; `20260924050000` | No change |
| OQ-09 | P1 | How should **stale or failed sensor data** be treated (frozen DS18B20 value, CO value held through heating)? Allowed to add a freshness limit or fault report? | A failed probe can mask a Tier 2. Detection-logic change = rule 8 review and physical retest. | KI-17 | Unchanged |
| OQ-10 | P1 | When will the **firmware be compiled with PlatformIO and tested on hardware** (Wi-Fi loss, GSM SMS, GPS cold start, watchdog timing, retry logic)? What pass criteria? | All firmware status is "code + host simulation"; no hardware evidence exists. | `CHANGELOG §10`; spec §5.14 | Hardware rows stay *Cannot Verify* |
| OQ-11 | P2 | What should the Tier 2 **SMS contain when no GPS fix exists** (currently a map link to 0,0 or a stale fix), and what should happen when the owner number is empty/unlinked? | Misleading emergency message / failed owner SMS. | KI-18, KI-19 | Unchanged |
| OQ-12 | P2 | **Retention** of `sensor_readings`, `alert_events`, `login_attempts`: required period, archival, deletion? | Unbounded growth (a row per device per 30 s); privacy. | FR-ALERT-006 | Not specified |
| OQ-13 | P1 | What is the **data-protection basis** for processing residents' location, phone and address (e.g. consent text, retention, third-party transfer to Nominatim/Telegram/Google links)? | Location data is shared with third parties and appears in links/SMS. | spec §5.6 | Not specified |
| OQ-14 | P3 | Should `docs/system-specification.md` **supersede** `docs/AGAPSENSE_SYSTEM_SPECIFICATION.md` and `docs/FEATURES.md` (both stale)? | Avoids contradictory references for developers and AI assistants. | spec §5.1 | Both left untouched |
| OQ-15 | P2 | Is auto-confirming e-mail addresses at registration acceptable, and what is the password policy (current minimum 6)? | Account takeover/typo risk; policy is Not Specified. | `register/index.ts:54,91-95` | Unchanged |
| OQ-16 | P2 | Is knowledge of `device_code` sufficient proof for a resident to claim a device? | First approved resident to enter a code owns the device and becomes its SMS/push recipient. | `link-device/index.ts` | Unchanged |
| OQ-17 | P3 | Is the **open provisioning AP** (`AgapSense-Setup`, no password) and **plaintext `devices.api_key`** accepted for the prototype? | Prototype security posture. | `config.example.h`; spec §5.6 | Accepted as existing design |
| OQ-18 | P3 | Confirm the **15-minute** "live GPS" window (code marks it "provisional owner-approved"). | Controls live vs last-known labelling. | `lib/location.ts:17` | 15 min |
| OQ-19 | P2 | Are responders **area/station-scoped**? Today every responder sees every device and receives every push, and the BFP SMS goes to **one number per device** (`devices.bfp_contact`), not to responder accounts. Is that intended? | FEATURES.md implies SMS to "Responders". | `init.sql:301-302`; `trigger-alert:456` | Unchanged |
| OQ-20 | P2 | What is `profiles.is_active` for? No UI sets it, `AuthGuard` ignores it, and a user can currently update it on their own row (KI-10). Should deactivation be a supported admin action? | Recipient eligibility depends on it. | `trigger-alert:207-212`; `protect_profile_fields` | Unchanged |
| OQ-21 | P3 | Is the **support-request e-mail** feature (fixed mailbox, Resend) in scope, and does it work live (`profiles.email` does not exist in migrations)? | KI-08 | | Unchanged |
| OQ-22 | P2 | What should the resident "System Uptime" and responder "Connectivity %" widgets show — a measured value, or should they be removed? | Fabricated numbers on a safety dashboard (KI-01/02). | `ResidentHome.tsx:268` | Unchanged |
| OQ-23 | P2 | **D5.4 / D5.5 — per-user Telegram.** Proceed, defer, or drop? If dropped, should the "Link Telegram" buttons and the webhook's "You will receive fire alerts here" text be removed? | UI promises something not built (KI-24). | issue #95 | Unchanged |
| OQ-24 | P3 | Define "system availability" and any targets (uptime, alert latency end-to-end, recovery time). | All NFR targets are NS-RA. | spec §5.6 | Not specified |
| OQ-25 | P3 | Which auxiliary items are maintained: `seed_script.ts`, `verify2.py`, `patch_*.cjs`, `scripts/*`, Postman collection? And clean up the QA device row noted in `LIVE_TESTING_SUMMARY.md`. | Unreviewed code in the repository root may include credentials or destructive steps. | repo root | Not reviewed |

## B. Pending decisions already tracked inside the repository

These labels come from `docs/ALERT_DELIVERY_AND_INCIDENT_INVARIANTS.md`, `docs/CHANGELOG_AUDIT_REMEDIATION.md` and the runbook. Their full text is *not* in the repository except as summarised below.

| Label | Subject (as described in repo docs) | Blocks | Pri |
|---|---|---|---|
| D5.2 | Keep-alive re-assert of an ongoing alert | Not built | P3 |
| D5.3 | Expired push subscriptions: reported only, never deleted (default applied) | Applied by default | P3 |
| D5.4, D5.5 | Per-user Telegram design and recipients | Step 5.4 (#95) | P2 → see OQ-23 |
| D5.6 | Label message times as UTC | Telegram/SMS time text | P3 |
| D5.7 | SMS pair may repeat once after a reboot during a fire (debounce timer is volatile) | Firmware acceptance | P2 |
| D6.1 | Auto-resolution / device-clear behaviour | Step 6.3 (#96) | P1 → OQ-07 |
| D6.3 | Backfill of legacy incident rows (3 rows in production per CHANGELOG §11) | Validating `alert_events_lifecycle_sync` | P2 |
| D6.4 | Admin reopen of closed incidents (currently impossible by design) | Step 6.3 | P2 |
| D6.5 | **Referenced in CHANGELOG §11 and the runbook, but not defined in any inspected document** | Production deployment | P2 — owner to state its subject |
| Step 6c | Revoke direct `UPDATE` on `alert_events` (#97) | After 6.1/6.2 are live | P1 |
| — | Fix for `get_auth_role()` ignoring `status` ("none yet", CHANGELOG §12) | Needs OQ-03 | P1 |

## C. Assumptions made in the specification (to be confirmed)

| # | Assumption | Basis |
|---|---|---|
| AS-1 | The task brief's project description is the only owner-supplied statement of objectives. | No requirements document in repo |
| AS-2 | Repository `main` at `5441cb78` is the artefact being specified; production may differ. | OQ-05 |
| AS-3 | Self-reported test and live-verification results are *claims*, not re-verified. | Method limits |
| AS-4 | Items cited as `SW-x/HW-x` are real owner requirements, but remain *Unconfirmed* until the source is supplied. | OQ-01 |
| AS-5 | Out-of-scope items E4–E6 (spec §5.3) are exclusions by absence from the brief, not by explicit owner statement. | OQ-01 |

## D. Contradictions found

| # | Contradiction | Sources | Resolution owner |
|---|---|---|---|
| CT-1 | Live `get_auth_role()` re-checks status vs repo definition that does not | `LIVE_RBAC_VERIFICATION.md` row 38 + older migration comments vs `init.sql:192-195`, `20261019000000` header | OQ-03 |
| CT-2 | `station_settings` columns in UI vs migrations | `ResponderSettings.tsx` vs `init.sql` | OQ-04 |
| CT-3 | Device "online" threshold (2/15 min vs 5 min) | `deviceStatus.ts` vs resident/responder pages | owner confirms SW-2.4.3 |
| CT-4 | Default temperature threshold 60 / 65 / 70 °C | DB / UI / firmware | OQ-08 |
| CT-5 | BFP SMS to "Responders" (docs) vs one `bfp_contact` number per device (code) | `FEATURES.md` vs `get-device-config` | OQ-19 |
| CT-6 | Telegram linking UI/webhook text promises alerts; no alert sender uses the link | `telegram-webhook` vs `trigger-alert` | OQ-23 |
| CT-7 | `docs/AGAPSENSE_SYSTEM_SPECIFICATION.md`/`FEATURES.md` vs current code (paths, files, flows) | spec §5.1 | OQ-14 |

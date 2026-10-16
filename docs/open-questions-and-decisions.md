# AgapSense Open Questions and Decisions Register (Deliverable D)

> **0.3 update (2026-10-16):** the statuses in this file are from the 0.1/0.2 review. For the current status of every Known Issue (11 fixed, 5 partly fixed, 8 open, plus 2 new open issues) see [`system-specification.md`](system-specification.md) §5.15.

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
| OQ-07 | P1 | **D6.1 — auto-resolution policy.** Should telemetry below thresholds close incidents automatically, including `acknowledged`/`responding` ones, or only flag "readings normal" and leave closing to people? | Today it silently closes responder-owned incidents. | `ingest-reading:180-196`; issue #96; [finding F1](#f1-auto-resolve-can-close-a-live-incident-on-one-reading) | Unchanged |
| OQ-08 | P2 | What are the **canonical default thresholds** (DB 60 °C, admin form 65 °C, firmware fallback 70 °C; CO 200 ppm)? May a resident lower thresholds to any value 0–100 / 0–1000? Are the 0–1000 / 0–100 bounds approved? | Wrong default changes when alerts fire if the first config fetch fails or a device is created via the form. | KI-06; `20260917080000`; `20260924050000` | No change |
| OQ-09 | P1 | How should **stale or failed sensor data** be treated (frozen DS18B20 value, CO value held through heating)? Allowed to add a freshness limit or fault report? | A failed probe can mask a Tier 2. Detection-logic change = rule 8 review and physical retest. | KI-17 | Unchanged |
| OQ-10 | P1 | When will the **firmware be compiled with PlatformIO and tested on hardware** (Wi-Fi loss, GSM SMS, GPS cold start, watchdog timing, retry logic)? What pass criteria? | All firmware status is "code + host simulation"; no hardware evidence exists. | `CHANGELOG §10`; spec §5.14 | Hardware rows stay *Cannot Verify* |
| OQ-11 | P2 | What should the Tier 2 **SMS contain when no GPS fix exists** (currently a map link to 0,0 or a stale fix), and what should happen when the owner number is empty/unlinked? | Misleading emergency message / failed owner SMS. | KI-18, KI-19 | Unchanged |
| OQ-12 | P2 | **Retention** of `sensor_readings`, `alert_events`, `login_attempts`: required period, archival, deletion? | Unbounded growth (a row per device per 30 s); privacy. | FR-ALERT-006 | Not specified |
| OQ-13 | P1 | What is the **data-protection basis** for processing residents' location, phone and address (e.g. consent text, retention, third-party transfer to Nominatim/Telegram/Google links)? | Location data is shared with third parties and appears in links/SMS. | spec §5.6 | Not specified |
| OQ-14 | P3 | Should `docs/system-specification.md` **supersede** `docs/AGAPSENSE_SYSTEM_SPECIFICATION.md` and `docs/FEATURES.md` (both stale)? | Avoids contradictory references for developers and AI assistants. | spec §5.1 | Both left untouched |
| OQ-15 | P2 | Is auto-confirming e-mail addresses at registration acceptable, and what is the password policy (current minimum 6)? | Account takeover/typo risk; policy is Not Specified. | `register/index.ts:54,91-95` | Unchanged |
| OQ-16 | P2 | Is knowledge of `device_code` sufficient proof for a resident to claim a device? | First approved resident to enter a code owns the device and becomes its SMS/push recipient. | `link-device/index.ts` | Unchanged |
| OQ-17 | P3 | Is the **provisioning AP** (`AgapSense-Setup`; now WPA2 with a shared default `WIFI_AP_PASSWORD`, previously open) and **plaintext `devices.api_key`** (also stored in plain NVS on the node) accepted for the prototype? | Prototype security posture. | `config.example.h`; spec §5.6 | Accepted as existing design |
| OQ-18 | P3 | Confirm the **15-minute** "live GPS" window (code marks it "provisional owner-approved"). | Controls live vs last-known labelling. | `lib/location.ts:17` | 15 min |
| OQ-19 | P2 | Are responders **area/station-scoped**? Today every responder sees every device and receives every push, and the BFP SMS goes to **one number per device** (`devices.bfp_contact`), not to responder accounts. Is that intended? | FEATURES.md implies SMS to "Responders". | `init.sql:301-302`; `trigger-alert:456` | Unchanged |
| OQ-20 | P2 | What is `profiles.is_active` for? No UI sets it, `AuthGuard` ignores it, and a user can currently update it on their own row (KI-10). Should deactivation be a supported admin action? | Recipient eligibility depends on it. | `trigger-alert:207-212`; `protect_profile_fields` | Unchanged |
| OQ-21 | P3 | Is the **support-request e-mail** feature (fixed mailbox, Resend) in scope, and does it work live (`profiles.email` does not exist in migrations)? | KI-08 | | Unchanged |
| OQ-22 | P2 | What should the resident "System Uptime" and responder "Connectivity %" widgets show — a measured value, or should they be removed? | Fabricated numbers on a safety dashboard (KI-01/02). | `ResidentHome.tsx:268` | Unchanged |
| OQ-23 | P2 | **D5.4 / D5.5 — per-user Telegram.** Proceed, defer, or drop? If dropped, should the "Link Telegram" buttons and the webhook's "You will receive fire alerts here" text be removed? | UI promises something not built (KI-24). | issue #95 | Unchanged |
| OQ-24 | P3 | Define "system availability" and any targets (uptime, alert latency end-to-end, recovery time). | All NFR targets are NS-RA. | spec §5.6 | Not specified |
| OQ-25 | P3 | Which auxiliary items are maintained: `seed_script.ts`, `verify2.py`, `patch_*.cjs`, `scripts/*`, Postman collection? *(0.3: the first four are no longer in the repository; only the Postman collection and `supabase/maintenance/` remain.)* And clean up the QA device row noted in `LIVE_TESTING_SUMMARY.md`. | Unreviewed code in the repository root may include credentials or destructive steps. | repo root | Not reviewed |
| OQ-26 | P2 | **OTA device identity - implemented, awaiting hardware verification.** Identity (`DEVICE_ID` + API key) now lives in each node's NVS, entered once in the (now password-protected) setup portal, so one OTA image serves every node and fleet push is re-enabled. Please confirm it on real nodes using `docs/HARDWARE_BENCH_TEST.md` (sections 2 and 8). Existing nodes need one USB re-flash. | A bug in the portal/NVS flow could leave a node unprovisioned (offline, local alarm only) or, if misused, mis-identified. Only the validators and the connectivity logic are covered by host tests. | `identity.h/.cpp`, `connectivity.cpp` `provisionAndConnect()`; `docs/FIRMWARE_GUIDE.md` 5.1, 8.6 | Code on branch; do not roll out fleet-wide before the bench test |
| OQ-27 | P1 | **BFP number at scale - decided: per device until go-live.** Each device has its own `devices.bfp_contact`, set in Admin > Devices > Edit device (validated PH mobile or blank = no BFP SMS). Before go-live, add a **station-wide default** (used when a device's own number is blank) **together with a "BFP texting enabled" switch** that stays off during testing, served by `trigger-alert` / `get-device-config` so the firmware needs no change. | Editing every device does not scale, but a single default with the real station number would make every test device text BFP; the switch prevents that. Needs OQ-04 (`station_settings` shape) resolved first. | `Devices.tsx` edit form; `trigger-alert` reply; `get-device-config`; host sim B01-B03 | Per-device numbers; keep test devices and `BFP_SMS_NUMBER_DEFAULT` on team phones |
| OQ-28 | P2 | **Resident "Run Diagnostics" - removed.** It waited 2.5 s and showed a canned message from data already on screen; it never contacted the device. Build a real self-test (device checks sensors, SIM signal/registration, GPS, battery, buzzer and reports results; request carried on the 10-minute config fetch), or leave it out? | "All systems operational" on a safety device that checked nothing is misleading. A real test is a firmware + backend + UI change. | `ResidentHome.tsx` before the dashboard rework (commit `e91197e`) | Left out |

## B. Pending decisions already tracked inside the repository

These labels come from `docs/ALERT_DELIVERY_AND_INCIDENT_INVARIANTS.md`, `docs/CHANGELOG_AUDIT_REMEDIATION.md` and the runbook. Their full text is *not* in the repository except as summarised below.

`Still needed?` and `Assessment` were added from a later implementation-review pass (see [§E](#e-findings-from-implementation-review-new)); rows not covered by that pass are marked "Not assessed in this pass".

| Label | Subject (as described in repo docs) | Blocks | Pri | Still needed? | Assessment |
|---|---|---|---|---|---|
| D5.2 | Keep-alive re-assert of an ongoing alert | Not built | P3 | Depends on D6.1 | If auto-resolve stays aggressive ([F1](#f1-auto-resolve-can-close-a-live-incident-on-one-reading)), a re-assert is how a continuing fire reopens visibility; if auto-resolve is made stricter, it is much less needed. |
| D5.3 | Expired push subscriptions: reported only, never deleted (default applied) | Applied by default | P3 | Not assessed in this pass | — |
| D5.4, D5.5 | Per-user Telegram design and recipients | Step 5.4 (#95) | P2 → see OQ-23 | Only if the feature is wanted | See Step 5.4 / OQ-23. |
| D5.6 | Label message times as UTC | Telegram/SMS time text | P3 | Yes, small (P2, but safety-relevant) | See [finding F2](#f2-message-times-are-unlabeled-utc). |
| D5.7 | SMS pair may repeat once after a reboot during a fire (debounce timer is volatile) | Firmware acceptance | P2 | Yes (blocks firmware sign-off) | Cheaper to accept than to fix: a fix needs the SMS debounce state to survive a reboot (non-volatile storage). A duplicate is considered better than a missed SMS. |
| D6.1 | Auto-resolution / device-clear behaviour | Step 6.3 (#96) | P1 → OQ-07 | Yes, and it matters more than it looked | See [finding F1](#f1-auto-resolve-can-close-a-live-incident-on-one-reading). |
| D6.3 | Backfill of legacy incident rows (3 rows in production per CHANGELOG §11) | Validating `alert_events_lifecycle_sync` | P2 | Yes (blocks the lifecycle migration going live cleanly) | Production has 3 incidents that are closed by `resolved_at` but still show an open status. Simplest default: set them to `resolved`. They may be test data; confirm. |
| D6.4 | Admin reopen of closed incidents (currently impossible by design) | Step 6.3 | P2 | Optional | The lifecycle guard forbids reopening. Needed only if closing by mistake is a real operational risk. A cheaper alternative is to raise a new incident. |
| D6.5 | **Referenced in CHANGELOG §11 and the runbook, but not defined in any inspected document** | Production deployment | P2 — owner to state its subject | Yes | The code tolerates some wrong orders (`trigger-alert` falls back to legacy persistence; the guard and uniqueness migration are independent), but the firmware order is a hard dependency. Document the rule and stop. |
| Step 6c | Revoke direct `UPDATE` on `alert_events` (#97) | After 6.1/6.2 are live | P1 | Done (code, `20261022000000`); deploy once 6.1/6.2 are live | — |
| — | Fix for `get_auth_role()` ignoring `status` ("none yet", CHANGELOG §12) | Needs OQ-03 | P1 | Not assessed in this pass | — |

## E. Findings from implementation review (new)

Found while fixing an unrelated bug (the support-request 500, KI-08). These are not new decisions — they sharpen D6.1 and D5.6 above with the exact mechanism and a recommendation. Per change rule 10, nothing below was acted on; owner sign-off is still required.

### F1: Auto-resolve can close a live incident on one reading

**Where:** `supabase/functions/ingest-reading/index.ts`, in the auto-resolution check.

**What it does today:** the device sends a telemetry reading about every 30 seconds. If one reading is marked `sensor_ready` and both values are strictly below the device's thresholds, the function closes every open incident for that device by setting `resolved_at` — whatever the incident's status.

**Why it's a problem:**
- The firmware's own logic needs two consecutive safe readings (~4 seconds) before it returns to CLEAR. The server needs only one.
- If a responder has acknowledged an incident, or is en route, one momentary low reading (a smoke dip, a sensor glitch) closes it. It disappears from the active list while the fire may still be burning.
- After migration 6.1, the same update also sets `incident_status` to `resolved`, so the closure looks identical to a real resolution.

**Options:**
(a) Accept it and document it.
(b) Require several consecutive below-threshold readings on the server before closing.
(c) Never auto-close an incident that is `acknowledged` or `responding` — only a person can close those.

**Recommendation:** (c), possibly combined with (b). This is a safety-behaviour choice — owner decision D6.1, not resolved by this review.

### F2: Message times are unlabeled UTC

**Where:** `trigger-alert`, in `fmtTime`, which formats the time with `toISOString()` cut to `YYYY-MM-DD HH:MM:SS`.

**What it does today:** the time in Telegram alerts and the BFP SMS (`Time: …`) is UTC with no zone marker.

**Why it's a problem:** users are in the Philippines (UTC+8). `Time: 2026-10-12 08:00:00` means 4 pm local. A responder reading it as local time is eight hours off — which matters when judging how old an alert is.

**Options:** add a UTC suffix, or convert to Asia/Manila time and say so in the message. Either is a one-line change in `fmtTime`, deployable alongside other fixes. Converting is more useful to readers; the SMS body is short, so check it still fits after the change.

**Recommendation:** convert to Asia/Manila and label it. Owner decision D5.6, not resolved by this review.

## F. Assumptions made in the specification (to be confirmed)

| # | Assumption | Basis |
|---|---|---|
| AS-1 | The task brief's project description is the only owner-supplied statement of objectives. | No requirements document in repo |
| AS-2 | Repository `main` at `5441cb78` is the artefact being specified; production may differ. | OQ-05 |
| AS-3 | Self-reported test and live-verification results are *claims*, not re-verified. | Method limits |
| AS-4 | Items cited as `SW-x/HW-x` are real owner requirements, but remain *Unconfirmed* until the source is supplied. | OQ-01 |
| AS-5 | Out-of-scope items E4–E6 (spec §5.3) are exclusions by absence from the brief, not by explicit owner statement. | OQ-01 |

## G. Contradictions found

| # | Contradiction | Sources | Resolution owner |
|---|---|---|---|
| CT-1 | Live `get_auth_role()` re-checks status vs repo definition that does not | `LIVE_RBAC_VERIFICATION.md` row 38 + older migration comments vs `init.sql:192-195`, `20261019000000` header | OQ-03 |
| CT-2 | `station_settings` columns in UI vs migrations | `ResponderSettings.tsx` vs `init.sql` | OQ-04 |
| CT-3 | Device "online" threshold (2/15 min vs 5 min) | `deviceStatus.ts` vs resident/responder pages | owner confirms SW-2.4.3 |
| CT-4 | Default temperature threshold 60 / 65 / 70 °C | DB / UI / firmware | OQ-08 |
| CT-5 | BFP SMS to "Responders" (docs) vs one `bfp_contact` number per device (code) | `FEATURES.md` vs `get-device-config` | OQ-19 |
| CT-6 | Telegram linking UI/webhook text promises alerts; no alert sender uses the link | `telegram-webhook` vs `trigger-alert` | OQ-23 |
| CT-7 | `docs/AGAPSENSE_SYSTEM_SPECIFICATION.md`/`FEATURES.md` vs current code (paths, files, flows) | spec §5.1 | OQ-14 |

## H. Resolutions for issues #96 and #95 (implemented in code — awaiting owner sign-off to deploy)

Per change rule 10, this is **not deployed**; it exists only as code + tests on each branch pending the owner's review and a separate deploy decision.

### Issue #96

| Decision | Resolution | Why | Implemented at | Still open |
|---|---|---|---|---|
| **D6.1** (OQ-07) | Never auto-close an `acknowledged` or `responding` incident — only a person, via `transition_incident()`, can close those. Auto-resolve stays allowed only while the incident is still `active`, and only after **2+ consecutive** below-threshold readings, not one. | Matches finding [F1](#f1-auto-resolve-can-close-a-live-incident-on-one-reading)'s own recommendation (option c, combined with b). The firmware itself already waits for ~2 consecutive safe readings before returning to CLEAR, so requiring the same server-side just matches existing device behaviour. | `supabase/functions/ingest-reading/index.ts` (fetches the prior reading, requires both readings below threshold and `incident_status = 'active'` before closing); tests in `tests/edge/ingest_reading.test.mjs` (6 cases). | The auto-resolve write is still a direct `UPDATE` on `alert_events` (service role, unaffected by the Step 6c revoke, which only touched `authenticated`) rather than going through `transition_incident()` — kept as-is since it only ever touches `active` incidents now, but a future pass could unify it. |
| **D6.4** | Do not build admin reopen. Keep the lifecycle guard's existing "closed states have no outgoing transition" rule as-is. If a device re-triggers after an incorrect close, let it raise a **new** incident — `alert_events_one_open_per_device` already supports this once the prior row is closed. | Reopening a closed row is currently blocked by design, not by omission (`20261021000000_incident_lifecycle.sql:140-142`). A new incident gives a cleaner audit trail than mutating a closed one, at no extra engineering cost. | No code change (decision is to leave the existing guard as-is). | Revisit only if real operational use shows "closed by mistake, needs reopening" is a common occurrence rather than a rare edge case. |
| **D6.3** | Run the existing read-only `supabase/maintenance/incident_lifecycle_dry_run.sql` first to confirm none of the 3 affected rows are test fixtures, then apply `incident_lifecycle_backfill.sql` to set them to `resolved`. | Matches the simplest default already recorded in row D6.3 above; scripts for both the check and the fix already exist. | **Not run.** This touches production data directly and needs the owner to run it (or explicitly direct it to be run) against the real database — not something to execute from this review. | Confirmation the 3 rows are real (not QA/test data) before backfilling, and who runs it / when. |

### Issue #95

| Decision | Resolution | Why | Implemented at | Still open |
|---|---|---|---|---|
| **D5.4** (OQ-23) | Per-user Telegram delivery, additive to the existing station chat: any approved+active admin/responder (any tier) or the device's resident (Tier 2 only) with a linked `telegram_chat_id` now gets the same alert text on their own chat. | Finishes wiring what was already half-built — `profiles.telegram_chat_id`, the webhook, and the "Link Telegram Account" UI for both residents and responders already existed with nothing sending to them (CT-6 / KI-24). | `supabase/functions/trigger-alert/index.ts` (`telegramUsers` dispatch, reuses the same `recipientRoles` filter and approved+active check as push, ledger channel `telegram_user`); tests in `tests/edge/telegram_user.test.mjs` (8 cases). | None blocking — this is the wiring described in OQ-23/CT-6, now done. |
| **D5.5** (OQ-23) | **Refuse**, not move, a chat-link request when that Telegram chat is already linked to a different profile; reply asking the user to unlink it there first. Backed by a DB uniqueness constraint. | Moving a chat id silently could redirect someone else's fire alerts to a new owner without their knowledge — a safety-relevant failure mode worth avoiding outright. | `supabase/functions/telegram-webhook/index.ts` (pre-check + refusal reply, plus a 23505 fallback for a race); `supabase/migrations/20261026000000_telegram_chat_id_uniqueness_and_guard.sql` (partial unique index on `telegram_chat_id`, and `protect_profile_fields()` now also guards `telegram_chat_id` so only the service role or an admin can set it — closing the adjacent gap where a user could overwrite their own link directly via PostgREST, bypassing the webhook's token flow); tests in `tests/edge/telegram_webhook.test.mjs` (5 cases) and `supabase/tests/local/telegram_chat_id.test.sql` (DB-level; **not run locally** — no local PostgreSQL/`psql` available in this environment, written to the repo's existing SQL test convention but unexecuted). | The SQL test file should be run once against a real local Postgres to confirm it passes before relying on it. |

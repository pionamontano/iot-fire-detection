# Audit remediation: documentation of changes

Merged to `main` as pull request #94 (merge commit `a83a08b`). **The code is in the repository; none of it has been deployed.**
No migration has been applied to any shared or production database, no Edge Function has been deployed, no physical device was
touched, and no real notification was sent. All verification was local (see section 10).

Related documents:
- `docs/ALERT_DELIVERY_AND_INCIDENT_INVARIANTS.md` - delivery semantics, incident invariants, writer audit, activation gate, firmware and backend assumptions.
- `docs/STAGING_DRY_RUN_RUNBOOK.md` - how to rehearse the migrations on a separate Supabase project before production.
- `supabase/staging/` - guarded SQL for a fresh staging project.
- Follow-up issues for unfinished work: #95 (Step 5.4), #96 (Step 6.3), #97 (Step 6c).

## 1. Summary

| Step | Audit finding | What changed | Needs deployment of |
|---|---|---|---|
| 1 | DB-002 | Profiles can no longer be read across users except by approved admins | database migration |
| 2 | NOT-005 | Only approved and active accounts are recipients, can register push, or can link devices | edge functions |
| 3 | DB-001 | Admin pages select explicit device columns and show load errors | frontend |
| 4 | GPS-001 | No fabricated coordinates; location labelled live / last known / registered / unavailable | frontend |
| 5.0 | IOT-001 / IOT-002 | Two firmware files converted from UTF-16 to UTF-8; host-side retry-policy header and tests | nothing (not wired) |
| 5.1 | NOT-004 / NOT-001 | Notification ledger and `raise_alert()`; one-open-incident-per-device index (gated) | database migrations |
| 5.2 | NOT-004 / NOT-001 | `trigger-alert` records the incident first, then notifies through the ledger | edge functions |
| 5.3 | IOT-002 | Firmware retries the alert POST and binds SMS delivery results to the right incident | firmware |
| 6.1 | FE-002 | Incident lifecycle guard trigger and `transition_incident()` | database migration |
| 6.2 | FE-002 | UI closes incidents only through `transition_incident()` | frontend |

Owner decisions applied: unapproved or rejected residents are never notification recipients (enforced server-side); no change to
auto-resolution behaviour until documented and approved; no Telegram expansion to residents yet; a GPS fix is "live" for 15 minutes;
registered coordinates are never labelled live. Detection thresholds, alert tiers, recipient rules, the approval workflow and the
GSM/SMS fallback are unchanged.

## 2. Step 1 - restrict cross-user profile reads (DB-002)
- **Problem:** the policy "Approved users can read profiles" used `get_auth_role() IS NOT NULL`, which ignores `profiles.status`, so every
  account with a profile (including pending and rejected ones) could read every profile (name, phone, address, device, Telegram id). The policy also recursed through `get_auth_role()`.
- **Change:** `supabase/migrations/20261019000000_restrict_profile_reads.sql` replaces it with "own row, or approved admin". The admin check is a
  `SECURITY DEFINER` helper `is_approved_admin()` with a pinned `search_path`, executable by `authenticated` only.
- **Not changed:** `get_auth_role()` itself still ignores `status`; its live definition has not been inspected.
- **Behaviour change:** non-admin clients no longer see other users' profiles; Realtime on `profiles` is filtered the same way (not verified live).
- **Rollback:** in the migration header.
- **Tests:** `supabase/tests/local/profiles_rls.test.sql`.

## 3. Step 2 - approved and active accounts only (NOT-005)
- **Change (edge functions), all enforced server-side:**
  - `link-device` and `register-push` now return `403` unless the caller's account is approved and active (a linked device makes an account an SMS/push recipient).
  - `get-device-config` only uses a resident as the SMS recipient if the resident is approved and active.
  - `trigger-alert` and `send-push-notification` only notify approved, active accounts.
- **Maintenance:** `supabase/maintenance/report_ineligible_push_subscriptions.sql` is a read-only report of existing subscriptions that no longer qualify (nothing is deleted).
- **Tests:** `tests/edge/recipients.test.mjs`, using `tests/edge/harness.mjs` (loads the real function source against an in-memory database).

## 4. Step 3 - explicit device columns and visible errors (DB-001)
- **Change:** `src/lib/deviceColumns.ts` lists the columns the admin pages need; Dashboard, Devices, Alerts, Users, Logs and InteractiveMap use it instead of `select *`.
  `src/components/LoadErrorBanner.tsx` shows a visible error instead of a silently empty page when a query fails.
- **Tests:** `tests/device-columns.test.ts`, `supabase/tests/local/devices_columns.test.sql`.

## 5. Step 4 - honest location display (GPS-001)
- **Change:** fabricated device coordinates were removed. `src/lib/location.ts` classifies a position as **live** (fix within 15 minutes), **last known**, **registered** (install address) or **unavailable**;
  `src/components/LocationBadge.tsx` shows the label. Used on the admin map, resident pages and the responder dashboard. Registered coordinates are never labelled live.
- **Tests:** `tests/location.test.ts`.

## 6. Step 5.0 - firmware prerequisites
- `gps.cpp` and `config.example.h` were converted from UTF-16 to UTF-8/LF (they could not be diffed or compiled reliably before).
- `src/alert_retry.h` is a pure C++11 retry/backoff policy: 5/10/20/40/60 s backoff for transient failures (no response, timeout, 5xx, 408, 429), 3 attempts for permanent rejections,
  highest tier wins, cancelled by returning to CLEAR, plus `reassert()` for re-escalation. Host tests in `firmware/agapsense-firmware/host_tests/`.

## 7. Step 5.1 and 5.2 - notification idempotency and incident recording (NOT-004, NOT-001)
**Delivery is at-least-once, not exactly-once.** A recipient can occasionally get a duplicate (for example after a crash between the provider accepting a message and the ledger recording it); a lost alert is considered worse.

Database (`supabase/migrations/`):
- `20261020000000_alert_notification_ledger.sql` (inert until used): table `alert_notifications` (service role only) and `claim_notification()` / `complete_notification()`.
  One row per (incident, tier, channel, recipient); a stale `pending` claim is reclaimable after 2 minutes (possible duplicate by design).
- `20261020000100_alert_open_incident_uniqueness.sql` (**gated**): unique index `alert_events_one_open_per_device` and the atomic `raise_alert()`. The migration aborts, changing nothing, if duplicate open incidents already exist.
  Open means `resolved_at IS NULL`.

Edge functions:
- `trigger-alert` records the incident first (`raise_alert`, with a legacy select-then-insert fallback when the function is missing unless `ALERT_STRICT_DB=1`), then notifies through the ledger with bounded time
  (`ALERT_DISPATCH_BUDGET_MS` default 4000, `ALERT_PROVIDER_TIMEOUT_MS` default 3500). It fails open: if the ledger is unavailable the notification is still sent. If the incident cannot be recorded it still makes a best-effort station notification and returns `500`.
  Response fields are additive (`created`, `tier`, `persistence`); `alert_event_id`, `owner_contact`, `bfp_contact`, `address_resolved`, `triggered_at` are unchanged.
- **Status codes changed:** database faults are now `500` with a machine-readable code (`persist_failed`, `internal`) instead of `401`/`400`, so a retrying client can tell them from a permanent rejection.
- `send-push-notification` returns per-recipient results; `confirm-sms-status` never lets a late failure report overwrite a recorded success.
- **Tests:** SQL suites `alert_ledger`, `alert_incident_uniqueness`, `alert_migration_precheck.sh`, `alert_concurrency.sh` (30 racing callers); Node `tests/edge/*` including a real-SQL integration (`tests/edge/run_integration.sh`).

## 8. Step 6.1 and 6.2 - incident lifecycle (FE-002)
- **Problem:** two fields (`incident_status`, `resolved_at`) were written independently and disagreed; the responder dashboard closed incidents with status only, leaving `resolved_at` empty, so a closed incident still counted as open.
- **Rule now:** closed <=> `incident_status IN ('resolved','false_alarm')` <=> `resolved_at IS NOT NULL`.
- **Migration** `20261021000000_incident_lifecycle.sql` (additive): columns `resolved_by`, `resolution_source`; a BEFORE INSERT/UPDATE guard trigger that makes the two fields agree for every writer and forbids reopening or re-closing; a CHECK constraint added `NOT VALID` (existing rows are not scanned until a backfill is approved);
  `transition_incident(id, status, note)` as the single server-side way to move an incident (validated transitions, actor and timestamps set by the server, idempotent repeats, admin-only manual close).
- **Backfill** (not applied, needs decision D6.3): `supabase/maintenance/incident_lifecycle_dry_run.sql` (read-only) and `incident_lifecycle_backfill.sql`.
- **UI (6.2):** `src/lib/incidents.ts` calls `transition_incident` for Acknowledge / Resolve / False alarm on the admin Alerts page and the responder dashboard; errors show at feed level.
- **Tests:** `incident_lifecycle.test.sql` (64 checks), `incident_concurrency.sh` (20 racing callers), `tests/incidents.test.ts`.

## 9. Step 5.3 - firmware retry and SMS result binding (IOT-002)
Files: `connectivity.cpp/.h`, `gsm.cpp/.h`, `alert_retry.h`, `sms_result_hold.h`.
- The first alert POST is still made at the transition; SMS is still queued immediately and independently of the POST and of Wi-Fi (same 5-minute debounce, same recipients).
- Failed POSTs are retried from the 2-second tick (one per tick, only while ONLINE) using `alert_retry.h`; CLEAR cancels; re-escalation re-sends tier 2.
- Each SMS job carries an incident number. A result whose `alert_event_id` was unknown at queue time is held (4 entries, 10 minutes) and reported once that incident's id is known, never against another incident.
  Failed status reports are retried 5/10/20/40/60/60/60 s (8 attempts), then dropped.
- The watchdog is fed before blocking alert, telemetry and SMS-status POSTs.
- **Behaviour changes:** an alert raised while Wi-Fi is down is delivered when Wi-Fi returns (before, it was never posted); SMS results for such incidents are now reported instead of dropped.
- **Known residuals:** a reboot during a fire can repeat the SMS pair once (D5.7); SMS sent while the POST was failing lack the address and server timestamp; after 3 permanent rejections the alert is abandoned until a re-escalation or new incident;
  `confirm-sms-status` still maps database faults to 401/400 so a transient fault drops that result.
- **Tests:** `firmware/agapsense-firmware/host_tests/` (`run.sh`): scheduler tests, SMS-holder tests, a simulation of the real `connectivity.cpp` and `gsm.cpp` against stubbed hardware (35 scenario functions), a mutation check (29 mutants, 27 killed, 2 documented redundant survivors) and a negative control against the pre-5.3 sources.

## 10. Verification status
Passing locally (throwaway PostgreSQL 16 with a Supabase stub, Node, host-compiled firmware): profiles_rls 13, devices_columns 5, alert_ledger 27, alert_incident_uniqueness 28, incident_lifecycle 64, migration precheck, both concurrency scripts,
edge real-SQL integration 8/8, Node tests 92 pass / 8 skipped / 0 fail, typecheck and build clean, lint 32 warnings (baseline 33), firmware host tests under ASan/UBSan.

**Not verified:** live Supabase (schema, grants, Realtime, the real `get_auth_role()`), deployed edge functions, real Telegram / Web Push / SMS providers, a PlatformIO build, ESP32 hardware, SIM800L, TLS, real ArduinoJson parsing, FreeRTOS scheduling, real network timing.
Playwright E2E ran during earlier steps only.

## 11. Deployment state and what is required before production
- Production's migration history differs from the repository (the Supabase preview check on `main` reports "Remote migration versions not found in local migrations directory"); the live schema has not been compared with the repo.
- One production read-only result so far: 3 incidents, none open, all 3 with `resolved_at` set but a non-closed status (so a backfill under D6.3 would touch 3 rows).
- By filename, `20261020000100` (uniqueness) sorts before `20261021000000` (lifecycle); the documented order is ledger -> lifecycle -> gate -> uniqueness, so apply by hand, not with a tool that orders by version.
- Required before production: staging dry run (`docs/STAGING_DRY_RUN_RUNBOOK.md`), human review of the migrations, a fresh backup, decisions D6.3 / D5.7 / D6.5, and then the deploy order:
  ledger migration -> lifecycle migration -> activation gate -> uniqueness migration -> `send-push-notification` -> `trigger-alert` -> frontend -> firmware (firmware last, because a pre-5.2 `trigger-alert` makes the 5.3 firmware give up after 3 attempts).
- Keep the Supabase "Deploy to production" integration off and the Vercel ignored-build step on `main` until the plan is approved.

## 12. Not done
| Item | Why | Tracking |
|---|---|---|
| Step 5.4 per-user Telegram for residents | needs D5.4, D5.5 | #95 |
| Step 6.3 auto-resolution / device-clear, admin reopen | needs D6.1, D6.4 (and D6.3 backfill) | #96 |
| Step 6c revoke direct UPDATE on `alert_events` | after 6.1 and 6.2 are live | #97 |
| Keep-alive re-assert of an ongoing alert | D5.2 | none yet |
| UTC label on message times | D5.6 | none yet |
| Fix for `get_auth_role()` ignoring `status` | out of scope until its live definition is seen | none yet |

## 13. Where to find things
- Migrations: `supabase/migrations/20261019000000`, `20261020000000`, `20261020000100`, `20261021000000`.
- Maintenance (read-only unless stated): `supabase/maintenance/`.
- SQL tests: `supabase/tests/local/` (run with `run_local_db_tests.sh`, needs a local PostgreSQL).
- Edge function tests: `tests/edge/`; frontend tests: `tests/*.test.ts` (`npm test`).
- Firmware tests: `firmware/agapsense-firmware/host_tests/run.sh` (needs `g++`; no hardware or PlatformIO).
- Staging SQL: `supabase/staging/`.

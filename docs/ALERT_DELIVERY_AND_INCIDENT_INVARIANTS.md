# Alert delivery semantics and incident invariants

Status: **design + local/test implementation (Steps 5.1, 5.2, 6.1 and 6.2).** Nothing in this document is deployed. The migrations
`20261020000000_alert_notification_ledger.sql`, `20261020000100_alert_open_incident_uniqueness.sql` (gated) and
`20261021000000_incident_lifecycle.sql` have only been exercised on a throwaway local PostgreSQL (`supabase/tests/local/`).
The edge-function changes (Step 5.2) and the UI (6.2) have only been tested locally; nothing is deployed.

## 1. Delivery semantics: at-least-once, not exactly-once

Notifications (Telegram, Web Push, and in future per-user Telegram) are designed for **at-least-once delivery**.
A recipient can, in rare failure cases, receive the same alert twice. A fire alert that arrives twice is acceptable;
one that is silently lost is not.

### Why exactly-once is not achievable here
Sending involves two steps that cannot be made atomic: (1) calling the provider, (2) recording the result in our database.

| Interruption | What the ledger row shows | What can happen next |
|---|---|---|
| Crash/timeout **before** the provider call | `pending` | Reclaimed after the stale interval and sent: delivered once. |
| Provider **accepted** the message, sender died/timed out **before** recording `sent` | `pending` (outcome unknown) | Reclaimed after the stale interval and sent **again: duplicate**. This is the accepted trade-off. |
| Provider rejected / unreachable | `failed` | Retried (up to the attempt limit) unless `retryable = false`. |
| Provider accepted, result recorded | `sent` | Terminal. Never re-sent by this mechanism. |

None of our providers offers a true idempotency key: Telegram `sendMessage` has none; the SIM800L SMS path has none.
Web Push has a `Topic` header that lets the push service replace an *undelivered* message that carries the same topic;
it is a partial mitigation to evaluate in Step 5.2, not a guarantee.

### What the ledger (`alert_notifications` + `claim_notification`) does guarantee
* Two concurrent senders, or a replayed/retried alert request, cannot both claim the same
  `(incident, tier, channel, recipient)`: this removes most duplicates (tested with 100 racing sessions).
* `sent` and `skipped` are terminal; a `failed` row is retried only within the attempt budget (default 3) and only if retryable.
* Every attempt, provider status and error is recorded, so a failure is visible instead of assumed successful.
* An escalation (tier 1 to 2) is a new key, so recipients are told about the escalation once.

### What it does not guarantee
* Exactly-once delivery (see the table above).
* That a person saw the message. `sent` means **the provider accepted it**, nothing more.
* That a stuck `pending` row resolves quickly: reclaim only happens when a later request touches the same key.

Tunables: `p_stale` (default 2 minutes) trades faster recovery against a higher chance of a duplicate if the first sender is merely slow;
`p_max_attempts` (default 3) bounds retry storms.

### The firmware alert POST is also at-least-once
`src/alert_retry.h` (Step 5.0b; wired into `connectivity.cpp` in Step 5.3) retries the alert POST after a lost response, so the server can see the same alert more
than once. That is made safe on the server (one open incident per device, ledger claims), not on the device.
SMS is unchanged: it is queued immediately and independently of the POST, and may repeat once if the device reboots during a fire
(the debounce timer is volatile).

## 2. Incident invariant: "open" means `resolved_at IS NULL`

The unique index `alert_events_one_open_per_device` (migration `...000100`) allows at most one row per device with `resolved_at IS NULL`.
Its safety depends on **every writer closing an incident by setting `resolved_at`.** A writer that marks an incident "resolved"
without setting `resolved_at` leaves a closed-looking row that is still *open* to the index, so a **new fire is merged into it and can stay
hidden** (the responder dashboard filters out `incident_status = 'resolved'`).

### Writer audit (code read; each statement also executed as its real role in `alert_incident_uniqueness.test.sql`)

| # | Writer | Role | Writes | Closes via `resolved_at`? | Effect on the open-incident rule (before 6.1) |
|---|---|---|---|---|---|
| 1 | `trigger-alert` update of the open alert | service | tier, readings, coordinates, `telegram_sent` | n/a | Compatible. |
| 2 | `trigger-alert` insert | service | new row (`active`) | n/a | Today it does select-then-insert; a racing duplicate now fails with `23505` (previously a silent duplicate). `raise_alert()` replaces it in Step 5.2. |
| 3 | `ingest-reading` auto-resolve | service | `resolved_at` only | **Yes** | Closes correctly. Leaves `incident_status` stale and also closes acknowledged/responding incidents (owner decision pending, Step 6). |
| 4 | Admin `Alerts.handleResolveAlert` | admin | `resolved_at` only | **Yes** | Closes correctly. Leaves `incident_status = 'active'` on the closed row (cosmetic, fixed in Step 6). |
| 5 | Responder `handleAcknowledge` | responder | `incident_status`, `acknowledged_by/at` | n/a | Compatible: stays the same open incident. |
| 6 | Responder `handleUpdateStatus` (`responding`) | responder | `incident_status` | n/a | Compatible. |
| 7 | Responder `handleUpdateStatus` (`resolved`, `false_alarm`) | responder | `incident_status` **only** | **No: defect** | The row stays open to the index. **Confirmed by test.** Mitigated by the stopgap below. **Fixed at write time by the 6.1 guard trigger** (section 3); the UI itself is changed in 6.2. |
| 8 | `confirm-sms-status` | service | `sms_sent_owner/bfp` | n/a | Compatible; `raise_alert` preserves these flags. |
| 9 | `supabase/reset_and_seed_devices.sql` (manual) | superuser | deletes rows | n/a | Unaffected. |
| 10 | Any manual SQL / future code | any | any | not guaranteed | Needs the Step 6 database guard (trigger + `CHECK`). |

### How `raise_alert()` protects itself until Step 6
Before upserting, it closes (`resolved_at = now()`) any open row whose `incident_status` is already `resolved`/`false_alarm`.
A new fire then becomes a **new** incident. A negative-control test shows that without this the fire is absorbed and hidden.
`resolved_at = now()` is "when the system noticed", not when the responder acted (the legacy write recorded no time).

## 3. Incident lifecycle (Step 6.1, local/test only)

`closed <=> incident_status IN ('resolved','false_alarm') <=> resolved_at IS NOT NULL`, enforced by the database for **every** writer.

**Guard trigger `alert_events_lifecycle_guard`** (BEFORE INSERT/UPDATE): if a legacy writer sets only one side, the database sets the other
(status-only close gets `resolved_at = now()`; `resolved_at`-only close gets `incident_status = 'resolved'`). A closed incident can never be
reopened, and its status/`resolved_at` can never be rewritten; delivery flags and notes stay writable. The closure is attributed to the caller
only in the statement that takes the incident from open to closed (never to someone who merely edits a closed row, never invented by a backfill).
A `CHECK` constraint (`NOT VALID`) enforces the same rule on every new write; existing rows are not scanned until the approved backfill and
`VALIDATE CONSTRAINT` (scripts in `supabase/maintenance/`, **not** a migration; the backfill modifies data and needs your approval).

**`transition_incident(alert_id, to_status, notes)`**: the single server-side way to move an incident through its lifecycle.
Authorization is checked inside the function (approved **and** active admin/responder). Transitions:

| from \ to | acknowledged | responding | resolved | false_alarm |
|---|---|---|---|---|
| active | responder, admin | no | admin only | admin only |
| acknowledged | no-op | responder, admin | responder, admin | responder, admin |
| responding | no | no-op | responder, admin | responder, admin |
| resolved / false_alarm | no | no | no (no-op on same status) | no (no-op on same status) |

Actor, timestamps and `resolution_source` (`responder` / `admin`; `legacy` for guard-normalised legacy writes) are set by the server, never by the client.
Repeating a transition is a no-op, and concurrent callers are serialised by a row lock (tested with 80 racers: one winner, no divergent outcomes).

**Not in 6.1 (deliberately):** auto-resolution behaviour (`device_cleared_at`, `device_readings_clear`, decision D6.1 pending), the UI change (6.2),
revoking direct `UPDATE` on `alert_events` (6c), and any change to `raise_alert`. Until 6.2 the legacy UI keeps working unchanged because the guard
makes its writes consistent. The `raise_alert` stopgap remains useful for legacy rows that have not been backfilled.

Observation (pre-existing, unchanged): `alert_events.acknowledged_by` has no `ON DELETE` action, so deleting a responder who acknowledged an
incident is blocked by the foreign key. The new `resolved_by` uses `ON DELETE SET NULL`. Changing `acknowledged_by` the same way is a one-line,
separate decision.

### UI (Step 6.2, local/test only)

The responder dashboard and the admin manual-resolve button now change incidents **only** through `transition_incident`
(`src/lib/incidents.ts`); the UI no longer writes `alert_events` directly and no longer sends `acknowledged_by` (the server records the actor).
* Buttons come from the same transition table as the database; a `responding` incident now offers **Resolve** and **False Alarm**.
* Closing asks for confirmation because a closed incident cannot be reopened.
* Errors are explained, not swallowed: not authorized (42501), already updated/closed by someone else (55000, list refreshed), not found (P0002).
  The message is shown at feed level so it survives the refresh that removes a closed incident.
* **Deploy order matters:** migration `20261021000000` must be applied **before** this UI. If the UI runs first, incident actions fail with a clear
  "database update pending" message (PostgREST `PGRST202`) and responders cannot acknowledge from the dashboard. There is deliberately no
  direct-write fallback (a second write path is exactly what Step 6 removes). Direct `UPDATE` remains granted until step 6c (`20261022000000`,
  written but not yet deployed - see CHANGELOG §8a) is applied, so older clients keep working until then.
* Not in 6.2: the "device readings back to normal" badge (needs `device_cleared_at`, decision D6.1), revoking direct `UPDATE` (6c), and the
  other responder/admin screens, which read `resolved_at` and need no change.

### Edge functions (Step 5.2, local/test only)

`trigger-alert` now works in this order: validate (unchanged rules) -> **`raise_alert()` records the incident** -> notify through the ledger ->
respond. The incident is persisted before any provider is contacted, so a slow or failing Telegram/push service can never delay or lose the record.

* **Idempotent.** Replaying or retrying the same alert returns the same incident (`created:false`) and sends nothing twice; an escalation (tier 1 -> 2) is
  announced once; a late tier-1 retry on a tier-2 incident neither downgrades nor re-sends. Verified with 20 racing requests against the real SQL.
* **Bounded.** Every provider call has a timeout (`ALERT_PROVIDER_TIMEOUT_MS`, default 3500) and the whole dispatch has a budget
  (`ALERT_DISPATCH_BUDGET_MS`, default 4000), so the response carrying the SMS contacts stays prompt (the firmware's HTTP timeout is 10 s).
* **Recorded, not assumed.** Telegram and push outcomes (status, provider reference, error, retryable) are written to `alert_notifications`.
  `send-push-notification` returns a result per recipient (`sent` / `failed` / `skipped`). Failed retryable notifications are retried by a *later*
  request for the same incident (up to 3 attempts); permanent errors (Telegram 403/400, expired push endpoints) are not. Nothing is deleted:
  expired push subscriptions are reported only (decision D5.3 default).
* **Fail-open for emergencies.** If the ledger errors, the notification is sent anyway (a duplicate beats a lost alert). If the incident cannot be
  recorded at all, the station Telegram/push are still attempted once (de-duplicated in memory for 5 minutes) before a retryable `500` is returned.
* **Rollout-tolerant.** Before migration `20261020000100` exists, `raise_alert` is "not found" and the function falls back to the previous
  select-then-insert persistence (response `persistence:"legacy"`, no notification dedupe). Set `ALERT_STRICT_DB=1` to refuse that and fail with `500`.
  Missing ledger functions degrade to the old "always send" behaviour.
* **Unchanged:** thresholds, tiers, recipients (approved + active only), the notification texts, and the response fields the firmware parses.
  Added (additive): `created`, `tier` (the tier now in force), `persistence`. `triggered_at` is now the incident's own time (UTC).

| Status | When | `code` |
|---|---|---|
| 200 | incident recorded (whatever the notification outcome) | - |
| 400 | bad JSON / non-numeric readings / invalid coordinates / readings below thresholds | `invalid_payload`, `below_threshold` |
| 401 | missing, unknown or inactive device key | - |
| 500 | **server fault**, safe to retry: device lookup failed, incident could not be recorded, unexpected error | `device_lookup_failed`, `persist_failed`, `internal` |

Previously a database fault during the device lookup surfaced as `401` and internal errors as `400`; a retrying client cannot tell those from a permanent
rejection, so faults are now `500`. `confirm-sms-status` additionally ignores a late failure report for an SMS already recorded as sent.

### Firmware (Step 5.3, local/test only — compiled firmware and hardware NOT verified)
- **First attempt unchanged**: the alert POST is still made synchronously at the CLEAR->TIERx / TIER1->TIER2 transition. SMS is still queued
  immediately afterwards, independent of the POST result and of Wi-Fi (GSM fallback), with the unchanged 5-minute SMS debounce.
- **Retry**: if that POST does not get a 2xx, `attemptAlertPost()` retries from the connectivity tick (at most one alert POST per tick, only while
  ONLINE; being offline neither consumes an attempt nor advances the backoff). Transient failures (no response, timeout, 5xx, 408, 429) back off
  5/10/20/40/60 s (the delay is measured from the end of the failed call). Other 4xx are retried 3 times then abandoned. The tier sent is always the
  highest tier entered. A return to CLEAR cancels everything. A re-escalation (TIER2->TIER1->TIER2) re-POSTs tier 2, as before 5.3 (`reassert`).
- **SMS result late-binding**: an SMS result whose `alert_event_id` was unknown at queue time (POST not yet acknowledged) is held (max 4, 10 min) and
  reported once the incident's id is known. Each SMS job carries an incident sequence number; a result is only ever reported against the id of
  the incident it belongs to. Results that never obtain an id (alert never acknowledged, or the incident ended first) are discarded, not
  guessed. A failed status report is retried with backoff 5/10/20/40/60/60/60 s, 8 attempts in total per result (about 4 minutes), then dropped; at most one failing report per tick; every result also expires 10 minutes after it was held.
- **WDT**: `esp_task_wdt_reset()` is called before each blocking alert POST, telemetry POST and SMS-status POST (added after review: a tick can now chain several
  blocking requests). The host model, with failing calls blocking 20 s each, shows the gaps stay under 30 s with these feeds and exceed it without the alert/telemetry
  feeds; the SMS-report feed is redundant in the model (a failed telemetry POST makes the device DEGRADED, which skips reports) and is kept as defence in depth.
  The model's blocking times are assumptions; real timing is **unverified** (hardware only).
- **Residual duplicates (at-least-once)**: a lost response makes the server see the alert again (safe, see above). A reboot during a fire repeats the SMS
  pair once (D5.7, accepted pending decision). A new incident within 5 minutes of the previous SMS pair sends no SMS (pre-existing debounce, unchanged).
- **Behaviour changes vs 5.2**: (1) alert POST is now retried instead of lost; (2) an alert raised while Wi-Fi is down is delivered when it returns
  (previously never posted for that incident); (3) SMS delivery results for such incidents are now reported instead of dropped.

Not in 5.2/5.3: per-user Telegram (5.4, needs D5.5), the keep-alive re-assert (D5.2), the UTC label on message times (D5.6).

**Deploy order (when approved):** `20261020000000` (ledger) -> `20261021000000` (lifecycle) -> activation gate satisfied -> `20261020000100`
(unique index + `raise_alert`) -> `send-push-notification` -> `trigger-alert`. `trigger-alert` tolerates an older `send-push-notification`
(no per-recipient results) and a missing 5.1 schema (legacy fallback), so a wrong order degrades instead of failing.

### Step 5.3 review (local/test only)

**Defects found and fixed in review**
1. Status-report retries had no backoff: all attempts were spent in the first ~10 s, so a 1 minute outage of `confirm-sms-status` lost the report. Now backoff 5..60 s, 8 attempts (~4 min), still bounded by the 10 minute expiry.
2. The watchdog was not fed before the telemetry POST, which can follow a failing alert retry in the same tick (two blocking calls). A feed was added.

**Edge cases (test = `host_tests/test_connectivity_sim.cpp` unless noted)**

| # | Case | Expected behaviour | Demonstrated by |
|---|------|--------------------|-----------------|
| 1 | Old SMS result arrives after a new incident began | Never reported against the new incident (job carries its incident number; unbound old results are discarded; bound ones keep their own id) | R01/S18, S16; `test_sms_hold.cpp` never_bind_to_a_later_incident |
| 2 | Two incidents in sequence, responses delayed/lost | Each result is reported only against its own incident's id; results that never learned an id are discarded | R02, S08 |
| 3 | Incident id arrives just before / after the 10 minute expiry | Before or exactly at the limit: reported. After: discarded; the alert itself is still delivered | `test_sms_hold.cpp` test_ttl and test_boundaries_and_duplicates (to the millisecond); R03 end-to-end (5 vs 12 minutes) |
| 4 | Holder at capacity (4) | Oldest dropped, newest kept; never grows | `test_sms_hold.cpp` test_capacity; R04 |
| 5 | Same delivery result presented more than once | Not deduplicated on the device; the server treats repeats as harmless (below) | `test_sms_hold.cpp` duplicates; R05 (response lost after the server applied it) |
| 6 | Status report fails until the retry limit | 8 attempts per result with backoff, then dropped, nothing left held; one failing report per tick | R06, R06c, S11, `test_sms_hold.cpp` test_requeue_budget; R06b (60 s outage survived) |
| 7 | CLEAR while a retry is pending | Retry cancelled, no further alert POST (tier 1 and tier 2) | R07 = S07, S07b; `test_alert_retry.cpp` |
| 8 | Tier 2 re-asserted after an earlier request failed/timed out | Fresh immediate attempt with tier 2 and reset backoff; SMS debounce unchanged | R08, S05, S06; `test_alert_retry.cpp` test_reassert |
| 9 | Offline longer than the retry interval, then reconnect | No attempts and no backoff growth while offline; delivered within a few ticks of reconnecting | R09, S09 |
| 10 | Reboot during an active incident | Alert re-sent (server keeps one open incident); SMS pair may repeat once (D5.7); both runs' results are reported | R10 = S12 |

**Assumptions about the backend (read from the repository code; nothing was applied or deployed)**
- *Alert POST response fields used for binding:* `alert_event_id` (required), plus `owner_contact`, `bfp_contact`, `address_resolved`, `triggered_at` (optional). `trigger-alert` (5.2) returns `alert_event_id` on both the `raise_alert` path and the legacy persistence path, and answers `500 persist_failed` (retryable) when the incident could not be recorded.
- *2xx without a usable `alert_event_id`* (e.g. an older deployed function, or an unparsable body): the firmware treats 2xx as delivered and does **not** retry; the SMS results can then never be bound and expire unreported. SMS themselves are unaffected. Test: R11.
- *Backend commits but the device loses the response:* the device retries; the server finds the open incident (`created:false`) and the ledger suppresses duplicate notifications for the same (incident, tier, channel, recipient). Tests: S13, R02 (server-side model only; real SQL behaviour is covered by the 5.1/5.2 suites).
- *Status-report retries under repeated requests:* `confirm-sms-status` is idempotent for `success:true`, and a later `success:false` never overwrites a recorded success. A `success:true` after a recorded `false` does overwrite it (intended: a late success wins). An unknown id returns 404, which the device treats as permanent and drops.
- *Depends on migrations/functions that are not activated:* (a) the one-open-incident guarantee under concurrent requests needs `raise_alert()` and the unique index (5.1b); with the legacy select-then-insert path a retry that overlaps a slow original request could create a second open incident, and the device would bind to whichever response it receives; (b) duplicate-notification suppression needs the `alert_notifications` ledger (fail-open: without it a retried POST can notify again, by design of the emergency-first policy); (c) retryable `500`s for database faults exist only once the 5.2 `trigger-alert` is deployed. **A pre-5.2 deployed `trigger-alert` reports database faults as 401/400, which the firmware classifies as permanent and gives up on after 3 attempts. Deploy 5.2 before any firmware that includes 5.3.**
- *Not changed:* `confirm-sms-status` still maps database faults to 401/400, so a transient fault there is treated by the device as permanent and that result is dropped (the SMS itself was already sent). Left as an open risk.

## 4. Activation gate (required before 5.1b is applied anywhere shared, or before any code calls `raise_alert`)

- [ ] Review sign-off on this document, both migrations and the tests.
- [ ] Read-only precheck returns **zero rows** on the target database:
      `select device_id, count(*) from alert_events where resolved_at is null group by device_id having count(*) > 1;`
      (the migration also aborts by itself if it finds any; it never deletes or resolves data).
- [ ] Live check that the target's `alert_events` grants/policies and `get_auth_role()` match what the tests assume
      (before the Step 1 profiles migration the repository's migrations did not rebuild a working database, and the live
      definition of `get_auth_role()` has still not been inspected).
- [ ] Writer #7 fixed: apply `20261021000000_incident_lifecycle.sql` (guard trigger) **before** the 5.1b index becomes authoritative, or explicitly accept the `raise_alert` stopgap.
- [ ] All local suites pass: `supabase/tests/local/*.test.sql`, `alert_migration_precheck.sh`, `alert_concurrency.sh`, `incident_concurrency.sh`, the Node tests (`npm test`), `tests/edge/run_integration.sh` (real SQL), and the firmware host tests.
- [ ] Before applying 6.1 anywhere shared: run `supabase/maintenance/incident_lifecycle_dry_run.sql` (read-only) and review; decide on the backfill separately.
- [ ] Rollback prepared (drop function `raise_alert`, drop the index; drop the ledger objects).

## 5. Not verified

Live Supabase (schema, grants, Realtime), deployed edge functions, any real provider (Telegram, Web Push, SMS), the compiled firmware
(PlatformIO/ESP32 toolchain, real ArduinoJson/HTTPClient/TLS), FreeRTOS task interleaving, the real SIM800L, and hardware behaviour.
Host results cover the database logic, the retry policy, and a simulation of the real `connectivity.cpp`/`gsm.cpp` against test doubles.

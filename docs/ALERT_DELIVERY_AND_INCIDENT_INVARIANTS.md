# Alert delivery semantics and incident invariants

Status: **design + local/test implementation (Step 5.1).** Nothing in this document is deployed. The migrations
`20261020000000_alert_notification_ledger.sql` and `20261020000100_alert_open_incident_uniqueness.sql` have only been
exercised on a throwaway local PostgreSQL (`supabase/tests/local/`). No edge function calls the new database functions yet.

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
`src/alert_retry.h` (Step 5.0b, not yet wired in) retries the alert POST after a lost response, so the server can see the same alert more
than once. That is made safe on the server (one open incident per device, ledger claims), not on the device.
SMS is unchanged: it is queued immediately and independently of the POST, and may repeat once if the device reboots during a fire
(the debounce timer is volatile).

## 2. Incident invariant: "open" means `resolved_at IS NULL`

The unique index `alert_events_one_open_per_device` (migration `...000100`) allows at most one row per device with `resolved_at IS NULL`.
Its safety depends on **every writer closing an incident by setting `resolved_at`.** A writer that marks an incident "resolved"
without setting `resolved_at` leaves a closed-looking row that is still *open* to the index, so a **new fire is merged into it and can stay
hidden** (the responder dashboard filters out `incident_status = 'resolved'`).

### Writer audit (code read; each statement also executed as its real role in `alert_incident_uniqueness.test.sql`)

| # | Writer | Role | Writes | Closes via `resolved_at`? | Effect on the open-incident rule |
|---|---|---|---|---|---|
| 1 | `trigger-alert` update of the open alert | service | tier, readings, coordinates, `telegram_sent` | n/a | Compatible. |
| 2 | `trigger-alert` insert | service | new row (`active`) | n/a | Today it does select-then-insert; a racing duplicate now fails with `23505` (previously a silent duplicate). `raise_alert()` replaces it in Step 5.2. |
| 3 | `ingest-reading` auto-resolve | service | `resolved_at` only | **Yes** | Closes correctly. Leaves `incident_status` stale and also closes acknowledged/responding incidents (owner decision pending, Step 6). |
| 4 | Admin `Alerts.handleResolveAlert` | admin | `resolved_at` only | **Yes** | Closes correctly. Leaves `incident_status = 'active'` on the closed row (cosmetic, fixed in Step 6). |
| 5 | Responder `handleAcknowledge` | responder | `incident_status`, `acknowledged_by/at` | n/a | Compatible: stays the same open incident. |
| 6 | Responder `handleUpdateStatus` (`responding`) | responder | `incident_status` | n/a | Compatible. |
| 7 | Responder `handleUpdateStatus` (`resolved`, `false_alarm`) | responder | `incident_status` **only** | **No: defect** | The row stays open to the index. **Confirmed by test.** Mitigated by the stopgap below; fixed properly in Step 6. |
| 8 | `confirm-sms-status` | service | `sms_sent_owner/bfp` | n/a | Compatible; `raise_alert` preserves these flags. |
| 9 | `supabase/reset_and_seed_devices.sql` (manual) | superuser | deletes rows | n/a | Unaffected. |
| 10 | Any manual SQL / future code | any | any | not guaranteed | Needs the Step 6 database guard (trigger + `CHECK`). |

### How `raise_alert()` protects itself until Step 6
Before upserting, it closes (`resolved_at = now()`) any open row whose `incident_status` is already `resolved`/`false_alarm`.
A new fire then becomes a **new** incident. A negative-control test shows that without this the fire is absorbed and hidden.
`resolved_at = now()` is "when the system noticed", not when the responder acted (the legacy write recorded no time).

## 3. Activation gate (required before 5.1b is applied anywhere shared, or before any code calls `raise_alert`)

- [ ] Review sign-off on this document, both migrations and the tests.
- [ ] Read-only precheck returns **zero rows** on the target database:
      `select device_id, count(*) from alert_events where resolved_at is null group by device_id having count(*) > 1;`
      (the migration also aborts by itself if it finds any; it never deletes or resolves data).
- [ ] Live check that the target's `alert_events` grants/policies and `get_auth_role()` match what the tests assume
      (before the Step 1 profiles migration the repository's migrations did not rebuild a working database, and the live
      definition of `get_auth_role()` has still not been inspected).
- [ ] Writer #7 fixed (Step 6) **or** the stopgap explicitly accepted.
- [ ] All local suites pass: `supabase/tests/local/*.test.sql`, `alert_migration_precheck.sh`, `alert_concurrency.sh`, the Node edge tests, and the firmware host tests.
- [ ] Rollback prepared (drop function `raise_alert`, drop the index; drop the ledger objects).

## 4. Not verified

Live Supabase (schema, grants, Realtime), deployed edge functions, any real provider (Telegram, Web Push, SMS), the compiled firmware,
and hardware behaviour. Unit/integration results here cover the database logic and the retry policy only.

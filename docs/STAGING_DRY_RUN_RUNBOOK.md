# Staging dry-run runbook (activation gate)

Purpose: apply the four new migrations to a **separate, throwaway Supabase project** that mirrors the live schema, and prove
they behave as the local tests say, **before** anything is applied to the real `Agapsense` project.
Written for Steps 1, 5.1 and 6.1 (`20261019000000`, `20261020000000`, `20261020000100`, `20261021000000`).
Nothing in this runbook touches production except the **read-only** checks in Phase 0.

## Hard rules
1. **Never run `supabase link`, `db push`, `db pull`, `migration repair` or `functions deploy` against the production project.**
   Production already fails the Supabase preview check with "Remote migration versions not found in local migrations directory":
   its migration history differs from this repo, so a history "repair" could mark migrations as applied without running them.
2. **Keep "Deploy to production" off** in Supabase (Settings > Integrations > GitHub) and the Vercel ignored-build step in place
   until the whole procedure, a human review and the production plan are done.
3. **Synthetic data only.** Do not copy production rows (profiles contain names, phones, addresses, Telegram ids).
   Schema only.
4. **No real notifications.** Do not set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `RESEND_API_KEY`, `VAPID_*` on the staging
   project. Without them the providers are skipped. Use only fake phone numbers and no real device.
5. Record every result in the table in section 9. A step is only "passed" if you ran it and saw the expected output.

## Phase 0 - read-only inspection of production (SQL editor, nothing is changed)
Run on `Agapsense` and keep the outputs (remove emails/keys/phones before sharing).
```sql
-- 0.1 migration history (compare with supabase/migrations/*.sql filenames)
select version, name from supabase_migrations.schema_migrations order by version;
-- 0.2 live auth helper
select pg_get_functiondef('public.get_auth_role'::regproc);
-- 0.3 live grants and policies on the tables the migrations touch
select grantee, privilege_type, table_name from information_schema.role_table_grants
 where table_schema='public' and table_name in ('alert_events','profiles','devices') order by 3,1,2;
select tablename, policyname, cmd, roles, qual, with_check from pg_policies
 where schemaname='public' and tablename in ('alert_events','profiles','devices') order by 1,2;
-- 0.4 columns of alert_events (the lifecycle migration adds resolved_by / resolution_source)
select column_name, data_type, is_nullable from information_schema.columns
 where table_schema='public' and table_name='alert_events' order by ordinal_position;
-- 0.5 data shape (counts only) - the supabase/maintenance/incident_lifecycle_dry_run.sql script is also read-only
select count(*) total,
       count(*) filter (where resolved_at is null) open_rows,
       count(*) filter (where incident_status in ('resolved','false_alarm') and resolved_at is null) closed_status_no_resolved_at,
       count(*) filter (where resolved_at is not null and incident_status in ('active','acknowledged','responding')) resolved_at_open_status
  from public.alert_events;
-- 0.6 duplicate open incidents (MUST return zero rows before the unique index can exist)
select device_id, count(*) from public.alert_events where resolved_at is null group by device_id having count(*) > 1;
```
**Decision gate:** if 0.1 shows versions that are not in the repo, or 0.2/0.3 differ from what the tests assume
(`get_auth_role` ignores `profiles.status`; `alert_events` has `incident_status`, `resolved_at`, `device_id`, `alert_tier`),
stop and report; the migrations may need adapting to the live schema before the dry run means anything.

## Phase 1 - create the staging project with the LIVE schema
1. Create a new free Supabase project (e.g. `agapsense-staging`). Note its project ref, DB password and connection string.
2. Dump the **production schema only** (no data) with the Supabase CLI or `pg_dump` (read-only on production):
   `supabase db dump --db-url "<PRODUCTION connection string>" --schema public -f live_schema.sql`
   (or `pg_dump --schema-only --no-owner --schema=public ...`). Do not use `--data-only`. Keep the file out of git.
3. Load it into **staging only**: `psql "<STAGING connection string>" -v ON_ERROR_STOP=1 -f live_schema.sql`.
   Check that the staging `public` schema now has the same tables, `get_auth_role`, policies and grants as production
   (re-run Phase 0.2-0.4 on staging and diff against production's output).
4. Record the baseline: run Phase 0.3 on staging and save it as `baseline_grants.txt`.

### Phase 1 alternative: build staging from the repo (no dump, no CLI)
`supabase/staging/` holds ready-made SQL for the NEW project's SQL editor (regenerate with `supabase/staging/build.sh`):
1. `staging_setup.sql` - every migration before `20261019` (the schema the repo describes). Refuses to run if `public.profiles`/`devices` already exist
   (so it cannot be applied to production by mistake), and creates a `_staging_marker` schema.
2. Then, one at a time, each followed by the Phase 3 checks: `01_profile_reads.sql`, `02_notification_ledger.sql`, `03_incident_lifecycle.sql`,
   gate, `04_open_incident_uniqueness.sql`. Each refuses to run unless the staging marker exists.
The SQL editor runs a pasted script as one implicit transaction, so an error means nothing from that file was applied; fix and re-run.
This tests the migrations on a real Supabase Postgres with the **repo's** schema, not production's drifted one; combine it with the Phase 0 comparison.
Verified locally only (a plain Postgres with a Supabase stub): all five files apply cleanly in order and both guards refuse as intended.

If the live schema cannot be dumped, fall back to the repo's migrations on staging, but then the result only covers the
repo's schema, **not** production; write that in the sign-off.

## Phase 2 - synthetic test data (staging only)
Create three users in the staging dashboard (Auth > Users): `admin`, `resident`, `responder` (+ a `pending` resident),
then insert matching `profiles` rows (roles `admin`/`resident`/`responder`, statuses `approved`/`approved`/`approved`/`pending`),
one `devices` row linked to the resident, and `alert_events` rows that exercise the lifecycle migration:
```sql
-- adapt column lists to the live schema from Phase 0.4; fake data only
insert into public.alert_events (device_id, alert_tier, incident_status, resolved_at) values
  ('<device-1>', 2, 'resolved',     null),                -- legacy: closed by status only (responder dashboard)
  ('<device-2>', 2, 'active',       now()),               -- legacy: closed by resolved_at only (admin / ingest auto-resolve)
  ('<device-3>', 1, 'active',       null);                -- genuinely open
```
Do not insert two open rows for the same device (that is exactly what the 5.1b precheck must catch; test it separately in 3.5).

## Phase 3 - apply, one migration at a time, in this order
The documented order is **ledger -> lifecycle -> gate -> uniqueness**; the Step 1 profile migration is independent and goes first.

> **Ordering trap:** by filename timestamp `20261020000100` (uniqueness) sorts **before** `20261021000000` (lifecycle). Any tool that applies
> migrations in version order (`supabase db push`, the GitHub integration) would apply the unique index before the lifecycle guard.
> `raise_alert()` has a stopgap for that, but the documented order is the safe one. Apply by hand in the order below. Before any
> production use, decide whether to renumber the lifecycle migration (needs approval; not done).

Run each file in the staging SQL editor (or `psql -v ON_ERROR_STOP=1 -1 -f <file>`), then run its checks before continuing.

### 3.1 `20261019000000_restrict_profile_reads.sql` (DB-002)
Checks (run as each user: `begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"<USER_UUID>","role":"authenticated"}',true); ...; rollback;`):
- resident: `select count(*) from profiles` = 1 (own row only).
- pending/rejected user: can still read own row (needed for the pending screen).
- approved admin: sees all profiles.
- `anon`: sees none; `anon` cannot execute `is_approved_admin()`.
- No recursion error (the old policy recursed through `get_auth_role()`).
Realtime on `profiles` (admin dashboard) is **not** covered by SQL; check it in the UI in Phase 5.

### 3.2 `20261020000000_alert_notification_ledger.sql` (5.1a, inert)
- `select to_regclass('public.alert_notifications')` not null; RLS enabled; `anon` and `authenticated` have no privileges on it.
- `claim_notification` / `complete_notification` executable by `service_role` only (try as `authenticated`: must fail).
- Functional (as `service_role`): first `claim_notification` for a key returns granted; the second concurrent claim does not;
  after `complete_notification(...,'sent')` the key is not claimable; a `failed` row is claimable again; a stale `pending` row
  (> 2 minutes) is reclaimable (documented possible duplicate).

### 3.3 `20261021000000_incident_lifecycle.sql` (6.1)
- New columns `resolved_by`, `resolution_source`; trigger `alert_events_lifecycle_guard`; constraint `alert_events_lifecycle_sync` (NOT VALID).
- Guard behaviour: `update ... set incident_status='resolved'` on an open row sets `resolved_at`; `set resolved_at=now()` on an open row
  sets status `resolved`; reopening or re-closing a closed row is rejected.
- `transition_incident(id,'acknowledged'|'responding'|'resolved'|'false_alarm', note)` as admin / responder / resident / anon:
  allowed transitions work, a repeat is a no-op, a closed incident cannot be reopened, a resident and anon are rejected.
- The 3 seeded legacy rows are **unchanged** (the migration does not touch existing rows). Re-run the section 0.5 counts and compare.

### 3.4 Gate - before the unique index
- Phase 0.6 query on **staging** returns zero rows. (Also run the real precheck on production, read-only, in Phase 0.)
- Everything in `docs/ALERT_DELIVERY_AND_INCIDENT_INVARIANTS.md` section 4 that can be checked on staging is ticked.
- **Backfill: do not run `supabase/maintenance/incident_lifecycle_backfill.sql`.** Run only the read-only `incident_lifecycle_dry_run.sql`
  and review its output. The backfill rules are an open owner decision (D6.3).

### 3.5 `20261020000100_alert_open_incident_uniqueness.sql` (5.1b)
- Negative test first: insert a second open row for one device on a **scratch copy** or inside a rolled-back transaction, then confirm the
  migration aborts with the duplicate message and creates nothing. (`supabase/tests/local/alert_migration_precheck.sh` is the local equivalent.)
- Then apply on the clean staging data: index `alert_events_one_open_per_device` exists; `raise_alert(...)` called twice for one device returns
  `created=true` then `created=false` with the same id; a tier-2 call after a tier-1 call raises the tier and never lowers it;
  `anon`/`authenticated` cannot execute `raise_alert`.
- Concurrency (optional, needs `psql` and `bash`): run 30 parallel `raise_alert` calls for one device; expect exactly one open row.

## Phase 4 - edge functions on staging (optional, no real notifications)
Only if you want the 5.2 path exercised end to end. Deploy to the **staging** ref only:
`supabase functions deploy trigger-alert send-push-notification confirm-sms-status --project-ref <STAGING_REF>`.
Secrets: leave all provider secrets unset. Optional: `ALERT_STRICT_DB=1` to check that a missing `raise_alert` yields 500, not legacy fallback.
Call `trigger-alert` with `curl` using the staging device key and a fake device; expect `200` with `alert_event_id`; repeat the call and
expect the same id with `created:false`. Confirm no provider is contacted (check the function logs).

## Phase 5 - frontend against staging (local only)
Run the app locally with staging credentials (do not deploy it):
`VITE_SUPABASE_URL=https://<STAGING_REF>.supabase.co VITE_SUPABASE_ANON_KEY=<staging anon key> npm run dev`.
Check as admin, responder and resident: login, admin Users/Devices/Device Status/Logs load without error banners; the responder dashboard
Acknowledge / Resolve / False alarm actions go through `transition_incident` and the incident closes with `resolved_at` set;
GPS labels (live within 15 minutes / last known / registered / unavailable) look right; admin dashboard still receives profile changes (Realtime).

## Phase 6 - rollback rehearsal on staging
Each migration header contains its rollback. Rehearse in reverse order and confirm the schema returns to `baseline_grants.txt`:
```sql
-- 5.1b
drop function if exists public.raise_alert(uuid, integer, double precision, double precision, double precision, double precision, boolean, text);  -- signature from the migration; confirm with \df first
drop index if exists public.alert_events_one_open_per_device;
-- 6.1
drop function if exists public.transition_incident(uuid, text, text);
drop trigger if exists alert_events_lifecycle_guard on public.alert_events;
drop function if exists public.alert_events_lifecycle_guard();
alter table public.alert_events drop constraint if exists alert_events_lifecycle_sync;
-- 5.1a
drop function if exists public.complete_notification(uuid, integer, text, text, text, text, text, text, boolean);  -- confirm signature with \df
drop function if exists public.claim_notification(uuid, integer, text, text, integer, interval);
drop table if exists public.alert_notifications;
-- 1
drop policy if exists "Users read own profile, approved admins read all" on public.profiles;
create policy "Approved users can read profiles" on public.profiles for select using (get_auth_role() is not null or id = auth.uid());
```
Use `\df public.raise_alert` and `\df public.complete_notification` to copy the exact argument lists before dropping. Dropping the lifecycle columns is optional.

## Phase 7 - what this does NOT prove
Real Realtime delivery at scale; real Telegram / Web Push / SMS providers; the compiled firmware and hardware; production data volume and
locks (the index creation takes a brief write lock on `alert_events`; check the table size in Phase 0); anything about production
that differs from the schema dump (extensions, cron jobs, vault secrets, dashboard-only settings).

## Phase 8 - promotion to production (separate approval, not part of this dry run)
1. Written sign-off on the results table; a human has reviewed the migrations; D6.3 (backfill), D5.7 and D6.5 decided.
2. Fresh production backup / snapshot; maintenance window; rollback statements ready.
3. Apply by hand, one file at a time, in the Phase 3 order, running the same checks; keep Vercel and the Supabase integration paused.
4. Deploy functions in the order `send-push-notification` -> `trigger-alert`; then the frontend; then firmware last.
5. Decide how production's migration history gets reconciled (this is how the preview check stops failing); do not use `migration repair` blindly.
6. Re-enable automatic deployment only if you want it.

## 9. Results table (fill in)
| Phase / check | Expected | Actual | Pass? | Date / who |
|---|---|---|---|---|
| 0.1 history differs from repo? | (note differences) | | | |
| 0.6 duplicate open incidents on production | 0 rows | | | |
| 3.1 profile reads (resident / pending / admin / anon) | 1 / own / all / none | | | |
| 3.2 ledger grants and claim semantics | per section | | | |
| 3.3 guard, transitions, legacy rows untouched | per section | | | |
| 3.4 gate checklist | all ticked | | | |
| 3.5 precheck abort, index, `raise_alert` created/joined | per section | | | |
| 4 edge functions (optional) | 200, same id, no provider call | | | |
| 5 UI as admin / responder / resident | no error banners, incidents close correctly | | | |
| 6 rollback returns to baseline | identical grants/policies | | | |

## 10. Teardown
Delete the staging project when finished (Supabase dashboard > Settings > General > Delete project) and delete `live_schema.sql`,
which contains the live schema (no data) but is still internal.

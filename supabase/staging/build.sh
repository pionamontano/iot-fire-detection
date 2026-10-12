#!/bin/bash
# Regenerates the staging SQL files from supabase/migrations. STAGING ONLY. Order of the four new migrations follows
# docs/ALERT_DELIVERY_AND_INCIDENT_INVARIANTS.md: profiles -> ledger -> lifecycle -> (gate) -> uniqueness.
set -euo pipefail
cd "$(dirname "$0")"; M=../migrations
guard_fresh() { cat <<'SQL'
-- GUARD: this file may only run on a brand-new, empty project. It aborts on a database that already has the app's tables.
do $g$ begin
  if to_regclass('public.profiles') is not null or to_regclass('public.devices') is not null then
    raise exception 'REFUSING TO RUN: public.profiles/devices already exist. This file is for a fresh staging project only.';
  end if;
end $g$;
create schema if not exists _staging_marker;
comment on schema _staging_marker is 'Marks this database as the throwaway staging project; created by staging_setup.sql';
SQL
}
guard_marker() { cat <<'SQL'
-- GUARD: only runs where staging_setup.sql was applied (staging marker present).
do $g$ begin
  if to_regnamespace('_staging_marker') is null then
    raise exception 'REFUSING TO RUN: staging marker missing. Run staging_setup.sql on the NEW staging project first; never run this on production.';
  end if;
end $g$;
SQL
}
{ echo "-- STAGING ONLY. Baseline = every migration before 20261019 (the schema the repo describes). Run on the NEW project, once."
  guard_fresh
  for f in $(ls $M/*.sql | sort); do b=$(basename "$f"); [[ "$b" < "20261019" ]] || continue; echo; echo "-- ===== $b ====="; cat "$f"; done
} > staging_setup.sql
one() { out=$1; src=$2; { echo "-- STAGING ONLY. $src. Run after the previous file, then run the checks in docs/STAGING_DRY_RUN_RUNBOOK.md."; guard_marker; echo; cat "$M/$src"; } > "$out"; }
one 01_profile_reads.sql        20261019000000_restrict_profile_reads.sql
one 02_notification_ledger.sql  20261020000000_alert_notification_ledger.sql
one 03_incident_lifecycle.sql   20261021000000_incident_lifecycle.sql
one 04_open_incident_uniqueness.sql 20261020000100_alert_open_incident_uniqueness.sql
ls -l *.sql

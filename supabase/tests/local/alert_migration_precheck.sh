#!/bin/bash
# The uniqueness migration must ABORT (changing nothing) when duplicate open incidents already exist,
# and succeed once they are resolved deliberately. Local throwaway database only.
# Usage: alert_migration_precheck.sh <dbname>     (needs PG* env for a local server)
set -u
DB=${1:-precheck_db}
HERE=$(cd "$(dirname "$0")" && pwd)
MIG="$HERE/../../migrations/20261020000100_alert_open_incident_uniqueness.sql"
UPTO=20261020000100 "$HERE/run_local_db_tests.sh" "$DB" >/dev/null 2>&1
P="psql -d $DB -v ON_ERROR_STOP=1 -qAt"
ok() { echo "$1: $2"; }
$P -c "insert into alert_events(device_id,alert_tier,co_ppm,temp_celsius) values ('10000000-0000-0000-0000-000000000001',1,1,1),('10000000-0000-0000-0000-000000000001',2,2,2)"
out=$(psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$MIG" 2>&1); rc=$?
[ $rc -ne 0 ] && echo "$out" | grep -q "duplicate open incidents exist" && ok PASS "migration aborts when duplicate open incidents exist" || ok FAIL "migration should abort on duplicates (rc=$rc)"
echo "$out" | grep -q "10000000-0000-0000-0000-000000000001 (2 open)" && ok PASS "error names the affected device and count" || ok FAIL "error should name the device"
[ "$($P -c "select count(*) from pg_indexes where indexname='alert_events_one_open_per_device'")" = "0" ] && ok PASS "no index was created" || ok FAIL "index must not exist after abort"
[ "$($P -c "select count(*) from pg_proc where proname='raise_alert'")" = "0" ] && ok PASS "raise_alert was not created" || ok FAIL "raise_alert must not exist after abort"
[ "$($P -c "select count(*) from alert_events")" = "2" ] && ok PASS "no data was deleted or modified" || ok FAIL "data must be untouched"
# deliberate resolution of the extra row, then re-run
$P -c "update alert_events set resolved_at = now() where id = (select id from alert_events where device_id='10000000-0000-0000-0000-000000000001' and resolved_at is null order by triggered_at limit 1)"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$MIG" >/dev/null 2>&1 && ok PASS "migration applies after duplicates are resolved deliberately" || ok FAIL "migration should apply after cleanup"
[ "$($P -c "select count(*) from pg_indexes where indexname='alert_events_one_open_per_device'")" = "1" ] && ok PASS "index now exists" || ok FAIL "index missing"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$MIG" >/dev/null 2>&1 && ok PASS "migration is re-runnable (idempotent)" || ok FAIL "migration not idempotent"

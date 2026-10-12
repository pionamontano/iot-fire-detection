#!/bin/bash
# Races N simultaneous sessions against raise_alert / claim_notification on an already-built local database
# (build it first:  ./run_local_db_tests.sh <db>).   Usage: alert_concurrency.sh <dbname> [N]
set -u
if [ "${1:-}" = "--worker" ]; then
  DB=$2; KIND=$3; I=$4; ARG=${5:-}
  case $KIND in
    raise) psql -d "$DB" -tAq -c "set role service_role; select created from raise_alert('10000000-0000-0000-0000-000000000002', 1 + ($I % 2), 300, 70, 14.8, 120.8, true, 'x')" 2>&1 ;;
    claim) psql -d "$DB" -tAq -c "set role service_role; select claim_notification('$ARG', 2, 'push', 'race-user')" 2>&1 ;;
  esac
  exit 0
fi
DB=${1:?db name}; N=${2:-30}; SELF=$(readlink -f "$0"); P="psql -d $DB -tAq"
OUT=$(mktemp -d)
check() { echo "$1: $2"; }
$P -c "update alert_events set resolved_at = coalesce(resolved_at, now()) where device_id = '10000000-0000-0000-0000-000000000002'"
seq 1 "$N" | xargs -P "$N" -I{} "$SELF" --worker "$DB" raise {} > "$OUT/raise.txt"
T=$(grep -c '^t' "$OUT/raise.txt"); F=$(grep -c '^f' "$OUT/raise.txt"); E=$(grep -ci 'error' "$OUT/raise.txt")
[ "$T" = 1 ] && [ "$F" = "$((N-1))" ] && [ "$E" = 0 ] && check PASS "$N racing raise_alert calls: exactly 1 created, $((N-1)) joined, 0 errors" || check FAIL "raise race: created=$T joined=$F errors=$E"
[ "$($P -c "select count(*) from alert_events where device_id='10000000-0000-0000-0000-000000000002' and resolved_at is null")" = 1 ] && check PASS "exactly one open incident remains" || check FAIL "more than one open incident"
[ "$($P -c "select alert_tier from alert_events where device_id='10000000-0000-0000-0000-000000000002' and resolved_at is null")" = 2 ] && check PASS "mixed tier-1/tier-2 callers converge on tier 2" || check FAIL "tier did not converge to 2"
AID=$($P -c "select id from alert_events where device_id='10000000-0000-0000-0000-000000000002' and resolved_at is null")
seq 1 "$N" | xargs -P "$N" -I{} "$SELF" --worker "$DB" claim {} "$AID" > "$OUT/claim.txt"
G=$(grep -c '^t' "$OUT/claim.txt"); E=$(grep -ci 'error' "$OUT/claim.txt")
[ "$G" = 1 ] && [ "$E" = 0 ] && check PASS "$N racing claims for one key: exactly 1 granted, 0 errors" || check FAIL "claim race: granted=$G errors=$E"
rm -f "$OUT/raise.txt" "$OUT/claim.txt"; rmdir "$OUT"

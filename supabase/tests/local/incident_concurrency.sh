#!/bin/bash
# Races simultaneous sessions through transition_incident() on an already-built local database
# (build it first:  ./run_local_db_tests.sh <db>).   Usage: incident_concurrency.sh <dbname> [N]
set -u
RESP=00000000-0000-0000-0000-0000000000c1; ADM=00000000-0000-0000-0000-0000000000a1
if [ "${1:-}" = "--worker" ]; then
  DB=$2; WHO=$3; INC=$4; TO=$5
  # VERBOSITY=sqlstate makes psql print only the SQLSTATE for an error, so classification is exact.
  OUTP=$(psql -d "$DB" -tAq -v VERBOSITY=sqlstate -c "select set_config('request.jwt.claim.sub','$WHO',false); select 'OK:'||incident_status from transition_incident('$INC','$TO')" 2>&1)
  if echo "$OUTP" | grep -q '^OK:'; then echo "$OUTP" | grep '^OK:' | tail -1
  else echo "ERR$(echo "$OUTP" | grep -o 'ERROR:  [0-9A-Z]*' | head -1 | sed 's/ERROR:  //')"; fi
  exit 0
fi
DB=${1:?db name}; N=${2:-20}; SELF=$(readlink -f "$0"); P="psql -d $DB -tAq"
OUT=$(mktemp -d); check() { echo "$1: $2"; }
mk() { $P -c "insert into devices(id,device_code,label,location_desc) values ('$1','$2','x','x') on conflict do nothing; insert into alert_events(device_id,alert_tier,co_ppm,temp_celsius) values ('$1',2,1,1) returning id" | head -1; }

# 1. N responders+admins acknowledge the same incident simultaneously
INC=$(mk 40000000-0000-0000-0000-000000000001 C-1)
for i in $(seq 1 "$N"); do echo "$([ $((i % 2)) = 0 ] && echo $ADM || echo $RESP)"; done | xargs -P "$N" -I{} "$SELF" --worker "$DB" {} "$INC" acknowledged > "$OUT/ack.txt"
[ "$(grep -c '^OK:acknowledged' "$OUT/ack.txt")" = "$N" ] && check PASS "$N simultaneous acknowledges all succeed idempotently" || check FAIL "ack results: $(sort "$OUT/ack.txt" | uniq -c | tr '\n' ' ')"
[ "$($P -c "select count(distinct acknowledged_by) from alert_events where id='$INC'")" = 1 ] && check PASS "exactly one acknowledger recorded (first wins, never overwritten)" || check FAIL "acknowledged_by changed"

# 2. resolved vs false_alarm race on the same acknowledged incident
for i in $(seq 1 "$N"); do echo "$([ $((i % 2)) = 0 ] && echo resolved || echo false_alarm)"; done | xargs -P "$N" -I{} "$SELF" --worker "$DB" "$RESP" "$INC" {} > "$OUT/race.txt"
FINAL=$($P -c "select incident_status from alert_events where id='$INC'")
WINNERS=$(grep '^OK:' "$OUT/race.txt" | sort -u | tr '\n' ' ')
[ "$FINAL" = resolved ] || [ "$FINAL" = false_alarm ] && check PASS "race ends in exactly one terminal status: $FINAL" || check FAIL "final status $FINAL"
[ "$WINNERS" = "OK:$FINAL " ] && check PASS "every successful caller saw the SAME final status (no caller was told a different outcome)" || check FAIL "successful callers saw: $WINNERS (final $FINAL)"
[ "$(grep -c '^OK:' "$OUT/race.txt")$(grep -c '^ERR55000' "$OUT/race.txt")" != "" ] && [ "$(( $(grep -c '^OK:' "$OUT/race.txt") + $(grep -c '^ERR55000' "$OUT/race.txt") ))" = "$N" ] && check PASS "all $N callers got either success or a clean 55000 rejection (no other errors)" || check FAIL "unexpected results: $(sort "$OUT/race.txt" | uniq -c | tr '\n' ' ')"
[ "$($P -c "select (resolved_at is not null and resolved_by is not null and resolution_source='responder') from alert_events where id='$INC'")" = t ] && check PASS "closure fields were written once and are consistent" || check FAIL "closure fields inconsistent"
rm -f "$OUT"/*.txt; rmdir "$OUT"

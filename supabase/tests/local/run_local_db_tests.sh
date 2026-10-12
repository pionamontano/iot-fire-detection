#!/bin/bash
# Builds a throwaway local Postgres database from supabase/migrations/*.sql on top of a Supabase stub,
# loads fixtures, then runs the given test file(s). Requires a local PostgreSQL server (PGHOST/PGPORT/PGUSER env).
# Usage: run_local_db_tests.sh <dbname> <test.sql> [more tests...]
#   Env: UPTO=<migration filename prefix> stops BEFORE that migration (to test the pre-change state).
#        EXTRA_SQL=<file> is applied after the migrations (e.g. to simulate live drift).
set -u
DB=$1; shift
HERE=$(cd "$(dirname "$0")" && pwd); MIG="$HERE/../../migrations"
PSQL="psql -q -v ON_ERROR_STOP=0"
dropdb --if-exists "$DB" 2>/dev/null; createdb "$DB"
$PSQL -d "$DB" -c "alter database \"$DB\" set search_path to \"\$user\", public, extensions"
$PSQL -d "$DB" -f "$HERE/stub_supabase.sql" 2>&1 | grep -v "already exists" 
for f in "$MIG"/*.sql; do
  b=$(basename "$f")
  if [ -n "${UPTO:-}" ] && [[ "$b" == "$UPTO"* || "$b" > "$UPTO" ]]; then break; fi
  $PSQL -d "$DB" -f "$f" 2>&1 | grep -E "ERROR" | sed "s|^|[$b] |"
done
[ -n "${EXTRA_SQL:-}" ] && $PSQL -d "$DB" -f "$EXTRA_SQL"   # optional: e.g. simulate a hand-modified live function
$PSQL -d "$DB" -f "$HERE/fixtures.sql"
rc=0
for t in "$@"; do echo "== $t"; psql -d "$DB" -v ON_ERROR_STOP=0 -f "$t" 2>&1 | grep -E "PASS|FAIL|ERROR" ; done

#!/bin/bash
# Runs the trigger-alert integration tests against a throwaway LOCAL PostgreSQL built from supabase/migrations.
# Requires a local PostgreSQL server reachable through the PG* environment variables (PGHOST/PGPORT/PGUSER).
# Never point this at a shared or production database: it creates and drops its own database and deletes alert rows.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
DB=${1:-agap_edge_it}
"$HERE/../../supabase/tests/local/run_local_db_tests.sh" "$DB" >/dev/null 2>&1
AGAP_PG_DB="$DB" node --test "$HERE/trigger_alert_pg.test.mjs"

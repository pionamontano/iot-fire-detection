#!/bin/bash
# Mutation check for the Step 5.3 wiring: each mutant breaks one behaviour in a COPY of src/ and the simulation
# must fail. Not part of run.sh's default pass (slow); run manually: ./mutation_check.sh
set -uo pipefail
cd "$(dirname "$0")"
W="${TMPDIR:-/tmp}/agap_mut"; rm -rf "$W"; mkdir -p "$W"
build() {
  g++ -std=c++17 -w -O1 -I"$W/src" -Istubs test_connectivity_sim.cpp "$W/src/connectivity.cpp" "$W/src/gsm.cpp" "$W/src/buzzer.cpp" stubs/identity_host.cpp -o "$W/sim" 2>"$W/err" || { echo "BUILD ERROR"; head "$W/err"; return 2; }
  "$W/sim" >"$W/out" 2>&1 || return 1
  mkdir -p "$W/host_tests"; cp test_sms_hold.cpp "$W/host_tests/"   # its "../src/..." include then resolves to the mutated copy
  g++ -std=c++17 -w -O1 "$W/host_tests/test_sms_hold.cpp" -o "$W/hold" 2>"$W/err" || { echo "BUILD ERROR"; head "$W/err"; return 2; }
  "$W/hold" >"$W/out" 2>&1
}
mutant() { # name, file, python-regex-from, to
  rm -rf "$W/src"; cp -r ../src "$W/src"
  python3 - "$W/src/$2" "$3" "$4" <<'PY'
import sys,re
p,a,b=sys.argv[1:4]; s=open(p,encoding='utf-8').read(); n=s.replace(a,b,1)
if n==s: sys.exit("MUTANT DID NOT APPLY: "+a)
open(p,'w',encoding='utf-8').write(n)
PY
  [ $? -eq 0 ] || { echo "?? $1: did not apply"; SURV=$((SURV+1)); return; }
  if build; then echo "SURVIVED  $1"; SURV=$((SURV+1)); else echo "killed    $1 ($(grep -c FAIL "$W/out") failing checks)"; fi
}
SURV=0
rm -rf "$W/src"; cp -r ../src "$W/src"; build && echo "baseline passes" || { echo "baseline FAILS"; exit 1; }
mutant "no retry service after the FSM"        connectivity.cpp "    attemptAlertPost(ctx, sd, fix);

    // ── Step 5:" "    // ── Step 5:"
mutant "no scheduler reset at TIER1->CLEAR"    connectivity.cpp 'CLOG("TIER 1 resolved → CLEAR");
                        ctx->alertRetry.reset();' 'CLOG("TIER 1 resolved → CLEAR");'
mutant "no scheduler reset at TIER2->CLEAR"    connectivity.cpp 'CLOG("TIER 2 resolved → CLEAR");
                        ctx->alertRetry.reset();' 'CLOG("TIER 2 resolved → CLEAR");'
mutant "no reset at new incident"              connectivity.cpp "                        ctx->alertRetry.reset();
                        ctx->incidentSeq++;" "                        ctx->incidentSeq++;"
mutant "incidentSeq never advances"            connectivity.cpp "                        ctx->incidentSeq++;
                        gsmSetIncidentSeq(ctx->incidentSeq);" "                        gsmSetIncidentSeq(ctx->incidentSeq);"
mutant "gsm seq not pushed"                    connectivity.cpp "                        gsmSetIncidentSeq(ctx->incidentSeq);
                        if (tier2Now)" "                        if (tier2Now)"
mutant "reassert -> onTierEntered"             connectivity.cpp "reassert(2, millis())" "onTierEntered(2, millis())"
mutant "tier1 not registered"                  connectivity.cpp "ctx->alertRetry.onTierEntered(1, millis());" ""
mutant "attempt ignores ONLINE"                connectivity.cpp "    if (ctx->deviceState != DeviceState::ONLINE) return;
    if (!ctx->alertRetry.shouldAttempt(now)) return;" "    if (!ctx->alertRetry.shouldAttempt(now)) return;"
mutant "attempt ignores scheduler"             connectivity.cpp "    if (!ctx->alertRetry.shouldAttempt(now)) return;" ""
mutant "outcome always success"                connectivity.cpp "ctx->alertRetry.onResult(outcome, millis());" "ctx->alertRetry.onResult(agap::PostOutcome::Success, millis());"
mutant "outcome always transient"              connectivity.cpp "ctx->alertRetry.onResult(outcome, millis());" "ctx->alertRetry.onResult(agap::PostOutcome::Transient, millis());"
mutant "SMS even when delivered online"        connectivity.cpp "if (ctx->alertRetry.ackedTier() >= 2) {" "if (false) {"
mutant "no SMS when the POST failed"           connectivity.cpp "if (ctx->alertRetry.ackedTier() >= 2) {" "if (true) {"
mutant "SMS requeue removed"                   connectivity.cpp "if (!ctx->smsHold.requeue(e, millis())) CLOG" "if (false) CLOG"
mutant "no break after failed report"          connectivity.cpp "break;  // do not hammer" "// do not hammer"
mutant "report with ctx id, ignoring entry"    connectivity.cpp "const char* id = e.eventId[0] ? e.eventId : ctx->lastAlertEventId;" "const char* id = ctx->lastAlertEventId;"
mutant "hold not drained while offline"        connectivity.cpp "    for (int i = 0; i < SMS_QUEUE_SIZE; i++) {
        if (!gsmPopSmsResult" "    if (ctx->deviceState != DeviceState::ONLINE) return;
    for (int i = 0; i < SMS_QUEUE_SIZE; i++) {
        if (!gsmPopSmsResult"
mutant "hold seq from wrong field"             connectivity.cpp "ctx->smsHold.hold(role, alertEventId, success, seq, millis())" "ctx->smsHold.hold(role, alertEventId, success, ctx->incidentSeq, millis())"
mutant "WDT not fed before alert POST"         connectivity.cpp "    esp_task_wdt_reset();
    int code = postAlert" "    int code = postAlert"
mutant "WDT not fed before SMS report"         connectivity.cpp "        esp_task_wdt_reset();
        int code = postSmsStatus" "        int code = postSmsStatus"
mutant "gsm seq snapshot removed"              gsm.cpp "job->incidentSeq = s_incidentSeq;" "job->incidentSeq = 0;"
mutant "gsm result loses seq"                  gsm.cpp "res->incidentSeq = incidentSeq;" "res->incidentSeq = 0;"
mutant "WDT not fed before telemetry"         connectivity.cpp "            esp_task_wdt_reset();
            int code = postTelemetry" "            int code = postTelemetry"
mutant "report retry without backoff"          sms_result_hold.h "r.notBeforeMs = nowMs + delay;" "r.notBeforeMs = nowMs;"
mutant "holder ignores backoff when taking"    sms_result_hold.h "const bool due = static_cast<int32_t>(nowMs - e.notBeforeMs) >= 0;" "const bool due = true;"
mutant "holder never expires"                  sms_result_hold.h "if (expired || orphaned) removeAt(i); else ++i;" "if (orphaned) removeAt(i); else ++i;"
mutant "holder keeps orphans"                  sms_result_hold.h "if (expired || orphaned) removeAt(i); else ++i;" "if (expired) removeAt(i); else ++i;"
mutant "holder TTL off by one (>=)"            sms_result_hold.h "nowMs - e.heldSinceMs) > ttlMs()" "nowMs - e.heldSinceMs) >= ttlMs()"
mutant "holder attempt budget +1"              sms_result_hold.h "if (r.failedReports + 1 >= MAX_FAILED_REPORTS) return false;" "if (r.failedReports + 1 > MAX_FAILED_REPORTS) return false;"
mutant "holder drops NEWEST when full"         sms_result_hold.h "if (n_ == CAPACITY) { removeAt(0); dropped = true; }" "if (n_ == CAPACITY) { return true; }"
echo "survivors: $SURV (see README: expected survivors are equivalent/redundant mutants)"

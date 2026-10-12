#!/bin/bash
# Host-side firmware logic tests (no hardware, no PlatformIO needed). Requires g++.
set -euo pipefail
cd "$(dirname "$0")"
OUT="${TMPDIR:-/tmp}/agap_host_tests"; mkdir -p "$OUT"
echo "== header portability: C++11, pedantic, warnings as errors"
printf '#include "../src/alert_retry.h"\nint main(){agap::AlertRetryScheduler s; return s.pending();}\n' > "$OUT/portability.cpp"
g++ -std=c++11 -Wall -Wextra -Wpedantic -Werror -I. -fsyntax-only "$OUT/portability.cpp"
echo "ok"
echo "== alert_retry tests (C++17, ASan+UBSan, warnings as errors)"
g++ -std=c++17 -Wall -Wextra -Werror -O1 -g -fsanitize=address,undefined -fno-sanitize-recover=undefined test_alert_retry.cpp -o "$OUT/test_alert_retry"
"$OUT/test_alert_retry"
echo "== sms_result_hold tests (C++17, ASan+UBSan)"
g++ -std=c++17 -Wall -Wextra -Werror -O1 -g -fsanitize=address,undefined -fno-sanitize-recover=undefined test_sms_hold.cpp -o "$OUT/test_sms_hold"
"$OUT/test_sms_hold"
echo "== connectivity/gsm simulation (real sources, stubbed hardware; ASan+UBSan)"
g++ -std=c++17 -w -O1 -g -fsanitize=address,undefined -fno-sanitize-recover=undefined -Istubs -I../src test_connectivity_sim.cpp ../src/connectivity.cpp ../src/gsm.cpp -o "$OUT/test_connectivity_sim"
"$OUT/test_connectivity_sim" > "$OUT/sim.log" || { cat "$OUT/sim.log"; exit 1; }
if [ "${ORIG:-0}" = "1" ]; then
  echo "== negative control: same simulation against the pre-5.3 sources (failures EXPECTED)"
  O="$OUT/orig_src"; rm -rf "$O"; mkdir -p "$O"
  for f in connectivity.cpp connectivity.h gsm.cpp gsm.h sensors.h gps.h config.example.h; do git show "${ORIG_REF:-HEAD}:firmware/agapsense-firmware/src/$f" > "$O/$f"; done
  sed 's#"../../src/config.example.h"#"config.example.h"#' stubs/config.h > "$O/config.h"
  g++ -std=c++17 -w -O1 -I"$O" -Istubs test_connectivity_sim.cpp "$O/connectivity.cpp" "$O/gsm.cpp" -o "$OUT/sim_orig"
  "$OUT/sim_orig" | tail -1 || true
fi

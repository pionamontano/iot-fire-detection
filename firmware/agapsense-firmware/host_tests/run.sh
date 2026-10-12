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

# Host-side firmware logic tests

Pure-logic tests that run on a normal computer with `g++` (no ESP32, no PlatformIO, no network):

```
./run.sh
```

Currently covers `src/alert_retry.h` (retry/backoff policy for the alert POST): HTTP outcome classification,
the 5/10/20/40/60 s backoff, escalation, CLEAR/reboot behaviour, permanent-rejection give-up, millis() wrap-around,
an attempt-storm bound, and randomised invariants. It compiles the header as C++11 (pedantic, warnings as errors) and runs
the tests under AddressSanitizer + UBSan.

**Scope:** `alert_retry.h` is not yet included by `connectivity.cpp` (planned for Step 5.3), so firmware behaviour is
unchanged. These tests prove the policy logic only; they do not prove the compiled firmware, Wi-Fi/TLS, the SIM800L, or
the server. Those need hardware-in-the-loop checks.

The directory is deliberately not named `test/` so PlatformIO's `pio test` does not try to build it for the board.

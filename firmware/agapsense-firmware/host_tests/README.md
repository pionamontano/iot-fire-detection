# Host-side firmware logic tests

Pure-logic tests that run on a normal computer with `g++` (no ESP32, no PlatformIO, no network):

```
./run.sh
```

Covers:
- `src/alert_retry.h` (retry/backoff policy for the alert POST), `src/sms_result_hold.h` (late-binding of SMS results): pure unit tests, ASan+UBSan;
  `alert_retry.h` is also compiled as C++11 (pedantic, warnings as errors).
- `test_connectivity_sim.cpp`: **a simulation of the real `src/connectivity.cpp` and `src/gsm.cpp`** compiled on the host against test doubles in
  `stubs/` (fake clock, Wi-Fi, scripted HTTPS backend, scripted SIM800L, minimal ArduinoJson stand-in). 31 scenarios (S01-S18 and the review cases R01-R12): outage/recovery, 5xx, permanent 400,
  escalation, CLEAR cancel, new incident isolation, offline->online, SMS-report retry, reboot, lost response, hour-long outage, etc.
  Tasks run sequentially, not as FreeRTOS tasks.
- `mutation_check.sh` (manual): breaks the wiring and the SMS holder in a copy of `src/` (29 mutants; connectivity/gsm via the simulation, holder via its unit tests). Expected survivors: `no reset at new incident` (redundant with the reset at CLEAR) and `WDT not fed before SMS report` (redundant with the telemetry feed in the model).
- Negative control: compiling the simulation against the pre-5.3 sources (`ORIG=1 ORIG_REF=<commit before 5.3> ./run.sh`) fails a number of checks (18 of 67 at the time of writing, the 67 being those it can compile).

**Scope:** these prove the logic and wiring only; they do not prove the compiled firmware on the ESP32 (PlatformIO build not run), real Wi-Fi/TLS/ArduinoJson,
FreeRTOS interleaving, the SIM800L, or the server. Those need hardware-in-the-loop checks.

The directory is deliberately not named `test/` so PlatformIO's `pio test` does not try to build it for the board.

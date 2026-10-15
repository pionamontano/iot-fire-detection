#pragma once
// ============================================================
// diag_server.h — Diagnostic-build-only HTTP log viewer + ArduinoOTA
//
// diagServerInit() is always callable from main.cpp (no #ifdef needed at
// the call site) — it's a no-op unless ENABLE_DIAG_SERVER is set (see
// env:esp32dev_mq7_5v_diag in platformio.ini). Spawns its own FreeRTOS
// task that waits for Wi-Fi, then serves a live-updating /log page (reads
// diag_log.h's ring buffer) and listens for ArduinoOTA reflashes — the
// same two things test_components.cpp's bench harness has, but running
// the real production firmware instead of a separate sketch.
//
// This adds an unauthenticated network service and an extra always-on
// task to safety-critical fire-detection firmware. Meant for active bench
// debugging only — revert to env:esp32dev_mq7_5v (no diag server) once
// done, rather than leaving it running unattended long-term.
// ============================================================

void diagServerInit();

#pragma once
// ============================================================
// diag_log.h — Shared HTTP-visible log ring buffer (diagnostic builds only)
//
// diagLogAdd() is always callable, so every module's existing *LOG macro
// (LOG/CLOG/SLOG/GLOG/GSMLOG/ILOG) can route through it uniformly without
// needing its own #ifdef — but it only buffers anything, and only costs
// the ~9.6KB of RAM for the ring buffer, in diagnostic builds
// (ENABLE_DIAG_SERVER build flag; see env:esp32dev_mq7_5v_diag in
// platformio.ini). In a regular build it's a no-op the compiler inlines
// away. See diag_server.h for the HTTP viewer that exposes it.
// ============================================================

#include <Arduino.h>

void diagLogAdd(const char* fmt, ...);

#ifdef ENABLE_DIAG_SERVER
String diagLogDump();
#endif

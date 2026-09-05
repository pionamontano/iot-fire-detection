#pragma once
// ============================================================
// connectivity.h — Wi-Fi, HTTPS, Alert FSM, Indicators  (v2.1)
//
// Changes from v2.0:
//   + Tier 1 now also POSTs to trigger-alert (alert_tier=1), matching
//     Tier 2 — fixes "Warnings Today" stat + Tier 1 history
//   ~ postAlert() takes an alertTier param and includes it in the payload
//   ~ Telegram sending removed from firmware entirely — trigger-alert
//     Edge Function calls the Bot API server-side (no bot token on
//     hardware, real resolved address via backend Nominatim access,
//     telegram_sent set only after backend's own Bot API call)
//
// Changes from v1.0:
//   + DeviceState uses WiFiManager captive portal on first boot
//   + AlertTier replaces AlertState/AlertType: CLEAR, TIER1, TIER2
//   + LED and buzzer driven from FSM transitions
//   + Blue LED blinks while connecting, solid while ONLINE
//   + SMS 5-minute debounce (lastSmsSent_ms)
//   + on_battery flag in telemetry payload
//   + sensor_ready flag in both payloads
//   + Telemetry posted every 30 s regardless of MQ-7 phase
//   + mq7_phase field in telemetry payload
//   + X-Device-Key header on all Edge Function requests
//   + fetchRemoteConfig(): pull thresholds + SMS numbers from DB
//   + Runtime threshold variables (co_alert_ppm, temp_alert_c)
//   + Runtime SMS number storage (ownerNumber, bfpNumber)
// ============================================================

#include <Arduino.h>
#include "config.h"
#include "sensors.h"
#include "gps.h"

// ── Device State ───────────────────────────────────────────
enum class DeviceState { ONLINE, DEGRADED, OFFLINE };

// ── Alert Tier (two-tier per spec) ─────────────────────────
// TIER1: either sensor alone exceeds alert threshold
//        → yellow LED + trigger-alert POST (tier=1, no SMS)
//          backend sends the Telegram warning
// TIER2: both sensors simultaneously exceed alert threshold
//        → red LED + buzzer + trigger-alert POST (tier=2) + owner SMS + BFP SMS
//          backend sends the Telegram alert
enum class AlertTier { CLEAR, TIER1, TIER2 };

// ── Connectivity Context ───────────────────────────────────
struct ConnectivityCtx {
    DeviceState deviceState;
    AlertTier   alertTier;
    int         alertRiseCount;       // consecutive readings above threshold
    int         alertFallCount;       // consecutive readings below threshold
    uint32_t    lastWifiRetry_ms;
    uint32_t    lastTelemetry_ms;
    uint32_t    lastConfigFetch_ms;
    uint32_t    lastSmsSent_ms;       // 5-minute SMS debounce
    uint32_t    lastBlueBlink_ms;     // blue LED blink timer
    bool        blueLedState;         // current blue LED output state
    int         batteryMv;
    int         rssi;
    // Runtime-overridable thresholds (fetched from DB at startup)
    float       co_alert_ppm;
    float       temp_alert_c;
    // Runtime SMS recipient numbers (fetched from DB at startup)
    char        ownerNumber[20];
    char        bfpNumber[20];
};

// ── Public API ─────────────────────────────────────────────

/** Initialise indicator GPIOs, attempt Wi-Fi via WiFiManager. */
void connectivityInit(ConnectivityCtx* ctx);

/** Main update — run from connectivity task every 2 s. */
void connectivityUpdate(ConnectivityCtx* ctx,
                        SensorData* sensorData, SemaphoreHandle_t sensorMtx,
                        GpsFix*     gpsFix,     SemaphoreHandle_t gpsMtx);

/** POST periodic telemetry to ingest-reading. Returns HTTP code. */
int postTelemetry(const SensorData& sd, const GpsFix& fix,
                  int batteryMv, int rssi,
                  const char* mq7Phase);

/** POST an alert (Tier 1 or Tier 2) to trigger-alert. Backend sends
 *  Telegram and resolves the address; alertTier is 1 or 2.
 *  Returns HTTP code. */
int postAlert(const SensorData& sd, const GpsFix& fix, int alertTier);

/** GET remote config from get-device-config Edge Function. */
bool fetchRemoteConfig(ConnectivityCtx* ctx);

/** Read battery voltage ADC and return millivolts. */
int  readBatteryMv();

/** Return true if both sensors exceed their alert thresholds. */
bool isTier2(float co_ppm, float temp_c, const ConnectivityCtx* ctx);

/** Return true if either sensor (but not both) exceeds alert threshold. */
bool isTier1(float co_ppm, float temp_c, const ConnectivityCtx* ctx);

const char* deviceStateStr(DeviceState s);
const char* alertTierStr(AlertTier t);

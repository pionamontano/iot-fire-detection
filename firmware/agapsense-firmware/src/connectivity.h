#pragma once
// ============================================================
// connectivity.h — Wi-Fi, HTTPS, Alert FSM, Indicators  (v2.0)
//
// Changes from v1.0:
//   + DeviceState uses WiFiManager captive portal on first boot
//   + AlertTier replaces AlertState/AlertType: CLEAR, TIER1, TIER2
//   + LED and buzzer driven from FSM transitions
//   + Blue LED blinks while connecting, solid while ONLINE
//   + SMS 5-minute debounce (lastSmsSent_ms)
//   + Telegram HTTPS POST for Tier 1 and Tier 2
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
//        → yellow LED + Telegram warning (no SMS)
// TIER2: both sensors simultaneously exceed alert threshold
//        → red LED + buzzer + Telegram alert + owner SMS + BFP SMS
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

/** POST Tier 2 alert to trigger-alert. Returns HTTP code. */
int postAlert(const SensorData& sd, const GpsFix& fix);

/** Send Telegram message via Bot API. Returns HTTP code. */
int sendTelegram(const char* message);

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

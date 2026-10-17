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
#include "alert_retry.h"
#include "sms_result_hold.h"

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
    // alert_events.id (uuid) of the most recent postAlert() call —
    // links postSmsStatus() reports back to the exact row.
    char        lastAlertEventId[40];
    // address_resolved / triggered_at from the most recent postAlert()
    // response — backend-computed since the device has no reverse-geocoding
    // or RTC/NTP of its own. Included in the Tier 2 SMS bodies (SW-2.2.2).
    char        lastAddressResolved[100];
    char        lastTriggeredAt[24];
    // Step 5.3: retry/backoff for the trigger-alert POST (alert_retry.h). One instance per incident; reset
    // when the FSM returns to CLEAR.
    agap::AlertRetryScheduler alertRetry;
    // Step 5.3: SMS delivery results waiting for the incident's alert_event_id (or for connectivity) so they
    // can be reported late (sms_result_hold.h).
    agap::SmsResultHolder     smsHold;
    // Incremented on every CLEAR -> TIERx transition; tags SMS jobs so a result is only ever bound to the
    // incident it belongs to.
    uint32_t    incidentSeq;
    // Sensor-fault state as last logged (TEMP_STALE_MS / CO_STALE_MS), so a fault and its recovery are
    // each logged once instead of every tick.
    bool        coFault;
    bool        tempFault;
    // Sensor reading times (SensorData::last_*_ms) at the last counted rise/fall step, so the debounce
    // counts new readings rather than FSM ticks.
    uint32_t    stepCoMs;
    uint32_t    stepTempMs;
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
 *  Telegram and resolves the address; alertTier is 1 or 2. Parses
 *  alert_event_id / owner_contact / bfp_contact from the response and
 *  stores them in ctx. Returns HTTP code. */
int postAlert(ConnectivityCtx* ctx, const SensorData& sd, const GpsFix& fix, int alertTier);

/** Report one SMS delivery outcome to confirm-sms-status.
 *  role is "owner" or "bfp"; alertEventId links to the exact
 *  alert_events row. Returns HTTP code. */
int postSmsStatus(const char* role, bool success, const char* alertEventId);

/** GET remote config from get-device-config Edge Function. If an
 *  OTA update is offered, sensorData/sensorMtx (when non-null) let
 *  it bail out early rather than block through a newly-forming
 *  fire alert — pass null at boot, where no alert FSM is running
 *  yet anyway. */
bool fetchRemoteConfig(ConnectivityCtx* ctx,
                       SensorData* sensorData = nullptr,
                       SemaphoreHandle_t sensorMtx = nullptr);

/** Read battery voltage ADC and return millivolts. */
int  readBatteryMv();

/** Return true if both sensors exceed their alert thresholds. A sensor that
 *  has never produced a reading (coValid/tempValid false) never counts. */
bool isTier2(float co_ppm, float temp_c, const ConnectivityCtx* ctx,
             bool coValid = true, bool tempValid = true);

/** Return true if either sensor (but not both) exceeds alert threshold. A
 *  sensor with no reading is ignored, so the other one still alerts alone. */
bool isTier1(float co_ppm, float temp_c, const ConnectivityCtx* ctx,
             bool coValid = true, bool tempValid = true);

const char* deviceStateStr(DeviceState s);
const char* alertTierStr(AlertTier t);

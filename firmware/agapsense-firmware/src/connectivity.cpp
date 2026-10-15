// ============================================================
// connectivity.cpp — Wi-Fi, HTTPS, Alert FSM, OTA  (v2.5)
//
// Changes from v2.4 (this file):
//  [24] postTelemetry() now includes firmware_version (compiled-in
//       FIRMWARE_VERSION) so ingest-reading can record what a device
//       is actually running — the admin UI compares this against the
//       target firmware_version it set, instead of assuming an OTA
//       push succeeded just because it was requested.
//
// Changes from v2.3 (this file):
//  [23] performOtaUpdate(): HTTPS OTA via Update.h, triggered from
//       fetchRemoteConfig() when firmware_version differs from the
//       compiled-in FIRMWARE_VERSION. Wi-Fi only, gated to
//       alertTier == CLEAR so a live alert is never interrupted.
//
// Changes from v2.2 (this file):
//  [18] alert_event_id parsed from trigger-alert response and stored
//       in ctx->lastAlertEventId — threads through to postSmsStatus()
//       so confirm-sms-status can update the exact alert_events row
//  [19] postSmsStatus() implemented — reports SMS delivery outcome
//       (role + success + alert_event_id) to confirm-sms-status
//  [20] Step 6 SMS drain restored in connectivityUpdate() —
//       gsmPopSmsResult() → postSmsStatus() loop runs every tick
//  [21] alertRiseCount reset on CLEAR → TIER1 entry — without this,
//       TIER1 → TIER2 escalation debounce was effectively 1 reading
//  [22] lastAlertEventId zeroed in connectivityInit()
//
// Changes from v2.1:
//   + setCACert(SUPABASE_ROOT_CA) replaces setInsecure() everywhere
//   + ArduinoJson replaces manual indexOf() JSON parsing
//   + postAlert() takes ConnectivityCtx* — parses and updates
//     ownerNumber / bfpNumber from trigger-alert response
//   + alertRiseCount reset on TIER1 → TIER2 escalation
//   + Field names fixed: temp_celsius, latitude, longitude, tier
//
// Changes from v2.0:
//  [15] Tier 1 now POSTs to trigger-alert (alert_tier=1)
//  [16] Telegram sending removed from firmware
//  [17] SMS queued via gsmQueueSms()/gsmProcessQueue()
//
// Changes from v1.0:
//   [1] WiFiManager captive portal on first boot
//   [2] Two-tier alert (TIER1/TIER2)
//   [3] Tier 1 → yellow LED + trigger-alert POST only
//   [4] Tier 2 → red LED + buzzer + trigger-alert POST + SMS
//   [5] Blue LED status indicator
//   [6] SMS 5-minute debounce
//   [8] on_battery flag in telemetry payload
//   [9] sensor_ready flag in both payloads
//  [10] mq7_phase field in telemetry payload
//  [11] Telemetry posted every 30 s regardless of MQ-7 phase
//  [12] X-Device-Key header on all Edge Function requests
//  [13] fetchRemoteConfig(): pulls thresholds + SMS numbers from DB
//  [14] Alert auto-resolution: TIER1/TIER2 → CLEAR after safe readings
// ============================================================

#include <ArduinoJson.h>

#include "connectivity.h"
#include "gsm.h"
#include "identity.h"

#include <WiFi.h>
#include <WiFiManager.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Update.h>
#include <esp_task_wdt.h>
#include <functional>
#include "diag_log.h"

#if DEBUG_MODE
  #define CLOG(fmt, ...) Serial.printf("[CONN] " fmt "\n", ##__VA_ARGS__)
#elif ENABLE_DIAG_SERVER
  #define CLOG(fmt, ...) diagLogAdd("[CONN] " fmt, ##__VA_ARGS__)
#else
  #define CLOG(fmt, ...)
#endif

// ── Helpers ────────────────────────────────────────────────
const char* deviceStateStr(DeviceState s) {
    switch (s) {
        case DeviceState::ONLINE:   return "ONLINE";
        case DeviceState::DEGRADED: return "DEGRADED";
        case DeviceState::OFFLINE:  return "OFFLINE";
        default:                    return "UNKNOWN";
    }
}

const char* alertTierStr(AlertTier t) {
    switch (t) {
        case AlertTier::CLEAR: return "CLEAR";
        case AlertTier::TIER1: return "TIER1";
        case AlertTier::TIER2: return "TIER2";
        default:               return "UNKNOWN";
    }
}

// ── Internal forward declarations ──────────────────────────
static void fireTier1Warning(ConnectivityCtx* ctx, const SensorData& sd, const GpsFix& fix);
static void fireTier2Alert(ConnectivityCtx* ctx, const SensorData& sd, const GpsFix& fix);
static void attemptAlertPost(ConnectivityCtx* ctx, const SensorData& sd, const GpsFix& fix);
static void serviceSmsReports(ConnectivityCtx* ctx);

// ── Indicator helpers ──────────────────────────────────────
static void indicatorsOff() {
    digitalWrite(LED_YELLOW_PIN, LOW);
    digitalWrite(LED_RED_PIN,    LOW);
    digitalWrite(BUZZER_PIN,     LOW);
}

static void setTier1Indicators() {
    digitalWrite(LED_YELLOW_PIN, HIGH);
    digitalWrite(LED_RED_PIN,    LOW);
    digitalWrite(BUZZER_PIN,     LOW);
}

static void setTier2Indicators() {
    digitalWrite(LED_YELLOW_PIN, LOW);
    digitalWrite(LED_RED_PIN,    HIGH);
    digitalWrite(BUZZER_PIN,     HIGH);
}

// Blue LED blink handler — call every task tick when not ONLINE
static void updateBlueLed(ConnectivityCtx* ctx, bool online) {
    if (online) {
        digitalWrite(LED_BLUE_PIN, HIGH);
        ctx->blueLedState     = true;
        ctx->lastBlueBlink_ms = millis();
    } else if (ctx->deviceState == DeviceState::OFFLINE) {
        digitalWrite(LED_BLUE_PIN, LOW);
    } else {
        // DEGRADED → blink 500 ms
        uint32_t now = millis();
        if (now - ctx->lastBlueBlink_ms >= 500) {
            ctx->blueLedState = !ctx->blueLedState;
            digitalWrite(LED_BLUE_PIN, ctx->blueLedState ? HIGH : LOW);
            ctx->lastBlueBlink_ms = now;
        }
    }
}

// ── Threshold evaluators ───────────────────────────────────
bool isTier2(float co_ppm, float temp_c, const ConnectivityCtx* ctx) {
    return (co_ppm >= ctx->co_alert_ppm) && (temp_c >= ctx->temp_alert_c);
}

bool isTier1(float co_ppm, float temp_c, const ConnectivityCtx* ctx) {
    bool coHigh   = (co_ppm >= ctx->co_alert_ppm);
    bool tempHigh = (temp_c >= ctx->temp_alert_c);
    return (coHigh || tempHigh) && !(coHigh && tempHigh);
}

// ── Battery ADC ────────────────────────────────────────────
int readBatteryMv() {
    const int N = 16;
    long sum = 0;
    for (int i = 0; i < N; i++) { sum += analogRead(BATTERY_ADC_PIN); delay(1); }
    float measuredMv = (float)(sum / N) * ADC_VREF_MV / ADC_MAX_RAW;
    return (int)(measuredMv * BATTERY_DIVIDER_RATIO);
}

// ── HTTPS POST helper ──────────────────────────────────────
static int httpsPost(const char* endpoint, const char* payload) {
    if (!identityConfigured()) { CLOG("ERROR: device identity not provisioned — POST skipped"); return -1; }
    WiFiClientSecure client;
    client.setCACert(SUPABASE_ROOT_CA);
    client.setTimeout(HTTP_TIMEOUT_MS / 1000);

    HTTPClient http;
    String url = String(SUPABASE_URL) + endpoint;
    if (!http.begin(client, url)) {
        CLOG("ERROR: http.begin failed for %s", endpoint);
        return -1;
    }
    http.addHeader("Content-Type",  "application/json");
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
    http.addHeader("X-Device-Key",  deviceApiKey());
    http.setTimeout(HTTP_TIMEOUT_MS);

    CLOG("POST %s → %s", endpoint, payload);
    int code = http.POST(payload);
    if (code > 0) {
        CLOG("Response %d", code);
        if (code != 200 && code != 201) CLOG("Body: %s", http.getString().c_str());
    } else {
        CLOG("ERROR: %s", http.errorToString(code).c_str());
    }
    http.end();
    return code;
}

// ── Telemetry POST ─────────────────────────────────────────
int postTelemetry(const SensorData& sd, const GpsFix& fix,
                  int batteryMv, int rssi, const char* mq7Phase)
{
    bool on_battery = (batteryMv < ON_BATTERY_THRESHOLD_MV);

    char payload[512];
    snprintf(payload, sizeof(payload),
        "{"
          "\"device_id\":\"%s\","
          "\"co_ppm\":%.2f,"
          "\"temp_celsius\":%.2f,"
          "\"latitude\":%.6f,"
          "\"longitude\":%.6f,"
          "\"gps_valid\":%s,"
          "\"battery_mv\":%d,"
          "\"rssi\":%d,"
          "\"on_battery\":%s,"
          "\"sensor_ready\":%s,"
          "\"mq7_phase\":\"%s\","
          "\"firmware_version\":\"%s\""
        "}",
        deviceId(),
        sd.co_ppm, sd.temperature_c,
        fix.lat, fix.lng,
        fix.valid ? "true" : "false",
        batteryMv, rssi,
        on_battery      ? "true" : "false",
        sd.sensor_ready ? "true" : "false",
        mq7Phase,
        FIRMWARE_VERSION
    );
    return httpsPost(ENDPOINT_INGEST, payload);
}

// ── Alert POST ─────────────────────────────────────────────
// Parses owner_contact, bfp_contact, and alert_event_id from the
// trigger-alert response and stores them in ctx for use by the SMS
// queue and confirm-sms-status confirmation flow.
int postAlert(ConnectivityCtx* ctx, const SensorData& sd, const GpsFix& fix, int alertTier) {
    if (!identityConfigured()) { CLOG("ERROR: device identity not provisioned — alert POST skipped"); return -1; }
    char payload[384];
    snprintf(payload, sizeof(payload),
        "{"
          "\"device_id\":\"%s\","
          "\"co_ppm\":%.2f,"
          "\"temp_celsius\":%.2f,"
          "\"latitude\":%.6f,"
          "\"longitude\":%.6f,"
          "\"gps_valid\":%s,"
          "\"alert_type\":\"fire\","
          "\"tier\":%d,"
          "\"sensor_ready\":%s"
        "}",
        deviceId(),
        sd.co_ppm, sd.temperature_c,
        fix.lat, fix.lng,
        fix.valid ? "true" : "false",
        alertTier,
        sd.sensor_ready ? "true" : "false"
    );

    WiFiClientSecure client;
    client.setCACert(SUPABASE_ROOT_CA);
    client.setTimeout(HTTP_TIMEOUT_MS / 1000);

    HTTPClient http;
    String url = String(SUPABASE_URL) + ENDPOINT_ALERT;
    if (!http.begin(client, url)) {
        CLOG("ERROR: http.begin failed for %s", ENDPOINT_ALERT);
        return -1;
    }
    http.addHeader("Content-Type",  "application/json");
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
    http.addHeader("X-Device-Key",  deviceApiKey());
    http.setTimeout(HTTP_TIMEOUT_MS);

    CLOG("POST %s → %s", ENDPOINT_ALERT, payload);
    int code = http.POST(payload);

    if (code == 200 || code == 201) {
        String body = http.getString();
        CLOG("Alert POST success (%d): %s", code, body.c_str());

        JsonDocument doc;
        DeserializationError err = deserializeJson(doc, body);
        if (!err) {
            // [18] Store alert_event_id for confirm-sms-status linkage
            const char* eventId = doc["alert_event_id"] | (const char*)nullptr;
            if (eventId && strlen(eventId) > 0) {
                strncpy(ctx->lastAlertEventId, eventId, sizeof(ctx->lastAlertEventId) - 1);
                ctx->lastAlertEventId[sizeof(ctx->lastAlertEventId) - 1] = '\0';
                CLOG("alert_event_id stored: %s", ctx->lastAlertEventId);
            }

            // Update SMS contacts if backend returns fresher values
            const char* ownerStr = doc["owner_contact"] | (const char*)nullptr;
            const char* bfpStr   = doc["bfp_contact"]   | (const char*)nullptr;
            if (ownerStr && strlen(ownerStr) > 0) {
                strncpy(ctx->ownerNumber, ownerStr, sizeof(ctx->ownerNumber) - 1);
                ctx->ownerNumber[sizeof(ctx->ownerNumber) - 1] = '\0';
            }
            // trigger-alert always sends bfp_contact; "" means an admin
            // cleared it, so take it as-is instead of keeping the old number
            // (which would otherwise keep being texted until the next config
            // sync). gsmQueueSms() skips an empty number.
            if (bfpStr) {
                strncpy(ctx->bfpNumber, bfpStr, sizeof(ctx->bfpNumber) - 1);
                ctx->bfpNumber[sizeof(ctx->bfpNumber) - 1] = '\0';
            }
            CLOG("Contacts from trigger-alert: Owner=%s BFP=%s",
                 ctx->ownerNumber, ctx->bfpNumber);

            // Reverse-geocoded address + server timestamp for the SMS bodies
            // (SW-2.2.2) — reset first so a field missing from this response
            // never carries a previous alert's stale value into this one.
            memset(ctx->lastAddressResolved, 0, sizeof(ctx->lastAddressResolved));
            memset(ctx->lastTriggeredAt, 0, sizeof(ctx->lastTriggeredAt));
            const char* addressStr = doc["address_resolved"] | (const char*)nullptr;
            const char* triggeredAtStr = doc["triggered_at"]  | (const char*)nullptr;
            if (addressStr && strlen(addressStr) > 0) {
                strncpy(ctx->lastAddressResolved, addressStr, sizeof(ctx->lastAddressResolved) - 1);
                ctx->lastAddressResolved[sizeof(ctx->lastAddressResolved) - 1] = '\0';
            }
            if (triggeredAtStr && strlen(triggeredAtStr) > 0) {
                strncpy(ctx->lastTriggeredAt, triggeredAtStr, sizeof(ctx->lastTriggeredAt) - 1);
                ctx->lastTriggeredAt[sizeof(ctx->lastTriggeredAt) - 1] = '\0';
            }
        } else {
            CLOG("JSON parse error on alert response: %s", err.c_str());
        }
    } else {
        CLOG("Alert POST failed (%d): %s", code, http.getString().c_str());
    }

    http.end();
    return code;
}

// ── SMS Delivery Confirmation POST ─────────────────────────
// [19] Reports the GSM task's +CMGS outcome to confirm-sms-status so
// alert_events.sms_sent_owner / sms_sent_bfp reflect real delivery.
// alert_event_id links to the exact row — no recency guessing needed.
int postSmsStatus(const char* role, bool success, const char* alertEventId) {
    char payload[256];
    snprintf(payload, sizeof(payload),
        "{"
          "\"device_id\":\"%s\","
          "\"alert_event_id\":\"%s\","
          "\"role\":\"%s\","
          "\"success\":%s"
        "}",
        deviceId(),
        alertEventId,
        role,
        success ? "true" : "false"
    );
    return httpsPost(ENDPOINT_CONFIRM_SMS, payload);
}

// ── OTA Firmware Update ─────────────────────────────────────
// Downloads firmware_url (an ESP32 .bin in Supabase Storage) and
// flashes it via the built-in Update library. Only ever reached
// from fetchRemoteConfig(), i.e. only over Wi-Fi, never over the
// SIM800 GSM fallback, and only while alertTier == CLEAR. The
// whole download+flash runs on the connectivity task, blocking
// the alert FSM (Step 4 of connectivityUpdate) for its duration —
// alertTier == CLEAR only guarantees no *existing* alert is live
// when the download starts, not that one can't start mid-download.
// So sensorData/sensorMtx (when passed — null at boot, where no
// alert FSM is running yet) are polled every chunk: a raw
// isTier1()/isTier2() threshold crossing aborts the OTA immediately
// and returns control to connectivityUpdate within one chunk
// interval, so the normal debounced FSM picks the reading up on
// its next tick instead of waiting out the whole transfer.
// esp_task_wdt_reset() is fed every chunk since Update.write()
// does not yield long enough on its own for a multi-hundred-KB
// image under WDT_TIMEOUT_S. On success this never returns —
// ESP.restart() reboots into the new image.
//
// expectedMd5 (hex, 32 chars; may be empty to skip) is checked by
// Update.end() against the downloaded image — HTTPS only proves
// the bytes came from Supabase, not that they're the firmware
// actually built, so this catches a corrupted transfer or a wrong/
// unexpected binary sitting at firmware_url before it's activated.
static bool performOtaUpdate(const char* url, const char* expectedMd5, ConnectivityCtx* ctx,
                              SensorData* sensorData, SemaphoreHandle_t sensorMtx) {
    if (!url || !url[0]) return false;

    WiFiClientSecure client;
    client.setCACert(SUPABASE_ROOT_CA);
    client.setTimeout(10);

    HTTPClient http;
    if (!http.begin(client, url)) {
        CLOG("OTA: http.begin failed");
        return false;
    }

    int code = http.GET();
    int len  = http.getSize();
    if (code != 200 || len <= 0) {
        CLOG("OTA: fetch failed (code=%d len=%d)", code, len);
        http.end();
        return false;
    }

    if (!Update.begin(len)) {
        CLOG("OTA: Update.begin failed: %s", Update.errorString());
        http.end();
        return false;
    }

    if (expectedMd5 && strlen(expectedMd5) == 32 && !Update.setMD5(expectedMd5)) {
        CLOG("OTA: setMD5 rejected '%s' — aborting", expectedMd5);
        Update.abort();
        http.end();
        return false;
    }

    CLOG("OTA: downloading %d bytes...", len);
    WiFiClient* stream = http.getStreamPtr();
    uint8_t buf[1024];
    int written = 0;
    uint32_t lastData = millis();

    while (http.connected() && written < len) {
        size_t avail = stream->available();
        if (avail) {
            int n = stream->readBytes(buf, min(avail, sizeof(buf)));
            if (n <= 0) break;
            if (Update.write(buf, n) != (size_t)n) {
                CLOG("OTA: Update.write failed: %s", Update.errorString());
                Update.abort();
                http.end();
                return false;
            }
            written += n;
            lastData = millis();
        }
        esp_task_wdt_reset();

        if (ctx && sensorData && sensorMtx &&
            xSemaphoreTake(sensorMtx, 0) == pdTRUE) {
            SensorData sd = *sensorData;
            xSemaphoreGive(sensorMtx);
            if (sd.sensor_ready && sd.co_valid && sd.temp_valid &&
                (isTier1(sd.co_ppm, sd.temperature_c, ctx) ||
                 isTier2(sd.co_ppm, sd.temperature_c, ctx))) {
                CLOG("OTA: aborting — sensor reading crossed alert threshold mid-download");
                Update.abort();
                http.end();
                return false;
            }
        }

        if (millis() - lastData > HTTP_TIMEOUT_MS) {
            CLOG("OTA: stream stalled — aborting");
            Update.abort();
            http.end();
            return false;
        }
        vTaskDelay(pdMS_TO_TICKS(2));
    }
    http.end();

    if (written != len) {
        CLOG("OTA: incomplete download (written=%d/%d)", written, len);
        Update.abort();
        return false;
    }
    if (!Update.end()) {
        CLOG("OTA: Update.end failed: %s", Update.errorString());
        return false;
    }

    CLOG("OTA: flashed %d bytes — rebooting", written);
    delay(500);
    ESP.restart();
    return true; // unreachable
}

// ── Remote Config Fetch ────────────────────────────────────
bool fetchRemoteConfig(ConnectivityCtx* ctx, SensorData* sensorData, SemaphoreHandle_t sensorMtx) {
    if (!identityConfigured()) return false;
    WiFiClientSecure client;
    client.setCACert(SUPABASE_ROOT_CA);
    client.setTimeout(10);

    HTTPClient http;
    String url = String(SUPABASE_URL) + ENDPOINT_GET_CONFIG
                 + "?device_id=" + deviceId();
    if (!http.begin(client, url)) return false;

    http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
    http.addHeader("X-Device-Key",  deviceApiKey());

    int code = http.GET();
    if (code != 200) {
        CLOG("fetchRemoteConfig failed (code=%d) — using defaults", code);
        http.end();
        return false;
    }

    String body = http.getString();
    http.end();
    CLOG("Remote config raw payload: %s", body.c_str());

    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, body);
    if (err) {
        CLOG("deserializeJson() failed: %s — using defaults", err.c_str());
        return false;
    }

    ctx->co_alert_ppm = doc["co_alert_ppm"] | CO_ALERT_PPM_DEFAULT;
    ctx->temp_alert_c = doc["temp_alert_c"] | TEMP_ALERT_PPM_DEFAULT;

    const char* ownerStr = doc["owner_number"] | OWNER_SMS_NUMBER_DEFAULT;
    const char* bfpStr   = doc["bfp_number"]   | BFP_SMS_NUMBER_DEFAULT;

    strncpy(ctx->ownerNumber, ownerStr, sizeof(ctx->ownerNumber) - 1);
    ctx->ownerNumber[sizeof(ctx->ownerNumber) - 1] = '\0';
    strncpy(ctx->bfpNumber, bfpStr, sizeof(ctx->bfpNumber) - 1);
    ctx->bfpNumber[sizeof(ctx->bfpNumber) - 1] = '\0';

    CLOG("Config loaded: CO>=%.0f Temp>=%.0f Owner=%s BFP=%s",
         ctx->co_alert_ppm, ctx->temp_alert_c,
         ctx->ownerNumber, ctx->bfpNumber);

    const char* fwVersion = doc["firmware_version"] | "";
    const char* fwUrl     = doc["firmware_url"]     | "";
    const char* fwMd5     = doc["firmware_md5"]     | "";
    if (fwVersion[0] && fwUrl[0] &&
        strcmp(fwVersion, FIRMWARE_VERSION) != 0 &&
        ctx->alertTier == AlertTier::CLEAR) {
        CLOG("OTA: new firmware %s available (current %s)",
             fwVersion, FIRMWARE_VERSION);
        performOtaUpdate(fwUrl, fwMd5, ctx, sensorData, sensorMtx);
        // performOtaUpdate() only returns on failure — defaults above
        // are already applied, so just carry on with this cycle.
    }

    return true;
}

// ── Provisioning: device identity + Wi-Fi ──────────────────
// The setup portal carries two extra fields (Device ID, Device API key) next to the Wi-Fi form; they are
// validated and stored in NVS (identity.cpp), so one firmware image serves every node and survives OTA.
//
// - Identity already stored: normal WiFiManager autoConnect() (portal only if Wi-Fi fails; the fields are
//   there too, pre-filled, so they can be corrected).
// - Identity missing: the portal is forced open even if Wi-Fi credentials are saved, in non-blocking mode so
//   we can see when the fields were saved. Once they are, wait for Wi-Fi (or 30 s) and reboot: the next
//   boot takes the normal path with everything persisted. Gives up after IDENTITY_PORTAL_TIMEOUT_S and
//   returns false; the node then runs offline (local LEDs/buzzer still work, nothing is posted) until it is
//   power-cycled and provisioned.
static bool provisionAndConnect() {
    identityLoad();

    WiFiManagerParameter idParam("device_id", "Device ID (e.g. AGS-001)", deviceId(), (int)agap::kDeviceIdMax);
    WiFiManagerParameter keyParam("device_key", "Device API key (sk_...)", deviceApiKey(), (int)agap::kApiKeyMax);

    WiFiManager wm;
    wm.setConnectTimeout(WIFI_CONNECT_TIMEOUT_S);
    wm.addParameter(&idParam);
    wm.addParameter(&keyParam);
    std::function<void()> onSave = [&]() {
        if (!identitySave(idParam.getValue(), keyParam.getValue())) {
            CLOG("Portal save: identity missing or invalid — not stored");
        }
    };
    wm.setSaveParamsCallback(onSave);
    wm.setSaveConfigCallback(onSave);

    if (identityConfigured()) {
        wm.setConfigPortalTimeout(180);
        return wm.autoConnect(WIFI_AP_NAME, WIFI_AP_PASSWORD);
    }

    CLOG("No device identity stored — opening setup portal");
    wm.setConfigPortalBlocking(false);
    wm.startConfigPortal(WIFI_AP_NAME, WIFI_AP_PASSWORD);
    const uint32_t start = millis();
    uint32_t savedAt = 0;
    while (millis() - start < (uint32_t)IDENTITY_PORTAL_TIMEOUT_S * 1000UL) {
        wm.process();
        if (identityConfigured()) {
            if (savedAt == 0) savedAt = millis();
            if (WiFi.status() == WL_CONNECTED || millis() - savedAt > 30000UL) break;
        }
        delay(10);
    }
    if (identityConfigured()) {
        CLOG("Identity saved — rebooting to apply");
        delay(1000);
        ESP.restart();
    }
    CLOG("Setup portal timed out without a device identity — running offline");
    return false;
}

// ── Init ───────────────────────────────────────────────────
void connectivityInit(ConnectivityCtx* ctx) {
    pinMode(LED_YELLOW_PIN, OUTPUT);
    pinMode(LED_RED_PIN,    OUTPUT);
    pinMode(LED_BLUE_PIN,   OUTPUT);
    pinMode(BUZZER_PIN,     OUTPUT);
    indicatorsOff();
    digitalWrite(LED_BLUE_PIN, LOW);

    ctx->deviceState        = DeviceState::OFFLINE;
    ctx->alertTier          = AlertTier::CLEAR;
    ctx->alertRiseCount     = 0;
    ctx->alertFallCount     = 0;
    ctx->lastWifiRetry_ms   = 0;
    ctx->lastTelemetry_ms   = 0;
    ctx->lastConfigFetch_ms = 0;
    ctx->lastSmsSent_ms     = 0;
    ctx->lastBlueBlink_ms   = 0;
    ctx->blueLedState       = false;
    ctx->batteryMv          = 0;
    ctx->rssi               = 0;
    ctx->co_alert_ppm       = CO_ALERT_PPM_DEFAULT;
    ctx->temp_alert_c       = TEMP_ALERT_PPM_DEFAULT;
    // [22] Zero out lastAlertEventId so first postSmsStatus() never sends garbage
    memset(ctx->lastAlertEventId, 0, sizeof(ctx->lastAlertEventId));
    memset(ctx->lastAddressResolved, 0, sizeof(ctx->lastAddressResolved));
    memset(ctx->lastTriggeredAt, 0, sizeof(ctx->lastTriggeredAt));
    ctx->alertRetry.reset();
    ctx->smsHold.clear();
    ctx->incidentSeq = 0;
    gsmSetIncidentSeq(0);
    strncpy(ctx->ownerNumber, OWNER_SMS_NUMBER_DEFAULT, sizeof(ctx->ownerNumber) - 1);
    strncpy(ctx->bfpNumber,   BFP_SMS_NUMBER_DEFAULT,   sizeof(ctx->bfpNumber)   - 1);

    digitalWrite(LED_BLUE_PIN, HIGH);

    bool connected = provisionAndConnect();

    if (connected) {
        ctx->deviceState = DeviceState::ONLINE;
        ctx->rssi        = WiFi.RSSI();
        digitalWrite(LED_BLUE_PIN, HIGH);
        CLOG("Wi-Fi connected. IP=%s RSSI=%d",
             WiFi.localIP().toString().c_str(), ctx->rssi);
        fetchRemoteConfig(ctx);
        ctx->lastConfigFetch_ms = millis();
    } else {
        ctx->deviceState = DeviceState::OFFLINE;
        digitalWrite(LED_BLUE_PIN, LOW);
        CLOG("Wi-Fi connect failed — OFFLINE mode");
    }
}

// ── Main Update (call every ~2 s from connectivity task) ───
void connectivityUpdate(ConnectivityCtx* ctx,
                        SensorData* sensorData, SemaphoreHandle_t sensorMtx,
                        GpsFix*     gpsFix,     SemaphoreHandle_t gpsMtx)
{
    uint32_t now = millis();

    // ── Step 1: Wi-Fi health + state transitions ────────────
    if (WiFi.status() != WL_CONNECTED) {
        if (ctx->deviceState != DeviceState::OFFLINE) {
            ctx->deviceState = DeviceState::OFFLINE;
            CLOG("Wi-Fi lost → OFFLINE");
        }
        updateBlueLed(ctx, false);

        if (now - ctx->lastWifiRetry_ms >= (uint32_t)(WIFI_RECONNECT_INTERVAL_S * 1000)) {
            ctx->lastWifiRetry_ms = now;
            CLOG("Attempting Wi-Fi reconnect...");
            WiFi.disconnect();
            WiFi.begin();
        }
    } else {
        ctx->rssi = WiFi.RSSI();
        if (ctx->deviceState != DeviceState::ONLINE) {
            WiFiClientSecure probe;
            probe.setCACert(SUPABASE_ROOT_CA);
            probe.setTimeout(5);
            String host = String(SUPABASE_URL);
            host.replace("https://", "");
            bool reachable = probe.connect(host.c_str(), 443);
            probe.stop();
            ctx->deviceState = reachable ? DeviceState::ONLINE : DeviceState::DEGRADED;
            CLOG("Supabase probe: %s → %s",
                 reachable ? "reachable" : "unreachable",
                 deviceStateStr(ctx->deviceState));
        }
        updateBlueLed(ctx, ctx->deviceState == DeviceState::ONLINE);
    }

    // ── Step 2: Periodic remote config re-fetch ─────────────
    if (ctx->deviceState == DeviceState::ONLINE &&
        now - ctx->lastConfigFetch_ms >= CONFIG_FETCH_INTERVAL_MS) {
        ctx->lastConfigFetch_ms = now;
        fetchRemoteConfig(ctx, sensorData, sensorMtx);
    }

    // ── Step 3: Snapshot shared data under mutexes ──────────
    SensorData sd;
    GpsFix     fix;
    bool       haveData = false;

    if (xSemaphoreTake(sensorMtx, pdMS_TO_TICKS(100)) == pdTRUE) {
        sd       = *sensorData;
        haveData = sd.co_valid && sd.temp_valid;
        xSemaphoreGive(sensorMtx);
    }
    if (xSemaphoreTake(gpsMtx, pdMS_TO_TICKS(50)) == pdTRUE) {
        fix = *gpsFix;
        xSemaphoreGive(gpsMtx);
    }

    if (!haveData) { CLOG("Waiting for sensor data..."); return; }

    ctx->batteryMv = readBatteryMv();

    // ── Step 4: Alert FSM (suppressed until sensor_ready) ───
    if (!sd.sensor_ready) {
        CLOG("Sensor warm-up in progress — alert FSM suppressed");
        indicatorsOff();
    } else {
        bool tier2Now = isTier2(sd.co_ppm, sd.temperature_c, ctx);
        bool tier1Now = isTier1(sd.co_ppm, sd.temperature_c, ctx);
        bool safeNow  = !tier1Now && !tier2Now;

        switch (ctx->alertTier) {

            // ── CLEAR ─────────────────────────────────────
            case AlertTier::CLEAR:
                indicatorsOff();
                if (tier2Now || tier1Now) {
                    ctx->alertRiseCount++;
                    CLOG("Alert rise count %d/%d (T2=%d T1=%d)",
                         ctx->alertRiseCount, ALERT_DEBOUNCE_COUNT,
                         (int)tier2Now, (int)tier1Now);
                    if (ctx->alertRiseCount >= ALERT_DEBOUNCE_COUNT) {
                        // New incident starting from CLEAR — forget any
                        // id from a previous, already-resolved alert so
                        // it can never leak into this one's SMS reports.
                        memset(ctx->lastAlertEventId, 0, sizeof(ctx->lastAlertEventId));
                        ctx->alertRetry.reset();
                        ctx->incidentSeq++;
                        gsmSetIncidentSeq(ctx->incidentSeq);
                        if (tier2Now) {
                            ctx->alertTier      = AlertTier::TIER2;
                            ctx->alertRiseCount = 0;
                            ctx->alertFallCount = 0;
                            setTier2Indicators();
                            CLOG("TIER 2 ALERT — both sensors over threshold");
                            fireTier2Alert(ctx, sd, fix);
                        } else {
                            ctx->alertTier      = AlertTier::TIER1;
                            ctx->alertRiseCount = 0;   // [21] reset so TIER1→TIER2 debounce starts fresh
                            ctx->alertFallCount = 0;
                            setTier1Indicators();
                            CLOG("TIER 1 WARNING — single sensor over threshold");
                            fireTier1Warning(ctx, sd, fix);
                        }
                    }
                } else {
                    ctx->alertRiseCount = 0;
                }
                break;

            // ── TIER 1 ────────────────────────────────────
            case AlertTier::TIER1:
                setTier1Indicators();
                if (tier2Now) {
                    ctx->alertRiseCount++;
                    if (ctx->alertRiseCount >= ALERT_DEBOUNCE_COUNT) {
                        ctx->alertTier      = AlertTier::TIER2;
                        ctx->alertRiseCount = 0;
                        ctx->alertFallCount = 0;
                        setTier2Indicators();
                        CLOG("Escalating TIER1 → TIER2");
                        fireTier2Alert(ctx, sd, fix);
                    }
                } else if (safeNow) {
                    ctx->alertFallCount++;
                    CLOG("Tier 1 fall count %d/%d", ctx->alertFallCount, ALERT_RESOLUTION_COUNT);
                    if (ctx->alertFallCount >= ALERT_RESOLUTION_COUNT) {
                        CLOG("TIER 1 resolved → CLEAR");
                        ctx->alertRetry.reset();
                        ctx->alertTier      = AlertTier::CLEAR;
                        ctx->alertRiseCount = 0;
                        ctx->alertFallCount = 0;
                        indicatorsOff();
                    }
                } else {
                    ctx->alertFallCount = 0;
                }
                break;

            // ── TIER 2 ────────────────────────────────────
            case AlertTier::TIER2:
                setTier2Indicators();
                if (safeNow) {
                    ctx->alertFallCount++;
                    CLOG("Tier 2 fall count %d/%d", ctx->alertFallCount, ALERT_RESOLUTION_COUNT);
                    if (ctx->alertFallCount >= ALERT_RESOLUTION_COUNT) {
                        CLOG("TIER 2 resolved → CLEAR");
                        ctx->alertRetry.reset();
                        ctx->alertTier      = AlertTier::CLEAR;
                        ctx->alertRiseCount = 0;
                        ctx->alertFallCount = 0;
                        indicatorsOff();
                    }
                } else if (!tier2Now && tier1Now) {
                    ctx->alertFallCount++;
                    if (ctx->alertFallCount >= ALERT_RESOLUTION_COUNT) {
                        CLOG("De-escalating TIER2 → TIER1");
                        ctx->alertTier      = AlertTier::TIER1;
                        ctx->alertRiseCount = 0;
                        ctx->alertFallCount = 0;
                        setTier1Indicators();
                    }
                } else {
                    ctx->alertFallCount = 0;
                }
                break;
        }
    }

    // ── Step 4b: Retry an unacknowledged alert POST ─────────
    // The first attempt is made synchronously at the transition (fireTier*). If it failed, the scheduler
    // (alert_retry.h) says when to try again. At most one alert POST per tick. Skipped unless ONLINE.
    attemptAlertPost(ctx, sd, fix);

    // ── Step 5: Periodic telemetry POST ─────────────────────
    if (now - ctx->lastTelemetry_ms >= TELEMETRY_INTERVAL_MS) {
        ctx->lastTelemetry_ms = now;
        const char* phaseStr = (mq7GetPhase() == MQ7Phase::MEASURING)
                               ? "measuring" : "heating";
        if (ctx->deviceState == DeviceState::ONLINE) {
            esp_task_wdt_reset();
            int code = postTelemetry(sd, fix, ctx->batteryMv, ctx->rssi, phaseStr);
            if (code != 200 && code != 201) {
                CLOG("Telemetry POST failed (code=%d) → DEGRADED", code);
                ctx->deviceState = DeviceState::DEGRADED;
            }
        } else {
            CLOG("Skip telemetry — state=%s", deviceStateStr(ctx->deviceState));
        }
    }

    // ── Step 6: SMS delivery results → confirm-sms-status ────
    serviceSmsReports(ctx);

    // ── Periodic state log ───────────────────────────────────
    static uint32_t lastLog = 0;
    if (now - lastLog >= 10000) {
        lastLog = now;
        CLOG("State=%s Tier=%s CO=%.1f Temp=%.1f Batt=%d mV RSSI=%d ready=%d",
             deviceStateStr(ctx->deviceState),
             alertTierStr(ctx->alertTier),
             sd.co_ppm, sd.temperature_c,
             ctx->batteryMv, ctx->rssi,
             (int)sd.sensor_ready);
    }
}

// ── Tier 1: yellow LED + trigger-alert POST (no SMS) ───────
static void fireTier1Warning(ConnectivityCtx* ctx, const SensorData& sd, const GpsFix& fix) {
    ctx->alertRetry.onTierEntered(1, millis());
    attemptAlertPost(ctx, sd, fix);
}

// ── Tier 2: trigger-alert POST + owner SMS + BFP SMS ───────
static void fireTier2Alert(ConnectivityCtx* ctx, const SensorData& sd, const GpsFix& fix) {
    // 1. POST to trigger-alert — updates ctx->lastAlertEventId,
    //    ownerNumber, bfpNumber from response
    ctx->alertRetry.reassert(2, millis());
    attemptAlertPost(ctx, sd, fix);

    // 2. Queue SMS using freshest contacts — non-blocking, immediately and regardless of the POST result
    //    (GSM fallback). Snapshot ctx->lastAlertEventId into the job now: it reflects this call's own
    //    postAlert() result above (or stays empty if we're offline or the POST failed — then the result is
    //    bound LATER, see serviceSmsReports()). Callers reset it to empty on every
    //    CLEAR→TIERx transition (see connectivityUpdate()), so it can
    //    never carry a stale, unrelated alert's id into this SMS.
    uint32_t now = millis();
    if (now - ctx->lastSmsSent_ms >= SMS_DEBOUNCE_MS || ctx->lastSmsSent_ms == 0) {
        ctx->lastSmsSent_ms = now;
        gsmSendOwnerSms(sd.co_ppm, sd.temperature_c, fix.lat, fix.lng,
                       ctx->lastAddressResolved,
                       ctx->ownerNumber, ctx->lastAlertEventId);
        gsmSendBfpSms(sd.co_ppm, sd.temperature_c, fix.lat, fix.lng,
                     ctx->lastAddressResolved, ctx->lastTriggeredAt,
                     ctx->bfpNumber, ctx->lastAlertEventId);
        CLOG("Tier 2 SMS queued: owner=%s bfp=%s event=%s", ctx->ownerNumber, ctx->bfpNumber,
             ctx->lastAlertEventId[0] ? ctx->lastAlertEventId : "(none)");
    } else {
        CLOG("SMS debounced — %lu ms since last send", now - ctx->lastSmsSent_ms);
    }
}

// ── Alert POST attempt (Step 5.3) ───────────────────────────
// Makes one trigger-alert attempt if the retry scheduler says one is due and we are ONLINE. Not being
// ONLINE does not consume an attempt or advance the backoff: the alert stays pending until a link exists.
// The WDT is fed first because a failing POST can block for HTTP_TIMEOUT_MS plus connect time.
static void attemptAlertPost(ConnectivityCtx* ctx, const SensorData& sd, const GpsFix& fix) {
    uint32_t now = millis();
    if (ctx->deviceState != DeviceState::ONLINE) return;
    if (!ctx->alertRetry.shouldAttempt(now)) return;

    uint8_t tier = ctx->alertRetry.beginAttempt(now);
    esp_task_wdt_reset();
    int code = postAlert(ctx, sd, fix, tier);
    agap::PostOutcome outcome = agap::classifyAlertHttp(code);
    ctx->alertRetry.onResult(outcome, millis());
    CLOG("Tier %d alert POST: code=%d outcome=%d attempts=%lu%s", (int)tier, code, (int)outcome,
         (unsigned long)ctx->alertRetry.attemptsTotal(),
         ctx->alertRetry.gaveUp() ? " GAVE UP" : "");
}

// ── SMS result reporting (Step 5.3) ─────────────────────────
// 1. Always drain the GSM result queue into ctx->smsHold (the GSM queue is a small ring buffer and must
//    never back up, online or not).
// 2. When ONLINE, report whatever is ready: results that carry their own alert_event_id, and results of
//    the CURRENT incident whose id only became known after the SMS was queued (late binding). A result is
//    never bound to a different incident's id.
// 3. A transient report failure is requeued (bounded); a permanent one is dropped.
static void serviceSmsReports(ConnectivityCtx* ctx) {
    char role[8];
    char alertEventId[40];
    bool success;
    uint32_t seq;
    for (int i = 0; i < SMS_QUEUE_SIZE; i++) {
        if (!gsmPopSmsResult(role, sizeof(role), alertEventId, sizeof(alertEventId), &success, &seq)) break;
        if (ctx->smsHold.hold(role, alertEventId, success, seq, millis())) {
            CLOG("SMS hold full — oldest result dropped");
        }
    }

    if (ctx->deviceState != DeviceState::ONLINE) return;

    agap::HeldSmsResult e;
    for (int i = 0; i < SMS_QUEUE_SIZE; i++) {
        if (!ctx->smsHold.takeReady(ctx->incidentSeq, ctx->lastAlertEventId, millis(), &e)) break;
        const char* id = e.eventId[0] ? e.eventId : ctx->lastAlertEventId;
        esp_task_wdt_reset();
        int code = postSmsStatus(e.role, e.success, id);
        agap::PostOutcome outcome = agap::classifyAlertHttp(code);
        CLOG("SMS status reported: role=%s success=%d event=%s → code=%d", e.role, (int)e.success, id, code);
        if (outcome == agap::PostOutcome::Transient) {
            // keep it bound to the id we just used so it cannot drift to a later incident
            if (e.eventId[0] == '\0') {
                strncpy(e.eventId, id, sizeof(e.eventId) - 1);
                e.eventId[sizeof(e.eventId) - 1] = '\0';
            }
            if (!ctx->smsHold.requeue(e, millis())) CLOG("SMS result role=%s dropped — retries exhausted", e.role);
            break;  // do not hammer a failing server within one tick
        }
    }
}

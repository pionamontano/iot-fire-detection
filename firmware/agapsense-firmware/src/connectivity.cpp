// ============================================================
// connectivity.cpp — Wi-Fi, HTTPS, Alert FSM  (v2.1)
//
// Changes from v2.0:
//  [15] Tier 1 now POSTs to trigger-alert too (alert_tier=1) — was
//       Telegram-only before, so Tier 1 never reached the backend
//  [16] Telegram sending removed from firmware — sendTelegram() and
//       the TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID config deleted.
//       trigger-alert already calls the Bot API server-side per spec;
//       doing it there instead keeps the bot token off the hardware,
//       lets the message include the backend-resolved address, and
//       makes telegram_sent reflect the backend's own Bot API result.
//  [17] Owner/BFP SMS now go through gsmQueueSms()/gsmProcessQueue()
//       instead of blocking the Connectivity task directly — avoids
//       stalling connectivityUpdate() (and its WDT reset) on a slow
//       SIM800L response. SmsJob queue bumped to hold 2 jobs, since
//       Tier 2 always queues both owner and BFP at once.
//
// All changes from review applied (v2.0):
//   [1] WiFiManager captive portal on first boot / no credentials
//   [2] Two-tier alert (TIER1 = one sensor, TIER2 = both sensors)
//   [3] Tier 1 → yellow LED + trigger-alert POST only (no SMS)
//   [4] Tier 2 → red LED + buzzer + trigger-alert POST + owner SMS + BFP SMS
//   [5] Blue LED: solid ONLINE, 500 ms blink connecting, off OFFLINE
//   [6] SMS 5-minute debounce (spec requirement)
//   [8] on_battery flag in telemetry payload
//   [9] sensor_ready flag in both payloads
//  [10] mq7_phase field in telemetry payload
//  [11] Telemetry posted every 30 s regardless of MQ-7 heating phase
//  [12] X-Device-Key header on all Edge Function requests
//  [13] fetchRemoteConfig(): pulls thresholds + SMS numbers from DB
//  [14] Alert auto-resolution: TIER1/TIER2 → CLEAR after safe readings
// ============================================================

#include <ArduinoJson.h>

#include "connectivity.h"
#include "gsm.h"

#include <WiFi.h>
#include <WiFiManager.h>        // captive portal provisioning
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

#if DEBUG_MODE
  #define CLOG(fmt, ...) Serial.printf("[CONN] " fmt "\n", ##__VA_ARGS__)
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
// ── Internal forward declarations ─────────────────────────
static void fireTier1Warning(ConnectivityCtx* ctx, const SensorData& sd, const GpsFix& fix);
static void fireTier2Alert(ConnectivityCtx* ctx, const SensorData& sd, const GpsFix& fix);


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
        // Solid blue = ONLINE
        digitalWrite(LED_BLUE_PIN, HIGH);
        ctx->blueLedState    = true;
        ctx->lastBlueBlink_ms = millis();
    } else if (ctx->deviceState == DeviceState::OFFLINE) {
        // Blue off = no Wi-Fi at all
        digitalWrite(LED_BLUE_PIN, LOW);
    } else {
        // DEGRADED = Wi-Fi up but Supabase unreachable → blink 500 ms
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
    return (coHigh || tempHigh) && !(coHigh && tempHigh);  // XOR: one but not both
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
// Opens a WiFiClientSecure connection, POSTs JSON, returns HTTP code.
// ── HTTPS POST helper ──────────────────────────────────────
static int httpsPost(const char* endpoint, const char* payload) {
    WiFiClientSecure client;
    client.setCACert(SUPABASE_ROOT_CA); // Set Root CA for Supabase HTTPS validation
    client.setTimeout(HTTP_TIMEOUT_MS / 1000);

    HTTPClient http;
    String url = String(SUPABASE_URL) + endpoint;
    if (!http.begin(client, url)) {
        CLOG("ERROR: http.begin failed for %s", endpoint);
        return -1;
    }
    http.addHeader("Content-Type",  "application/json");
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
    http.addHeader("X-Device-Key",  DEVICE_API_KEY);
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
// [8][9][10][11] on_battery + sensor_ready + mq7_phase + always post
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
          "\"mq7_phase\":\"%s\""
        "}",
        DEVICE_ID,
        sd.co_ppm, sd.temperature_c,
        fix.lat, fix.lng,
        fix.valid ? "true" : "false",
        batteryMv, rssi,
        on_battery   ? "true" : "false",
        sd.sensor_ready ? "true" : "false",
        mq7Phase
    );
    return httpsPost(ENDPOINT_INGEST, payload);
}

// ── Alert POST ─────────────────────────────────────────────
// [15] tier (1 or 2) is included so the backend's stat cards and
// history reflect Tier 1 warnings, not just Tier 2 alerts.
// The backend resolves the address/contacts and returns owner_contact & bfp_contact.
int postAlert(ConnectivityCtx* ctx, const SensorData& sd, const GpsFix& fix, int alertTier) {
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
        DEVICE_ID,
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
    http.addHeader("X-Device-Key",  DEVICE_API_KEY);
    http.setTimeout(HTTP_TIMEOUT_MS);

    CLOG("POST %s → %s", ENDPOINT_ALERT, payload);
    int code = http.POST(payload);

    if (code == 200 || code == 201) {
        String body = http.getString();
        CLOG("Alert POST Success (%d): %s", code, body.c_str());

        // Parse contacts returned from backend
        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, body);
        if (!error) {
            const char* ownerStr = doc["owner_contact"] | doc["owner_number"] | (const char*)nullptr;
            const char* bfpStr   = doc["bfp_contact"]   | doc["bfp_number"]   | (const char*)nullptr;

            if (ownerStr && strlen(ownerStr) > 0) {
                strncpy(ctx->ownerNumber, ownerStr, sizeof(ctx->ownerNumber) - 1);
                ctx->ownerNumber[sizeof(ctx->ownerNumber) - 1] = '\0';
            }
            if (bfpStr && strlen(bfpStr) > 0) {
                strncpy(ctx->bfpNumber, bfpStr, sizeof(ctx->bfpNumber) - 1);
                ctx->bfpNumber[sizeof(ctx->bfpNumber) - 1] = '\0';
            }
            CLOG("Updated SMS contacts from trigger-alert: Owner=%s BFP=%s",
                 ctx->ownerNumber, ctx->bfpNumber);
        }
    } else {
        CLOG("Alert POST Failed (%d): %s", code, http.getString().c_str());
    }

    http.end();
    return code;
}

// ── Remote Config Fetch ────────────────────────────────────
// [13] Pull alert thresholds and SMS recipient numbers from DB.
// Falls back to defaults on JSON parse error or non-200 HTTP code.
bool fetchRemoteConfig(ConnectivityCtx* ctx) {
    WiFiClientSecure client;
    client.setCACert(SUPABASE_ROOT_CA);
    client.setTimeout(10);

    HTTPClient http;
    String url = String(SUPABASE_URL) + ENDPOINT_GET_CONFIG
                 + "?device_id=" + DEVICE_ID;
    if (!http.begin(client, url)) return false;

    http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
    http.addHeader("X-Device-Key",  DEVICE_API_KEY);

    int code = http.GET();
    if (code != 200) {
        CLOG("fetchRemoteConfig failed (code=%d) — using defaults", code);
        http.end();
        return false;
    }

    String body = http.getString();
    http.end();
    CLOG("Remote config raw payload: %s", body.c_str());

    // Allocate JSON document (512 bytes is sufficient for threshold/contact payload)
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, body);

    if (error) {
        CLOG("deserializeJson() failed: %s — using defaults", error.c_str());
        return false;
    }

    // Extract fields with automatic fallback if key is missing or null
    ctx->co_alert_ppm = doc["co_alert_ppm"] | CO_ALERT_PPM_DEFAULT;
    ctx->temp_alert_c = doc["temp_alert_c"] | TEMP_ALERT_PPM_DEFAULT;

    const char* ownerStr = doc["owner_number"] | OWNER_SMS_NUMBER_DEFAULT;
    const char* bfpStr   = doc["bfp_number"]   | BFP_SMS_NUMBER_DEFAULT;

    strncpy(ctx->ownerNumber, ownerStr, sizeof(ctx->ownerNumber) - 1);
    ctx->ownerNumber[sizeof(ctx->ownerNumber) - 1] = '\0';

    strncpy(ctx->bfpNumber, bfpStr, sizeof(ctx->bfpNumber) - 1);
    ctx->bfpNumber[sizeof(ctx->bfpNumber) - 1] = '\0';

    CLOG("Config parsed successfully: CO>=%.0f Temp>=%.0f Owner=%s BFP=%s",
         ctx->co_alert_ppm, ctx->temp_alert_c,
         ctx->ownerNumber, ctx->bfpNumber);

    return true;
}

// ── Init ───────────────────────────────────────────────────
void connectivityInit(ConnectivityCtx* ctx) {
    // Indicator GPIO setup
    pinMode(LED_YELLOW_PIN, OUTPUT);
    pinMode(LED_RED_PIN,    OUTPUT);
    pinMode(LED_BLUE_PIN,   OUTPUT);
    pinMode(BUZZER_PIN,     OUTPUT);
    indicatorsOff();
    digitalWrite(LED_BLUE_PIN, LOW);

    // Initialise context
    ctx->deviceState      = DeviceState::OFFLINE;
    ctx->alertTier        = AlertTier::CLEAR;
    ctx->alertRiseCount   = 0;
    ctx->alertFallCount   = 0;
    ctx->lastWifiRetry_ms = 0;
    ctx->lastTelemetry_ms = 0;
    ctx->lastConfigFetch_ms = 0;
    ctx->lastSmsSent_ms   = 0;
    ctx->lastBlueBlink_ms = 0;
    ctx->blueLedState     = false;
    ctx->batteryMv        = 0;
    ctx->rssi             = 0;
    // Load threshold defaults (overridden by fetchRemoteConfig below)
    ctx->co_alert_ppm     = CO_ALERT_PPM_DEFAULT;
    ctx->temp_alert_c     = TEMP_ALERT_PPM_DEFAULT;
    strncpy(ctx->ownerNumber, OWNER_SMS_NUMBER_DEFAULT, sizeof(ctx->ownerNumber) - 1);
    strncpy(ctx->bfpNumber,   BFP_SMS_NUMBER_DEFAULT,   sizeof(ctx->bfpNumber)   - 1);

    // [1] WiFiManager: try saved NVS credentials; launch captive portal if none
    WiFiManager wm;
    wm.setConnectTimeout(WIFI_CONNECT_TIMEOUT_S);
    wm.setConfigPortalTimeout(180);   // portal closes after 3 min of inactivity

    // Blink blue LED during provisioning/connecting
    digitalWrite(LED_BLUE_PIN, HIGH);

    // autoConnect: tries NVS credentials → launches AP if they fail
    bool connected = wm.autoConnect(WIFI_AP_NAME, WIFI_AP_PASSWORD);

    if (connected) {
        ctx->deviceState = DeviceState::ONLINE;
        ctx->rssi        = WiFi.RSSI();
        digitalWrite(LED_BLUE_PIN, HIGH);   // solid blue = connected
        CLOG("Wi-Fi connected via WiFiManager. IP=%s RSSI=%d",
             WiFi.localIP().toString().c_str(), ctx->rssi);

        // Fetch remote config immediately after first connect
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
            WiFi.begin();   // retry using NVS credentials
        }
    } else {
        ctx->rssi = WiFi.RSSI();
        if (ctx->deviceState != DeviceState::ONLINE) {
            // Probe Supabase reachability
            WiFiClientSecure probe;
            probe.setCACert(SUPABASE_ROOT_CA); // Set Root CA for probe validation
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
    // [13] Re-fetch every 10 min so threshold/contact changes take effect
    if (ctx->deviceState == DeviceState::ONLINE &&
        now - ctx->lastConfigFetch_ms >= CONFIG_FETCH_INTERVAL_MS) {
        ctx->lastConfigFetch_ms = now;
        fetchRemoteConfig(ctx);
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
    // [9] While MQ-7 is warming up, skip all alert evaluation
    if (!sd.sensor_ready) {
        CLOG("Sensor warm-up in progress — alert FSM suppressed");
        indicatorsOff();
        // Still post telemetry so dashboard can show "Initializing sensors..."
        // (sensor_ready=false is included in the payload)
    } else {
        // Determine current tier from live readings
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
                        // Debounce passed — determine which tier to enter
                        if (tier2Now) {
                            ctx->alertTier      = AlertTier::TIER2;
                            ctx->alertFallCount = 0;
                            setTier2Indicators();
                            CLOG("🔥 TIER 2 ALERT — both sensors over threshold");
                            fireTier2Alert(ctx, sd, fix);
                        } else {
                            ctx->alertTier      = AlertTier::TIER1;
                            ctx->alertFallCount = 0;
                            setTier1Indicators();
                            CLOG("⚠ TIER 1 WARNING — single sensor over threshold");
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
                    // Escalate to Tier 2
                    ctx->alertRiseCount++;
                    if (ctx->alertRiseCount >= ALERT_DEBOUNCE_COUNT) {
                        ctx->alertTier      = AlertTier::TIER2;
                        ctx->alertRiseCount = 0;  // Reset rise counter after escalation
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
                        ctx->alertTier      = AlertTier::CLEAR;
                        ctx->alertRiseCount = 0;
                        ctx->alertFallCount = 0;
                        indicatorsOff();
                    }
                } else if (!tier2Now && tier1Now) {
                    // De-escalate to Tier 1
                    ctx->alertFallCount++;
                    if (ctx->alertFallCount >= ALERT_RESOLUTION_COUNT) {
                        CLOG("De-escalating TIER2 → TIER1");
                        ctx->alertTier      = AlertTier::TIER1;
                        ctx->alertFallCount = 0;
                        setTier1Indicators();
                    }
                } else {
                    ctx->alertFallCount = 0;
                }
                break;
        }
    }

    // ── Step 5: Periodic telemetry POST ─────────────────────
    // [11] Always post regardless of MQ-7 heating/measuring phase
    if (now - ctx->lastTelemetry_ms >= TELEMETRY_INTERVAL_MS) {
        ctx->lastTelemetry_ms = now;
        const char* phaseStr = (mq7GetPhase() == MQ7Phase::MEASURING)
                               ? "measuring" : "heating";

        if (ctx->deviceState == DeviceState::ONLINE) {
            int code = postTelemetry(sd, fix, ctx->batteryMv, ctx->rssi, phaseStr);
            if (code != 200 && code != 201) {
                CLOG("Telemetry POST failed (code=%d) → DEGRADED", code);
                ctx->deviceState = DeviceState::DEGRADED;
            }
        } else {
            CLOG("Skip telemetry — state=%s", deviceStateStr(ctx->deviceState));
        }
    }

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
// [15] Backend sends the Telegram warning itself once this lands.
// Defined here (not in header) as internal helper
static void fireTier1Warning(ConnectivityCtx* ctx, const SensorData& sd, const GpsFix& fix) {
    if (ctx->deviceState == DeviceState::ONLINE) {
        int code = postAlert(ctx, sd, fix, 1);
        CLOG("Tier 1 Supabase alert POST: code=%d", code);
    }
}

// ── Tier 2: trigger-alert POST + owner SMS + BFP SMS ───────
// [16] Backend sends the Telegram alert itself once this lands.
static void fireTier2Alert(ConnectivityCtx* ctx, const SensorData& sd, const GpsFix& fix) {
    // 1. POST to Supabase trigger-alert (updates ctx->ownerNumber / ctx->bfpNumber if changed)
    if (ctx->deviceState == DeviceState::ONLINE) {
        int code = postAlert(ctx, sd, fix, 2);
        CLOG("Tier 2 Supabase alert POST: code=%d", code);
    }

    // 2. Dispatch SMS using the freshest contacts in ctx
    uint32_t now = millis();
    if (now - ctx->lastSmsSent_ms >= SMS_DEBOUNCE_MS || ctx->lastSmsSent_ms == 0) {
        ctx->lastSmsSent_ms = now;
        gsmSendOwnerSms(sd.co_ppm, sd.temperature_c, fix.lat, fix.lng, ctx->ownerNumber);
        gsmSendBfpSms(sd.co_ppm, sd.temperature_c, fix.lat, fix.lng, ctx->bfpNumber);
        CLOG("Tier 2 SMS queued for owner=%s and BFP=%s", ctx->ownerNumber, ctx->bfpNumber);
    }
}

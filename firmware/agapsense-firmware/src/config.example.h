#pragma once
// ============================================================
// config.h — AgapSense Firmware Configuration  (v2.1)
//
// Changes from v2.0:
//   ~ TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID removed — the firmware no
//     longer talks to the Bot API directly; trigger-alert does it
//     server-side (keeps the bot token off the hardware)
//   + SMS_QUEUE_SIZE (holds 2 jobs — Tier 2 queues owner + BFP at once)
//
// Changes from v1.0:
//   + DEVICE_API_KEY (X-Device-Key header for Edge Functions)
//   + OWNER_SMS_NUMBER + BFP_SMS_NUMBER (role-specific SMS)
//   + LED_YELLOW_PIN, LED_RED_PIN, LED_BLUE_PIN, BUZZER_PIN
//   + ON_BATTERY_THRESHOLD_MV
//   + ENDPOINT_GET_CONFIG (remote threshold/contact fetch)
//   + CONFIG_FETCH_INTERVAL_MS
//   + SMS_DEBOUNCE_MS (5-minute debounce per spec)
//   + Captive-portal AP name (WiFiManager)
//   ~ SMS_ALERT_NUMBER removed (replaced by OWNER/BFP numbers)
//   ~ Thresholds now runtime-overridable; #defines are defaults
// ============================================================

// ── Debug ──────────────────────────────────────────────────
#define DEBUG_MODE       1
#define DEBUG_BAUD       115200

// ── Wi-Fi / Captive Portal ─────────────────────────────────
// WiFiManager will try saved NVS credentials first.
// If none exist or connection fails, it launches an AP with
// this SSID so the user can provision via captive portal.
#define WIFI_AP_NAME           "AgapSense-Setup"
#define WIFI_AP_PASSWORD       ""            // open AP (no password)
#define WIFI_CONNECT_TIMEOUT_S  15           // seconds to wait for STA connect
#define WIFI_RECONNECT_INTERVAL_S 60

// ── Supabase Backend ───────────────────────────────────────
#define SUPABASE_URL             "https://your-project-ref.supabase.co"
#define SUPABASE_ANON_KEY        "your-anon-key-here"
#define DEVICE_API_KEY           "your-device-api-key-here"   // X-Device-Key header

#define ENDPOINT_INGEST          "/functions/v1/ingest-reading"
#define ENDPOINT_ALERT           "/functions/v1/trigger-alert"
#define ENDPOINT_GET_CONFIG      "/functions/v1/get-device-config"

#define HTTP_TIMEOUT_MS          10000

// ── Device Identity ────────────────────────────────────────
#define DEVICE_ID                "bantay-apoy-node-001"

// ── SMS Recipients (fetched from DB at runtime; these are fallbacks) ──
// Role-specific numbers per spec:
//   Owner  — plain-language evacuation message
//   BFP    — technical message with device ID, coords, address
#define OWNER_SMS_NUMBER_DEFAULT "+639XXXXXXXXX"
#define BFP_SMS_NUMBER_DEFAULT   "+639YYYYYYYYY"

// ── Pin Assignments ────────────────────────────────────────

// MQ-7 CO Sensor (ADC1 pins only — ADC2 conflicts with Wi-Fi)
#define MQ7_ANALOG_PIN      34    // ADC1_CH6 — input only
#define MQ7_HEATER_PIN      25    // drives heater via BJT/MOSFET
#define MQ7_LOW_DUTY        72    // 28% of 255 ≈ 1.4 V on sensor Vc
#define MQ7_PWM_CHANNEL     0
#define MQ7_PWM_FREQ        1000
#define MQ7_PWM_RESOLUTION  8

// DS18B20 Temperature Sensor (4.7 kΩ pull-up on data pin)
#define DS18B20_PIN         4

// NEO-6M GPS (Serial2)
#define GPS_RX_PIN          16
#define GPS_TX_PIN          17
#define GPS_BAUD            9600
#define GPS_SERIAL          Serial2

// SIM800L GSM (Serial1 — dedicated 4.0 V rail, 1000 µF cap)
#define GSM_RX_PIN          26
#define GSM_TX_PIN          27
#define GSM_BAUD            9600
#define GSM_SERIAL          Serial1

// Battery voltage divider (ADC1)
#define BATTERY_ADC_PIN         35    // ADC1_CH7 — input only
#define BATTERY_DIVIDER_RATIO   2.0f  // R1=R2 → ratio=2
#define ADC_VREF_MV             3300
#define ADC_MAX_RAW             4095
#define ON_BATTERY_THRESHOLD_MV 4000  // below this → on_battery=true

// ── Indicator Hardware ─────────────────────────────────────
// Yellow LED → Tier 1 warning (single sensor over threshold)
// Red LED    → Tier 2 alert   (both sensors over threshold)
// Blue LED   → Wi-Fi status   (solid=ONLINE, blink=connecting, off=OFFLINE)
// Buzzer     → Tier 2 alert   (active buzzer module, HIGH=on)
#define LED_YELLOW_PIN      14
#define LED_RED_PIN         12
#define LED_BLUE_PIN        13
#define BUZZER_PIN          32

// ── MQ-7 Cycle Timing ──────────────────────────────────────
#define MQ7_HEAT_DURATION_MS    60000UL
#define MQ7_MEAS_DURATION_MS    90000UL

// ── Sensor Poll Intervals ──────────────────────────────────
#define DS18B20_READ_INTERVAL_MS    5000UL
#define MQ7_READ_INTERVAL_MS        5000UL   // ADC read every 5 s during MEASURING

// ── Telemetry / Config Intervals ──────────────────────────
#define TELEMETRY_INTERVAL_MS       30000UL  // ingest-reading POST every 30 s
#define CONFIG_FETCH_INTERVAL_MS    600000UL // re-fetch remote config every 10 min

// ── Detection Thresholds (defaults — overridden by remote config) ──
#define CO_ALERT_PPM_DEFAULT        200.0f
#define TEMP_ALERT_PPM_DEFAULT      70.0f

// ── Alert Debounce ─────────────────────────────────────────
#define ALERT_DEBOUNCE_COUNT        3        // consecutive readings to trigger
#define ALERT_RESOLUTION_COUNT      2        // consecutive safe readings to clear
#define SMS_DEBOUNCE_MS             300000UL // 5 minutes between SMS sends
#define SMS_QUEUE_SIZE              2        // Tier 2 queues owner + BFP at once

// ── WDT ────────────────────────────────────────────────────
#define WDT_TIMEOUT_S       30

// ── FreeRTOS Task Stacks (words) ───────────────────────────
#define STACK_MQ7           4096
#define STACK_DS18B20       2048
#define STACK_GPS           3072
#define STACK_CONNECTIVITY  10240   // larger: HTTPS POSTs + config fetch
#define STACK_GSM           4096

// ── FreeRTOS Task Priorities ───────────────────────────────
#define PRIO_MQ7            2
#define PRIO_DS18B20        2
#define PRIO_GPS            3
#define PRIO_CONNECTIVITY   3
#define PRIO_GSM            2

// ── MQ-7 Calibration ──────────────────────────────────────
// Measure Rs in clean air, set R0 = Rs. Re-flash to apply.
#define MQ7_R0_OHMS         10000.0f
#define MQ7_RL_OHMS         10000.0f

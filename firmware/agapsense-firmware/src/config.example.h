#pragma once
// ============================================================
// config.h — AgapSense Firmware Configuration  (v2.2)
//
// FIRMWARE_VERSION is no longer one fixed string for every build — it's
// guarded by #ifndef below so platformio.ini can override it per
// PlatformIO environment (see platformio.ini's [env:...] sections):
//   env:esp32dev            -> 2.1.0 (this file's fallback)      — original
//                              1.4V heat/measure MQ-7 duty cycle
//   env:esp32dev_mq7_5v     -> 2.5.0 (MQ-7 AO read through the 10k/10k
//                              divider; 2.4.0 before that, 2.3.0 before Tier 2 SMS became
//                              offline-only, 2.2.0 before the Tier 1 chirp) — AGS-001's
//                              actual wiring: MQ-7 runs off a constant 5V
//                              rail, not through MQ7_HEATER_PIN's
//                              PWM/transistor, so the duty-cycle model
//                              above always read ADC-saturated garbage on
//                              this hardware. See sensors.cpp's
//                              MQ7_CONTINUOUS_5V branch.
//   env:esp32dev_mq7_5v_diag -> 2.5.0-diag                       — same
//                              constant-5V fix, plus a bench-only HTTP
//                              diag log server (ENABLE_DIAG_SERVER).
//                              Not for production flashes — revert to
//                              env:esp32dev_mq7_5v once done debugging.
//   *_ota variants           -> same version as their base env, just adds
//                              the espota upload protocol (Wi-Fi reflash).
// Whichever env a node was actually built with is what it reports as
// devices.firmware_version_reported — not whatever this file's own
// fallback says.
//
// Changes in v2.3:
//   + Buzzer patterns: Tier 1 = 3 short beeps (150 ms) at once, then
//     every 45 s while the warning lasts; Tier 2 = continuous (unchanged).
//     Driven by a small dedicated task (buzzer.h, STACK_BUZZER /
//     PRIO_BUZZER, defaulted there if this file predates them). No
//     silence button: the beeps stop when the readings clear.
//
// Changes from v2.1:
//   ~ MQ-7 driving model now selectable via the FIRMWARE_VERSION table
//     above instead of one model for every build.
//   + DEVICE_ID / DEVICE_API_KEY moved out of this file entirely —
//     provisioned once per physical node into NVS via the setup portal
//     (see identity.h), so one compiled image now runs on every node.
//   + OTA: device compares get-device-config's firmware_version against
//     its own compiled FIRMWARE_VERSION and self-flashes via firmware_url
//     (+ firmware_md5 check) on mismatch. Wi-Fi only, gated to
//     alertTier == CLEAR so a live alert is never interrupted.
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
// DEBUG_MODE is defined via platformio.ini build_flags (-DDEBUG_MODE=1 / -DDEBUG_MODE=0).
// Default to 0 (production) if not explicitly set by the build system.
#ifndef DEBUG_MODE
  #define DEBUG_MODE       0
#endif
#define DEBUG_BAUD         115200


// Supabase currently serves a Google Trust Services chain (leaf -> WE1 -> GTS Root R4).
// This is the GTS Root R4 cert (cross-signed by GlobalSign, valid to 2028-01-28).
// Re-extract with: openssl s_client -connect <ref>.supabase.co:443 -showcerts
const char SUPABASE_ROOT_CA[] PROGMEM = R"raw(
-----BEGIN CERTIFICATE-----
MIIDejCCAmKgAwIBAgIQf+UwvzMTQ77dghYQST2KGzANBgkqhkiG9w0BAQsFADBX
MQswCQYDVQQGEwJCRTEZMBcGA1UEChMQR2xvYmFsU2lnbiBudi1zYTEQMA4GA1UE
CxMHUm9vdCBDQTEbMBkGA1UEAxMSR2xvYmFsU2lnbiBSb290IENBMB4XDTIzMTEx
NTAzNDMyMVoXDTI4MDEyODAwMDA0MlowRzELMAkGA1UEBhMCVVMxIjAgBgNVBAoT
GUdvb2dsZSBUcnVzdCBTZXJ2aWNlcyBMTEMxFDASBgNVBAMTC0dUUyBSb290IFI0
MHYwEAYHKoZIzj0CAQYFK4EEACIDYgAE83Rzp2iLYK5DuDXFgTB7S0md+8Fhzube
Rr1r1WEYNa5A3XP3iZEwWus87oV8okB2O6nGuEfYKueSkWpz6bFyOZ8pn6KY019e
WIZlD6GEZQbR3IvJx3PIjGov5cSr0R2Ko4H/MIH8MA4GA1UdDwEB/wQEAwIBhjAd
BgNVHSUEFjAUBggrBgEFBQcDAQYIKwYBBQUHAwIwDwYDVR0TAQH/BAUwAwEB/zAd
BgNVHQ4EFgQUgEzW63T/STaj1dj8tT7FavCUHYwwHwYDVR0jBBgwFoAUYHtmGkUN
l8qJUC99BM00qP/8/UswNgYIKwYBBQUHAQEEKjAoMCYGCCsGAQUFBzAChhpodHRw
Oi8vaS5wa2kuZ29vZy9nc3IxLmNydDAtBgNVHR8EJjAkMCKgIKAehhxodHRwOi8v
Yy5wa2kuZ29vZy9yL2dzcjEuY3JsMBMGA1UdIAQMMAowCAYGZ4EMAQIBMA0GCSqG
SIb3DQEBCwUAA4IBAQAYQrsPBtYDh5bjP2OBDwmkoWhIDDkic574y04tfzHpn+cJ
odI2D4SseesQ6bDrarZ7C30ddLibZatoKiws3UL9xnELz4ct92vID24FfVbiI1hY
+SW6FoVHkNeWIP0GCbaM4C6uVdF5dTUsMVs/ZbzNnIdCp5Gxmx5ejvEau8otR/Cs
kGN+hr/W5GvT1tMBjgWKZ1i4//emhA1JG1BbPzoLJQvyEotc03lXjTaCzv8mEbep
8RqZ7a2CPsgRbuvTPBwcOMBBmuFeU88+FSBX6+7iP0il8b4Z0QFqIwwMHfs/L6K1
vepuoxtGzi4CZ68zJpiq1UvSqTbFJjtbD4seiMHl
-----END CERTIFICATE-----
)raw";

// ── Wi-Fi / Captive Portal ─────────────────────────────────
// WiFiManager will try saved NVS credentials first.
// If none exist or connection fails, it launches an AP with
// this SSID so the user can provision via captive portal.
#define WIFI_AP_NAME           "AgapSense-Setup"
#define WIFI_AP_PASSWORD       "agapsense-setup"   // CHANGE ME. The portal now receives the device API key, so it must not be open (WPA2 needs >= 8 chars).
#define WIFI_CONNECT_TIMEOUT_S  15           // seconds to wait for STA connect
#define WIFI_RECONNECT_INTERVAL_S 60

// ── Supabase Backend ───────────────────────────────────────
#define SUPABASE_URL             "https://your-project-ref.supabase.co"
#define SUPABASE_ANON_KEY        "your-anon-key-here"

#define ENDPOINT_INGEST          "/functions/v1/ingest-reading"
#define ENDPOINT_ALERT           "/functions/v1/trigger-alert"
#define ENDPOINT_GET_CONFIG      "/functions/v1/get-device-config"

#define HTTP_TIMEOUT_MS          10000

// ── Device Identity ──────────────────────────────────────
// DEVICE_ID and the device API key are NOT compiled in. They are entered once per node in the
// Wi-Fi setup portal (Setup page), stored in NVS, and survive OTA updates, so one firmware image
// runs on every node. See identity.h. To re-provision a node, erase its flash (pio run -t erase)
// or re-open the portal.
#define IDENTITY_NVS_NAMESPACE   "agapsense"
#define IDENTITY_PORTAL_TIMEOUT_S 600   // how long the portal waits for identity on an unprovisioned node

// Bumped per release. Compared against get-device-config's
// firmware_version field; a mismatch triggers an OTA download.
// Overridable via build_flags (see env:esp32dev_mq7_5v in platformio.ini)
// so a hardware-variant build reports its own distinct version.
#ifndef FIRMWARE_VERSION
  #define FIRMWARE_VERSION        "2.1.0"
#endif

// ── SMS Recipients (fetched from DB at runtime; these are fallbacks) ──
// Role-specific numbers per spec:
//   Owner  — plain-language evacuation message
//   BFP    — technical message with device ID, coords, address
#define OWNER_SMS_NUMBER_DEFAULT "+639XXXXXXXXX"
#define BFP_SMS_NUMBER_DEFAULT   "+639YYYYYYYYY"
#define ENDPOINT_CONFIRM_SMS     "/functions/v1/confirm-sms-status"

// ── Pin Assignments ────────────────────────────────────────

// MQ-7 CO Sensor (ADC1 pins only — ADC2 conflicts with Wi-Fi)
#define MQ7_ANALOG_PIN      33    // ADC1_CH5, via 10k/10k divider from AO (AGS-001 wiring; was 34)
#define MQ7_HEATER_PIN      25    // drives heater via BJT/MOSFET
#define MQ7_LOW_DUTY        72    // 28% of 255 ≈ 1.4 V on sensor Vc
#define MQ7_PWM_CHANNEL     0
#define MQ7_PWM_FREQ        1000
#define MQ7_PWM_RESOLUTION  8

// DS18B20 Temperature Sensor (4.7 kΩ pull-up on data pin)
#define DS18B20_PIN         4

// NEO-6M / NEO-7M GPS (Serial2) — same NMEA-over-UART protocol, no code or
// wiring difference between the two modules.
#define GPS_RX_PIN          17
#define GPS_TX_PIN          16
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
#define STACK_BUZZER        2048

// ── FreeRTOS Task Priorities ───────────────────────────────
#define PRIO_MQ7            2
#define PRIO_DS18B20        2
#define PRIO_GPS            3
#define PRIO_CONNECTIVITY   3
#define PRIO_GSM            2
#define PRIO_BUZZER         2

// ── MQ-7 Analog Front End ─────────────────────────────────
// The module's AO (0-5 V) reaches GPIO 33 through a 10k/10k divider
// (AO ── R_TOP ── GPIO33 ── R_BOTTOM ── GND), so the pin sees at most 2.5 V,
// inside the ESP32's 11 dB ADC range. sensors.cpp scales the pin voltage back
// up by (R_TOP + R_BOTTOM) / R_BOTTOM and treats the divider as part of the
// sensor's load (RL ∥ 20k). See mq7_curve.h. Change these only if the
// resistors on the board change.
#define MQ7_SUPPLY_V              5.0f      // Vc on the constant-5V build
#define MQ7_DIVIDER_R_TOP_OHMS    10000.0f
#define MQ7_DIVIDER_R_BOTTOM_OHMS 10000.0f

// ── MQ-7 Calibration ──────────────────────────────────────
// MQ7_RL_OHMS is the load resistor ON THE MQ-7 MODULE (between AO and GND),
// not the divider. Most modules use 10 kΩ ("103"); some use 1 kΩ ("102").
// If you don't know it, leave 10000: once R0 is calibrated below with this
// same firmware, RL cancels out of Rs/R0, so the ppm reading does not depend
// on it. It only changes the absolute Rs/R0 numbers in the log.
//
// R0 is Rs at 100 ppm CO (the curve reads Rs/R0 = 1 as 100 ppm), NOT Rs in
// clean air. Clean air is Rs/R0 ≈ 27.5 (datasheet Fig 3). To calibrate:
// after a 24-48 h burn-in in clean air, read the "Rs=" value from the
// [SENSOR] log line (debug or diag build) — it already accounts for the
// divider — and set
//   MQ7_R0_OHMS = Rs / 27.5
// Clean air should then read ~0.5-1 ppm. Re-flash to apply.
// 10000 is an uncalibrated placeholder; each sensor needs its own value.
#define MQ7_R0_OHMS         10000.0f
#define MQ7_RL_OHMS         10000.0f

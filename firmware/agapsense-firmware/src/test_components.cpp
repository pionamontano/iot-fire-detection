// ============================================================
// test_components.cpp — Bench Hardware Test Harness + Live Dashboard
//
// Standalone sketch (NOT part of production firmware) that exercises
// every sensor/actuator on the AgapSense node, serves a live web
// dashboard from the device itself, and supports Telegram/SMS alert
// testing. Never linked into env:esp32dev — see build_src_filter in
// platformio.ini for env:test_components.
//
// Pin/timing constants come from config.h (the project's authoritative,
// currently-wired pinout) — nothing here redefines them. Wi-Fi password,
// Telegram bot token and the test SMS number come from
// config_test_secrets.h (gitignored — copy config_test_secrets.example.h
// and fill it in; never commit the real file).
//
// First flash (USB):
//   pio run -e test_components -t upload
// Subsequent reflashes (Wi-Fi, no cable):
//   pio run -e test_components -t upload --upload-port <device-ip>
// Dashboard: http://<device-ip>/  or  http://agapsense-test.local/
// ============================================================

#include <Arduino.h>
#include <math.h>
#include <stdarg.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <TinyGPS++.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <ArduinoOTA.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include "config.h"
#include "config_test_secrets.h"
#include "mq7_curve.h"

// ── Remote log (USB is broken on this board — no serial access, so
// TLOG also appends to a small ring buffer served over HTTP at /log) ──
#define LOG_BUF_LINES 60
#define LOG_LINE_MAX  120
static char     logLines[LOG_BUF_LINES][LOG_LINE_MAX];
static int      logHead    = 0;
static bool     logWrapped = false;

static void logAdd(const char* fmt, ...) {
  char msg[LOG_LINE_MAX - 12];
  va_list args;
  va_start(args, fmt);
  vsnprintf(msg, sizeof(msg), fmt, args);
  va_end(args);
  Serial.printf("[TEST] %s\n", msg);
  snprintf(logLines[logHead], LOG_LINE_MAX, "[%8lu s] %s", millis() / 1000, msg);
  logHead = (logHead + 1) % LOG_BUF_LINES;
  if (logHead == 0) logWrapped = true;
}

#define TLOG(fmt, ...) logAdd(fmt, ##__VA_ARGS__)

// ================= Non-secret test settings =================
const char* DEVICE_NAME       = "AgapSense Test Node";
const bool  TELEGRAM_ENABLED  = true;
const bool  SMS_ENABLED       = true;   // enabled for bench SMS test — see /send-sms

// ============ Wiring flags ============
const bool LED_ACTIVE_LOW = false;   // true if LEDs light on LOW
const bool ACTIVE_BUZZER  = false;   // true = active buzzer, false = passive piezo
const int  BUZZER_TONE_HZ = 2700;    // press 'f' to find the loudest

// ============ CO level thresholds (dashboard only — independent of ====
// ============ the production firmware's single-tier alert system) =====
// 0-9    normal     blue only
// 10-29  elevated   yellow steady
// 30-49  high       yellow blinking
// 50-99  serious    red steady + tone + alert
// 100+   critical   red flashing + tone + alert
const float LVL_ELEVATED =  10.0f;
const float LVL_HIGH     =  30.0f;
const float LVL_SERIOUS  =  50.0f;
const float LVL_CRITICAL = 100.0f;
const int   ALARM_PERSISTENCE = 3;

const unsigned long ALERT_COOLDOWN_MS = 300000;
const float SMOOTHING = 0.3f;

OneWire           oneWire(DS18B20_PIN);
DallasTemperature ds18b20(&oneWire);
TinyGPSPlus       gps;
WebServer         server(80);
Preferences       prefs;

// ── MQ-7 state ──────────────────────────────────────────────
// This board's MQ-7 is wired to a constant 5V rail (confirmed on hardware),
// not through MQ7_HEATER_PIN's PWM/transistor as config.h's comment assumes —
// so there's no real heat/measure voltage cycle to track; read continuously
// instead, modeling the sensor's actual constant-5V bias. AO reaches GPIO 34
// through the 10k/10k divider — same conversion as the production firmware
// (mq7_curve.h).
#define MQ7_WARMUP_MS 60000UL   // datasheet warm-up before readings are trusted (display-only gate)
static uint32_t  mq7StartMs    = 0;
static bool      mq7Ready      = false;
static uint32_t  mq7LastRead_ms = 0;
static float     Ro             = MQ7_R0_OHMS;   // overwritten by NVS if calibrated

float rawCOppm  = 0;
float lastCOppm = 0;
int   mq7PinMvLast = 0;   // at the ADC pin (after the divider)
float mq7VoutLast  = 0;   // sensor AO (before the divider)
bool  firstReading = true;
bool  haveValidReading = false;

int coLevel = 0;
int pendingLevel = 0;
int levelCount = 0;

float lastTempC = 0;
bool  tempOk = false;
double lastLat = 0, lastLng = 0;
bool gpsFixValid = false;
int gpsSats = 0;

int  batteryMv = 0;
bool gsmOk = false;
bool gsmBusySending = false;
uint32_t gsmBaud = GSM_BAUD;   // set by gsmAutoBaud() if a different rate answers

unsigned long lastAlertTime = 0;
int lastAlertLevel = 0;
String lastAlertResult = "none sent yet";
bool simReady = false;

void readTemperature();
void readGPS();
void readBattery();
void gsmPing();
void gsmAutoBaud();
void mq7Update();
void calibrateMQ7();
void evaluateLevel();
void updateIndicators();
void ledWrite(int pin, bool on);
void buzzerOn();
void buzzerOff();
void handleSerialCommands();
bool sendTelegram(const String &msg);
bool sendSMS(const String &msg, const String &to);
void handleSendSms();
bool initSIM800();
void connectWiFi();
void setupOta();
void handleRoot();
void handleData();
void handleLog();
void handleLogRaw();

// ===================== Setup ===========================================

void setup() {
  Serial.begin(DEBUG_BAUD);
  delay(500);
  Serial.println("\n==================================================");
  Serial.printf("  %s — Hardware Test Harness  (fw base v%s)\n", DEVICE_NAME, FIRMWARE_VERSION);
  Serial.println("==================================================");

  pinMode(LED_YELLOW_PIN, OUTPUT);
  pinMode(LED_RED_PIN,    OUTPUT);
  pinMode(LED_BLUE_PIN,   OUTPUT);
  if (ACTIVE_BUZZER) pinMode(BUZZER_PIN, OUTPUT);

  ledWrite(LED_YELLOW_PIN, false);
  ledWrite(LED_RED_PIN, false);
  ledWrite(LED_BLUE_PIN, false);
  buzzerOff();

  // Boot self-test: all LEDs + buzzer on together for 2s, so wiring can be
  // confirmed visually without waiting on any sensor/network logic.
  TLOG("LED/buzzer test: all ON for 2s");
  ledWrite(LED_YELLOW_PIN, true);
  ledWrite(LED_RED_PIN, true);
  ledWrite(LED_BLUE_PIN, true);
  buzzerOn();
  delay(2000);
  ledWrite(LED_YELLOW_PIN, false);
  ledWrite(LED_RED_PIN, false);
  ledWrite(LED_BLUE_PIN, false);
  buzzerOff();
  TLOG("LED/buzzer test done");

  analogSetAttenuation(ADC_11db);
  analogReadResolution(12);

  // MQ7_HEATER_PIN's PWM is wired to nothing on this board (sensor runs off
  // a constant 5V rail instead) — left attached/idle in case that changes.
  ledcSetup(MQ7_PWM_CHANNEL, MQ7_PWM_FREQ, MQ7_PWM_RESOLUTION);
  ledcAttachPin(MQ7_HEATER_PIN, MQ7_PWM_CHANNEL);
  ledcWrite(MQ7_PWM_CHANNEL, 255);
  mq7StartMs = millis();
  TLOG("MQ-7 init — constant 5V, warm-up %lu ms", MQ7_WARMUP_MS);

  ds18b20.begin();
  ds18b20.setResolution(12);
  int n = ds18b20.getDeviceCount();
  TLOG("DS18B20 devices found: %d", n);
  if (n == 0) TLOG("  No sensor. Check the 4.7k pull-up to 3.3V on pin %d.", DS18B20_PIN);

  GPS_SERIAL.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  // GSM UART always brought up so the dashboard can show module presence,
  // even with SMS_ENABLED=false (SIM registration/sending stays gated below).
  GSM_SERIAL.begin(GSM_BAUD, SERIAL_8N1, GSM_RX_PIN, GSM_TX_PIN);
  delay(3000);   // SIM800L boot settle time
  gsmAutoBaud();
  if (SMS_ENABLED) initSIM800();

  prefs.begin("agaptest", false);
  float savedRo = prefs.getFloat("ro2", 0.0f);   // "ro" (pre-divider builds) held clean-air Rs, not R0
  if (savedRo > 100.0f && savedRo < 1000000.0f) {
    Ro = savedRo;
    TLOG("Loaded calibrated R0 = %.1f ohm (press 'c' to recalibrate)", Ro);
  } else {
    TLOG("Using default R0 = %.1f ohm from config.h (press 'c' to calibrate)", Ro);
  }

  connectWiFi();

  server.on("/", handleRoot);
  server.on("/data", handleData);
  server.on("/log", handleLog);
  server.on("/log/raw", handleLogRaw);
  server.on("/send-sms", handleSendSms);
  server.begin();

  Serial.println("\nRunning. Readings update continuously.");
  Serial.println("Serial: i = info | c = recalibrate | w = wifi | g = gps");
  Serial.println("        f = buzzer sweep | T = test Telegram | S = test SMS");
}

void connectWiFi() {
  Serial.printf("Connecting to %s", TEST_WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(TEST_WIFI_SSID, TEST_WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
    Serial.print(".");
    delay(500);
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Connected. Dashboard: http://");
    Serial.println(WiFi.localIP());
    setupOta();   // starts the mDNS responder too ("agapsense-test.local")
    MDNS.addService("http", "tcp", 80);
  } else {
    Serial.println("WiFi failed. Dashboard, OTA and Telegram will not work.");
    Serial.println("The ESP32 is 2.4GHz only - a 5GHz network will never connect.");
  }
}

void setupOta() {
  ArduinoOTA.setHostname("agapsense-test");
  ArduinoOTA.onStart([]() { TLOG("OTA: update starting..."); });
  ArduinoOTA.onEnd([]()   { TLOG("OTA: update complete — rebooting"); });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    static uint8_t lastPct = 255;
    uint8_t pct = total ? (uint8_t)((progress * 100) / total) : 0;
    if (pct != lastPct) { TLOG("OTA: %u%%", pct); lastPct = pct; }
  });
  ArduinoOTA.onError([](ota_error_t error) { TLOG("OTA: error [%u]", (unsigned)error); });
  ArduinoOTA.begin();
  TLOG("OTA ready — hostname 'agapsense-test'");
}

// ===================== Loop ============================================

void loop() {
  if (WiFi.status() == WL_CONNECTED) ArduinoOTA.handle();
  server.handleClient();

  mq7Update();
  readGPS();
  handleSerialCommands();
  updateIndicators();

  static unsigned long lastDs18b20 = 0;
  if (millis() - lastDs18b20 >= DS18B20_READ_INTERVAL_MS) {
    lastDs18b20 = millis();
    readTemperature();
  }

  static unsigned long lastBattery = 0;
  if (millis() - lastBattery >= 5000) {
    lastBattery = millis();
    readBattery();
  }

  static unsigned long lastGsmPing = 0;
  if (millis() - lastGsmPing >= 10000) {
    lastGsmPing = millis();
    gsmPing();
  }

  static unsigned long lastWifiCheck = 0;
  if (millis() - lastWifiCheck > 30000) {
    lastWifiCheck = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi dropped, reconnecting...");
      WiFi.reconnect();
    }
  }
}

// ===================== MQ-7 ============================================
// Constant 5V supply on this board; AO (0-5 V) reaches GPIO 34 through a
// 10k/10k divider so the pin stays within the ADC's range. The divider is
// also part of the sensor's load (RL ∥ 20k) — see mq7_curve.h.
#ifndef MQ7_SUPPLY_V
  #define MQ7_SUPPLY_V              5.0f
#endif
#ifndef MQ7_DIVIDER_R_TOP_OHMS
  #define MQ7_DIVIDER_R_TOP_OHMS    10000.0f
#endif
#ifndef MQ7_DIVIDER_R_BOTTOM_OHMS
  #define MQ7_DIVIDER_R_BOTTOM_OHMS 10000.0f
#endif

static agap::Mq7Circuit mq7Circuit() {
  return { MQ7_SUPPLY_V, MQ7_RL_OHMS, MQ7_DIVIDER_R_TOP_OHMS,
           MQ7_DIVIDER_R_BOTTOM_OHMS, Ro, 2000.0f };
}

// gapMs == 0: 100 us between samples (fast average); otherwise delay(gapMs).
static int mq7ReadPinMv(int n, int gapMs) {
  long sum = 0;
  for (int i = 0; i < n; i++) {
    sum += analogReadMilliVolts(MQ7_ANALOG_PIN);
    if (gapMs) delay(gapMs); else delayMicroseconds(100);
  }
  return (int)(sum / n);
}

void mq7Update() {
  if (millis() - mq7LastRead_ms < MQ7_READ_INTERVAL_MS) return;
  mq7LastRead_ms = millis();

  const agap::Mq7Circuit c = mq7Circuit();
  mq7PinMvLast = mq7ReadPinMv(32, 0);
  const float pinV = mq7PinMvLast / 1000.0f;
  mq7VoutLast = agap::mq7AoVolts(pinV, c);

  float ppm = agap::mq7PpmFromAdcVolts(pinV, c);
  rawCOppm = ppm;
  if (firstReading) {
    lastCOppm = ppm;
    firstReading = false;
    haveValidReading = true;
  } else {
    lastCOppm = (1.0f - SMOOTHING) * lastCOppm + SMOOTHING * ppm;
  }
  evaluateLevel();

  if (!mq7Ready && millis() - mq7StartMs >= MQ7_WARMUP_MS) {
    mq7Ready = true;
    TLOG("MQ-7 warm-up complete (%lu ms) — readings now trusted", MQ7_WARMUP_MS);
  }

  const char* names[] = {"normal", "elevated", "high", "SERIOUS", "CRITICAL"};
  TLOG("MQ-7: %.1f ppm (raw %.1f) | %s | pin %d mV | AO %.2fV | Rs %.0f ohm%s",
       lastCOppm, rawCOppm, names[coLevel], mq7PinMvLast, mq7VoutLast,
       agap::mq7RsOhms(pinV, c), mq7Ready ? "" : " (warming up)");
}

// R0 is Rs at 100 ppm, so a clean-air Rs is divided by the datasheet's
// clean-air ratio (~27.5) — the same rule config.h's calibration note uses.
void calibrateMQ7() {
  Serial.println("Calibrating MQ-7 R0 in clean air... keep it away from any CO source.");
  const int pinMv = mq7ReadPinMv(50, 100);
  const float rs = agap::mq7RsOhms(pinMv / 1000.0f, mq7Circuit());
  if (rs <= 0.0f) {
    Serial.printf("Calibration failed — pin reads %d mV (0 V or saturated), check wiring.\n", pinMv);
    return;
  }
  Ro = agap::mq7R0FromCleanAirRs(rs);
  prefs.putFloat("ro2", Ro);
  Serial.printf("Calibration done. Clean-air Rs = %.1f ohm, R0 = %.1f ohm (saved to flash)\n", rs, Ro);
}

// ===================== Other sensors ===================================

void readTemperature() {
  ds18b20.requestTemperatures();
  float t = ds18b20.getTempCByIndex(0);
  if (t != DEVICE_DISCONNECTED_C && t > -55.0f && t < 125.0f) {
    lastTempC = t;
    tempOk = true;
    TLOG("DS18B20: %.2f C", t);
  } else {
    tempOk = false;
    TLOG("DS18B20: ERROR — sensor not detected (check wiring/pull-up)");
  }
}

void readGPS() {
  while (GPS_SERIAL.available() > 0) {
    if (gps.encode(GPS_SERIAL.read())) {
      if (gps.satellites.isValid()) gpsSats = gps.satellites.value();
      gpsFixValid = gps.location.isValid();
      if (gpsFixValid) {
        lastLat = gps.location.lat();
        lastLng = gps.location.lng();
      }
    }
  }

  static uint32_t lastGpsLog = 0;
  if (millis() - lastGpsLog >= 5000) {
    lastGpsLog = millis();
    if (gpsFixValid) {
      TLOG("GPS: lat=%.6f lng=%.6f sats=%d", lastLat, lastLng, gpsSats);
    } else {
      TLOG("GPS: no fix yet (chars processed=%lu, sats=%d) — check antenna/open sky",
           gps.charsProcessed(), gpsSats);
    }
  }
}

void readBattery() {
  // No real battery/divider circuit wired on this bench board (GPIO35 floats —
  // confirmed by readings swinging 0-6000mV in step with unrelated MQ-7
  // activity). Still updates batteryMv for /data, just stopped logging it.
  int raw = analogRead(BATTERY_ADC_PIN);
  batteryMv = (int)(raw * (float)ADC_VREF_MV / ADC_MAX_RAW * BATTERY_DIVIDER_RATIO);
}

static bool gsmTryAt(uint32_t timeoutMs) {
  while (GSM_SERIAL.available()) GSM_SERIAL.read();  // flush stale bytes
  GSM_SERIAL.print("AT\r\n");
  String resp;
  uint32_t start = millis();
  while (millis() - start < timeoutMs) {
    while (GSM_SERIAL.available()) resp += (char)GSM_SERIAL.read();
  }
  return resp.indexOf("OK") >= 0;
}

// Run once at boot: config.h assumes 9600 baud, but some SIM800L modules ship
// defaulting to a different rate. Cycles common rates on the same RX/TX pins
// (network LED confirmed the module itself is alive, so a plain no-response
// at the configured baud points at a UART mismatch rather than power/wiring)
// and leaves GSM_SERIAL on whichever one answers.
void gsmAutoBaud() {
  const uint32_t candidates[] = {9600, 19200, 38400, 57600, 115200};
  TLOG("GSM: auto-baud scan starting (configured: %lu)", (unsigned long)GSM_BAUD);
  for (size_t i = 0; i < sizeof(candidates) / sizeof(candidates[0]); i++) {
    GSM_SERIAL.updateBaudRate(candidates[i]);
    delay(100);
    bool ok = gsmTryAt(500) || gsmTryAt(500);   // two tries per rate
    TLOG("GSM: baud %lu -> %s", (unsigned long)candidates[i], ok ? "OK" : "no response");
    if (ok) {
      gsmBaud = candidates[i];
      gsmOk   = true;
      TLOG("GSM: auto-baud locked to %lu", (unsigned long)gsmBaud);
      return;
    }
  }
  TLOG("GSM: auto-baud scan found nothing on any rate — check wiring/power");
  GSM_SERIAL.updateBaudRate(GSM_BAUD);   // fall back to configured rate
}

void gsmPing() {
  if (gsmBusySending) return;   // don't interrupt an in-flight SMS send
  gsmOk = gsmTryAt(800);
  TLOG("GSM: AT -> %s", gsmOk ? "OK (module responding)" : "no response (check power/baud/wiring)");
}

// ===================== Level logic =====================================

int levelFor(float ppm) {
  if (ppm >= LVL_CRITICAL) return 4;
  if (ppm >= LVL_SERIOUS)  return 3;
  if (ppm >= LVL_HIGH)     return 2;
  if (ppm >= LVL_ELEVATED) return 1;
  return 0;
}

void evaluateLevel() {
  int now = levelFor(lastCOppm);

  if (now == pendingLevel) levelCount++;
  else { pendingLevel = now; levelCount = 1; }

  if (levelCount >= ALARM_PERSISTENCE && coLevel != pendingLevel) {
    int previous = coLevel;
    coLevel = pendingLevel;
    TLOG("Level changed: %d -> %d", previous, coLevel);

    if (coLevel >= 3 && coLevel > previous) {
      bool cooled = (lastAlertTime == 0 || millis() - lastAlertTime > ALERT_COOLDOWN_MS);
      bool escalated = (coLevel > lastAlertLevel);

      if (cooled || escalated) {
        String msg = String(DEVICE_NAME) + "\n";
        msg += (coLevel == 4) ? "CRITICAL CO ALERT\n" : "CO WARNING\n";
        msg += "Level: " + String(lastCOppm, 1) + " ppm\n";
        msg += "Temp: " + String(lastTempC, 1) + " C\n";
        if (gpsFixValid) {
          msg += "Location: " + String(lastLat, 6) + "," + String(lastLng, 6) + "\n";
          msg += "https://maps.google.com/?q=" + String(lastLat, 6) + "," + String(lastLng, 6);
        } else {
          msg += "Location: no GPS fix";
        }

        bool sent = sendTelegram(msg);
        if (SMS_ENABLED) sendSMS(msg, TEST_SMS_PHONE1);

        if (sent) {
          lastAlertTime = millis();
          lastAlertLevel = coLevel;
        }
      }
    }
    if (coLevel < 3) lastAlertLevel = 0;
  }
}

// ===================== Indicators ======================================
// Yellow/Red follow the CO level gradient below (test-dashboard semantics).
// Blue follows config.h's documented meaning: solid=ONLINE, blink=connecting,
// off=OFFLINE.

void ledWrite(int pin, bool on) {
  digitalWrite(pin, LED_ACTIVE_LOW ? !on : on);
}

void buzzerOn() {
  if (ACTIVE_BUZZER) digitalWrite(BUZZER_PIN, HIGH);
  else                tone(BUZZER_PIN, BUZZER_TONE_HZ);
}

void buzzerOff() {
  if (ACTIVE_BUZZER) digitalWrite(BUZZER_PIN, LOW);
  else                noTone(BUZZER_PIN);
}

void updateIndicators() {
  unsigned long t = millis();

  if (WiFi.status() == WL_CONNECTED) {
    ledWrite(LED_BLUE_PIN, true);
  } else {
    ledWrite(LED_BLUE_PIN, (t % 1000) < 500);   // blinking while (re)connecting
  }

  switch (coLevel) {
    case 0:
      ledWrite(LED_YELLOW_PIN, false);
      ledWrite(LED_RED_PIN, false);
      buzzerOff();
      break;
    case 1:                           // elevated
      ledWrite(LED_YELLOW_PIN, true);
      ledWrite(LED_RED_PIN, false);
      buzzerOff();
      break;
    case 2:                           // high
      ledWrite(LED_YELLOW_PIN, (t % 1000) < 500);
      ledWrite(LED_RED_PIN, false);
      buzzerOff();
      break;
    case 3:                           // serious
      ledWrite(LED_YELLOW_PIN, false);
      ledWrite(LED_RED_PIN, true);
      buzzerOn();
      break;
    case 4:                           // critical
      ledWrite(LED_YELLOW_PIN, false);
      ledWrite(LED_RED_PIN, (t % 400) < 200);
      buzzerOn();
      break;
  }
}

// ===================== Telegram ========================================

bool sendTelegram(const String &msg) {
  if (!TELEGRAM_ENABLED) { lastAlertResult = "disabled"; return false; }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Telegram failed: no WiFi.");
    lastAlertResult = "no wifi";
    return false;
  }

  Serial.println("Sending Telegram alert...");

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(10000);

  HTTPClient https;
  String url = "https://api.telegram.org/bot" + String(TEST_BOT_TOKEN) + "/sendMessage";

  if (!https.begin(client, url)) {
    lastAlertResult = "connect failed";
    return false;
  }
  https.addHeader("Content-Type", "application/json");

  String safe = msg;
  safe.replace("\\", "\\\\");
  safe.replace("\"", "\\\"");
  safe.replace("\n", "\\n");

  String payload = "{\"chat_id\":\"" + String(TEST_CHAT_ID) +
                   "\",\"text\":\"" + safe + "\"}";

  int code = https.POST(payload);
  String body = https.getString();
  https.end();

  if (code == 200) {
    Serial.println("Telegram alert sent.");
    lastAlertResult = "sent";
    return true;
  }

  Serial.printf("Telegram failed. HTTP %d\n%s\n", code, body.c_str());
  if (body.indexOf("chat not found") >= 0) {
    Serial.println("  Message your bot first so it can reply to you.");
  }
  lastAlertResult = "http " + String(code);
  return false;
}

// ===================== SIM800L =========================================

String simCommand(const String &c, unsigned long timeout) {
  while (GSM_SERIAL.available()) GSM_SERIAL.read();
  GSM_SERIAL.println(c);
  String r = "";
  unsigned long start = millis();
  while (millis() - start < timeout) {
    while (GSM_SERIAL.available()) r += (char)GSM_SERIAL.read();
    if (r.indexOf("OK") >= 0 || r.indexOf("ERROR") >= 0) break;
    delay(10);
  }
  return r;
}

bool initSIM800() {
  simReady = false;
  Serial.println("Checking SIM800L...");

  if (simCommand("AT", 1500).indexOf("OK") < 0) {
    Serial.println("  No response. Check power and TX/RX.");
    return false;
  }
  simCommand("ATE0", 1000);
  simCommand("AT+CMGF=1", 1000);

  if (simCommand("AT+CPIN?", 5000).indexOf("READY") < 0) {
    Serial.println("  SIM not ready.");
    return false;
  }

  String reg = simCommand("AT+CREG?", 5000);
  if (reg.indexOf(",1") < 0 && reg.indexOf(",5") < 0) {
    Serial.println("  Not registered on the network. SMS will not send.");
    return false;
  }

  Serial.println("  Registered. SMS available.");
  simReady = true;
  return true;
}

bool sendSMS(const String &msg, const String &to) {
  if (!SMS_ENABLED) { TLOG("SMS: disabled in config"); return false; }
  if (!simReady && !initSIM800()) { TLOG("SMS: aborted — SIM800L not responding to AT"); return false; }

  gsmBusySending = true;
  simCommand("AT+CMGF=1", 2000);
  while (GSM_SERIAL.available()) GSM_SERIAL.read();

  GSM_SERIAL.print("AT+CMGS=\"");
  GSM_SERIAL.print(to);
  GSM_SERIAL.println("\"");

  bool prompt = false;
  String preResp;
  unsigned long start = millis();
  while (millis() - start < 8000) {
    if (GSM_SERIAL.available()) {
      char c = GSM_SERIAL.read();
      if (c == '>') { prompt = true; break; }
      preResp += c;
    }
  }
  if (!prompt) {
    GSM_SERIAL.write(27);
    preResp.replace("\r", " ");
    preResp.replace("\n", " ");
    TLOG("SMS: failed — no '>' prompt after AT+CMGS. Module said: '%s'", preResp.c_str());
    gsmBusySending = false;
    return false;
  }

  GSM_SERIAL.print(msg);
  GSM_SERIAL.write(26);

  String r = "";
  start = millis();
  while (millis() - start < 30000) {
    while (GSM_SERIAL.available()) r += (char)GSM_SERIAL.read();
    if (r.indexOf("+CMGS") >= 0 || r.indexOf("ERROR") >= 0) break;
    delay(10);
  }

  bool ok = (r.indexOf("+CMGS") >= 0);
  if (ok) {
    TLOG("SMS: sent to %s", to.c_str());
  } else {
    String rTrim = r;
    rTrim.replace("\r", " ");
    rTrim.replace("\n", " ");
    TLOG("SMS: failed to %s. Module said: '%s'", to.c_str(), rTrim.c_str());
  }
  if (!ok) simReady = false;
  gsmBusySending = false;
  return ok;
}

// ===================== Serial commands =================================

void handleSerialCommands() {
  if (!Serial.available()) return;
  char c = Serial.read();

  switch (c) {
    case 'i':
      Serial.printf("R0 %.1f ohm | pin %d mV | AO %.3f V | %.1f ppm | level %d\n",
                    Ro, mq7PinMvLast, mq7VoutLast, rawCOppm, coLevel);
      Serial.printf("Thresholds: %.0f / %.0f / %.0f / %.0f ppm\n",
                    LVL_ELEVATED, LVL_HIGH, LVL_SERIOUS, LVL_CRITICAL);
      Serial.printf("Last alert: %s | Temp sensor: %s | GSM: %s | Battery: %d mV\n",
                    lastAlertResult.c_str(), tempOk ? "ok" : "FAULT",
                    gsmOk ? "ok" : "no response", batteryMv);
      break;

    case 'c':
      calibrateMQ7();
      break;

    case 'w':
      if (WiFi.status() == WL_CONNECTED) {
        Serial.print("Connected. IP: ");
        Serial.print(WiFi.localIP());
        Serial.printf("  RSSI %d dBm\n", WiFi.RSSI());
      } else Serial.println("Not connected.");
      break;

    case 'g':
      Serial.printf("GPS: chars %lu | sentences %lu | errors %lu | sats %d\n",
                    gps.charsProcessed(), gps.sentencesWithFix(),
                    gps.failedChecksum(), gpsSats);
      if (gps.charsProcessed() < 10) Serial.println("  No data. Check TX/RX crossed.");
      break;

    case 'f': {
      if (ACTIVE_BUZZER) { Serial.println("Active buzzer - tone is fixed."); break; }
      Serial.println("Sweeping. Listen for the loudest point.");
      for (int f = 1500; f <= 5000; f += 250) {
        Serial.printf("  %d Hz\n", f);
        tone(BUZZER_PIN, f); delay(900); noTone(BUZZER_PIN); delay(150);
      }
      Serial.println("Put the loudest value in BUZZER_TONE_HZ.");
      break;
    }

    case 'T': sendTelegram(String(DEVICE_NAME) + "\nTest message."); break;
    case 'S':
      if (!SMS_ENABLED) Serial.println("SMS disabled in config.");
      else sendSMS(String(DEVICE_NAME) + " test SMS.", TEST_SMS_PHONE1);
      break;
  }
}

// ===================== Web dashboard ===================================

const char INDEX_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b0f14">
<title>AgapSense Test Node</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0b0f14;--panel:#141b23;--line:#25313d;--txt:#e8eef5;--dim:#8ba0b4;--accent:#4fc3f7}
body{background:var(--bg);color:var(--txt);
 font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
 padding:16px 16px 40px;max-width:880px;margin:0 auto;-webkit-font-smoothing:antialiased}
header{display:flex;align-items:center;justify-content:space-between;gap:10px;
 flex-wrap:wrap;margin-bottom:16px}
h1{font-size:clamp(1.05rem,4.2vw,1.35rem);font-weight:650;letter-spacing:-.02em}
h1 span{color:var(--accent)}
.live{display:flex;align-items:center;gap:7px;font-size:.78rem;color:var(--dim)}
.dot{width:8px;height:8px;border-radius:50%;background:#3ddc97;animation:pulse 2s infinite}
.dot.off{background:#ff4d5e;animation:none}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes flash{0%,100%{opacity:1}50%{opacity:.4}}
.hero{background:var(--panel);border:1px solid var(--line);border-radius:18px;
 padding:24px 20px;margin-bottom:12px;display:flex;align-items:center;gap:24px;
 flex-wrap:wrap;justify-content:center}
.hero.crit{animation:flash 1s infinite}
.ring{--pct:0;--col:#3ddc97;width:154px;height:154px;border-radius:50%;flex:none;
 background:conic-gradient(var(--col) calc(var(--pct)*1%),#223040 0);
 display:grid;place-items:center;transition:background .5s ease}
.ringIn{width:128px;height:128px;border-radius:50%;background:var(--panel);
 display:grid;place-items:center;align-content:center}
.val{font-size:2.3rem;font-weight:700;line-height:1;letter-spacing:-.03em}
.unit{font-size:.75rem;color:var(--dim);margin-top:5px;letter-spacing:.09em}
.heroTxt{flex:1;min-width:190px;text-align:center}
@media(min-width:560px){.heroTxt{text-align:left}}
.pill{display:inline-block;padding:6px 15px;border-radius:999px;font-size:.76rem;
 font-weight:700;letter-spacing:.11em;margin-bottom:10px}
.msg{color:var(--dim);font-size:.9rem;line-height:1.55}
.scale{display:flex;gap:4px;margin-top:14px}
.seg{flex:1;height:5px;border-radius:99px;background:#223040}
.scaleLbl{display:flex;justify-content:space-between;font-size:.62rem;
 color:var(--dim);margin-top:5px}
.grid{display:grid;gap:12px;grid-template-columns:1fr}
@media(min-width:560px){.grid{grid-template-columns:1fr 1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.lbl{font-size:.7rem;color:var(--dim);letter-spacing:.1em;text-transform:uppercase;margin-bottom:9px}
.big{font-size:1.5rem;font-weight:650;letter-spacing:-.02em}
.sub{font-size:.82rem;color:var(--dim);margin-top:5px;line-height:1.5}
a{color:var(--accent);text-decoration:none}
footer{text-align:center;color:var(--dim);font-size:.72rem;margin-top:22px;line-height:1.6}
</style></head><body>

<header>
 <h1>AgapSense <span>Test Node</span></h1>
 <div class="live"><div class="dot" id="dot"></div><span id="conn">Connecting</span></div>
</header>

<div class="hero" id="hero">
 <div class="ring" id="ring"><div class="ringIn">
  <div class="val" id="ppm">--</div><div class="unit">PPM</div>
 </div></div>
 <div class="heroTxt">
  <div class="pill" id="pill">WARMING UP</div>
  <div class="msg" id="msg">Waiting for the first sensor reading.</div>
  <div class="scale">
   <div class="seg" id="s0"></div><div class="seg" id="s1"></div>
   <div class="seg" id="s2"></div><div class="seg" id="s3"></div>
   <div class="seg" id="s4"></div>
  </div>
  <div class="scaleLbl"><span>0</span><span>10</span><span>30</span>
   <span>50</span><span>100+</span></div>
 </div>
</div>

<div class="grid">
 <div class="card">
  <div class="lbl">Raw sample</div>
  <div class="big" id="raw">--</div>
  <div class="sub" id="ao">Sensor output: -- V</div>
 </div>
 <div class="card">
  <div class="lbl">Temperature</div>
  <div class="big" id="temp">--</div>
  <div class="sub" id="tsub">DS18B20 probe</div>
 </div>
 <div class="card">
  <div class="lbl">Location</div>
  <div class="big" id="gps">No fix</div>
  <div class="sub" id="coords">Waiting for satellites</div>
 </div>
 <div class="card">
  <div class="lbl">System</div>
  <div class="big" id="up">--</div>
  <div class="sub" id="sys">Alerts: --</div>
 </div>
</div>

<footer>
 Bench test harness — not the production AgapSense firmware.<br>
 Continuously heated MQ-7 also responds to hydrogen, alcohol and LPG.
</footer>

<script>
var $=function(i){return document.getElementById(i)};
var COLS=["#3ddc97","#ffc233","#ff9838","#ff4d5e","#ff2d42"];
var NAMES=["NORMAL","ELEVATED","HIGH","SERIOUS","CRITICAL"];
var MSGS=["CO is within the normal background range.",
 "CO is above background. Keep monitoring.",
 "CO is high. Check for a source and ventilate now.",
 "Serious CO level. Ventilate and move people to fresh air.",
 "Critical CO level. Evacuate the area immediately."];
function fmtUp(s){var h=Math.floor(s/3600),m=Math.floor(s%3600/60);
 return h>0?h+"h "+m+"m":m+"m "+(s%60)+"s";}
function render(d){
 var lv=d.level,col=COLS[lv],st=NAMES[lv],msg=MSGS[lv];
 if(!d.valid){st="WARMING UP";col="#8ba0b4";msg="MQ-7 heater is in its warm-up cycle.";}
 $("ppm").textContent=d.valid?d.co_ppm.toFixed(1):"--";
 var p=d.valid?Math.min(100,d.co_ppm/150*100):0;
 $("ring").style.setProperty("--pct",p);
 $("ring").style.setProperty("--col",col);
 $("pill").textContent=st;$("pill").style.background=col;
 $("pill").style.color="#0b0f14";$("msg").textContent=msg;
 $("hero").className=(lv==4&&d.valid)?"hero crit":"hero";
 for(var i=0;i<5;i++)
  $("s"+i).style.background=(d.valid&&i<=lv)?COLS[i]:"#223040";
 $("raw").textContent=d.co_raw.toFixed(1)+" ppm";
 $("ao").textContent="Sensor output: "+d.ao_v.toFixed(3)+" V";
 $("temp").textContent=d.temp_ok?d.temp_c.toFixed(1)+" °C":"--";
 $("tsub").textContent=d.temp_ok?"DS18B20 probe":"Probe not responding";
 if(d.gps_fix){$("gps").textContent="Fix acquired";
  $("coords").innerHTML=d.lat.toFixed(6)+", "+d.lng.toFixed(6)+" &middot; "+
   d.sats+" sats &middot; "+'<a href="https://maps.google.com/?q='+d.lat+
   ','+d.lng+'" target="_blank">Map</a>';}
 else{$("gps").textContent="No fix";
  $("coords").textContent="Waiting for satellites ("+d.sats+" visible)";}
 $("up").textContent=fmtUp(d.uptime_s);
 $("sys").innerHTML="Alerts: "+d.alert+"<br>Signal: "+d.rssi+" dBm"+
  "<br>Battery: "+d.battery_mv+" mV<br>GSM module: "+(d.gsm_ok?"OK":"no response");
}
function tick(){
 fetch("/data",{cache:"no-store"}).then(function(r){return r.json()})
 .then(function(d){render(d);$("dot").classList.remove("off");
  $("conn").textContent="Live";})
 .catch(function(){$("dot").classList.add("off");$("conn").textContent="Offline";});
}
tick();setInterval(tick,1000);
</script></body></html>
)rawliteral";

void handleRoot() {
  server.send_P(200, "text/html", INDEX_HTML);
}

void handleLogRaw() {
  String out;
  out.reserve(LOG_BUF_LINES * LOG_LINE_MAX);
  int start = logWrapped ? logHead : 0;
  int count = logWrapped ? LOG_BUF_LINES : logHead;
  for (int i = 0; i < count; i++) {
    out += logLines[(start + i) % LOG_BUF_LINES];
    out += "\n";
  }
  if (count == 0) out = "(no log lines yet)\n";
  server.send(200, "text/plain", out);
}

// GET /send-sms?to=+639954106566&msg=hello — ad-hoc SMS test, since there's
// no USB/serial access to use the 'S' serial command on this board. Defaults
// to TEST_SMS_PHONE1 and a generic message when query params are omitted.
void handleSendSms() {
  String to  = server.hasArg("to")  ? server.arg("to")  : String(TEST_SMS_PHONE1);
  String msg = server.hasArg("msg") ? server.arg("msg")
                                     : String(DEVICE_NAME) + " bench SMS test.";
  TLOG("SMS: /send-sms requested -> %s", to.c_str());
  bool ok = sendSMS(msg, to);
  String body = String("{\"success\":") + (ok ? "true" : "false") +
                ",\"to\":\"" + to + "\",\"msg\":\"" + msg + "\"}";
  server.send(ok ? 200 : 502, "application/json", body);
}

const char LOG_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgapSense Test Log</title>
<style>
body{background:#0b0f14;color:#e8eef5;font-family:ui-monospace,Consolas,monospace;
 font-size:13px;margin:0;padding:12px}
h1{font-size:15px;font-weight:600;margin:0 0 10px;color:#4fc3f7}
pre{white-space:pre-wrap;word-break:break-word;line-height:1.5}
</style></head><body>
<h1>AgapSense Test Node — Live Log</h1>
<pre id="log">loading...</pre>
<script>
function tick(){
 fetch("/log/raw",{cache:"no-store"}).then(function(r){return r.text()})
 .then(function(t){
   var el=document.getElementById("log");
   var atBottom = (window.innerHeight + window.scrollY) >= document.body.offsetHeight - 40;
   el.textContent=t;
   if(atBottom) window.scrollTo(0, document.body.scrollHeight);
 });
}
tick();setInterval(tick,1000);
</script></body></html>
)rawliteral";

void handleLog() {
  server.send_P(200, "text/html", LOG_HTML);
}

void handleData() {
  String json = "{";
  json += "\"device\":\"" + String(DEVICE_NAME) + "\",";
  json += "\"co_ppm\":"   + String(lastCOppm, 1) + ",";
  json += "\"co_raw\":"   + String(rawCOppm, 1) + ",";
  json += "\"valid\":"    + String(haveValidReading ? "true" : "false") + ",";
  json += "\"level\":"    + String(coLevel) + ",";
  json += "\"ao_v\":"     + String(mq7VoutLast, 3) + ",";
  json += "\"temp_c\":"   + String(lastTempC, 1) + ",";
  json += "\"temp_ok\":"  + String(tempOk ? "true" : "false") + ",";
  json += "\"gps_fix\":"  + String(gpsFixValid ? "true" : "false") + ",";
  json += "\"sats\":"     + String(gpsSats) + ",";
  json += "\"lat\":"      + String(lastLat, 6) + ",";
  json += "\"lng\":"      + String(lastLng, 6) + ",";
  json += "\"alert\":\""  + lastAlertResult + "\",";
  json += "\"rssi\":"     + String(WiFi.RSSI()) + ",";
  json += "\"battery_mv\":" + String(batteryMv) + ",";
  json += "\"gsm_ok\":"   + String(gsmOk ? "true" : "false") + ",";
  json += "\"uptime_s\":" + String(millis() / 1000);
  json += "}";

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", json);
}

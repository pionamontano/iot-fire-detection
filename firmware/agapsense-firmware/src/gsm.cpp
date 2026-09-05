// ============================================================
// gsm.cpp — SIM800L AT Command Handler  (v2.0)
//
// Changes from v1.0:
//   + gsmSendOwnerSms() — evacuation message for property owner
//   + gsmSendBfpSms()   — technical message for BFP responder
//   ~ gsmSendAlertSms() removed
// ============================================================

#include "gsm.h"

#if DEBUG_MODE
  #define GSMLOG(fmt, ...) Serial.printf("[GSM] " fmt "\n", ##__VA_ARGS__)
#else
  #define GSMLOG(fmt, ...)
#endif

static SmsJob           smsQueue = {"", "", false};
static SemaphoreHandle_t smsMutex = nullptr;

// ── Internal: drain UART until OK / ERROR / > or timeout ──
static void gsmReadResponse(char* buf, size_t bufLen, uint32_t timeoutMs) {
    uint32_t start = millis();
    size_t   pos   = 0;
    memset(buf, 0, bufLen);
    while (millis() - start < timeoutMs) {
        while (GSM_SERIAL.available() && pos < bufLen - 1)
            buf[pos++] = (char)GSM_SERIAL.read();
        if (strstr(buf, "OK")    != nullptr) break;
        if (strstr(buf, "ERROR") != nullptr) break;
        if (strstr(buf, ">")     != nullptr) break;
        delay(10);
    }
}

// ── Send AT command ────────────────────────────────────────
bool gsmSendAT(const char* cmd, const char* expected, uint32_t timeoutMs) {
    while (GSM_SERIAL.available()) GSM_SERIAL.read();  // flush stale bytes
    GSM_SERIAL.print(cmd);
    GSM_SERIAL.print("\r\n");
    GSMLOG("AT → %s", cmd);
    char response[256];
    gsmReadResponse(response, sizeof(response), timeoutMs);
    GSMLOG("AT ← %s", response);
    return (strstr(response, expected) != nullptr);
}

// ── Init ───────────────────────────────────────────────────
void gsmInit() {
    smsMutex = xSemaphoreCreateMutex();
    GSM_SERIAL.begin(GSM_BAUD, SERIAL_8N1, GSM_RX_PIN, GSM_TX_PIN);

    GSMLOG("Waiting for SIM800L boot (~3 s)...");
    delay(3000);

    // Auto-baud sync
    bool ok = false;
    for (int i = 0; i < 10 && !ok; i++) {
        ok = gsmSendAT("AT", "OK", 1000);
        if (!ok) delay(500);
    }
    if (!ok) { GSMLOG("ERROR: SIM800L not responding — check power and wiring"); return; }

    gsmSendAT("ATE0",          "OK", 1000);    // disable echo
    gsmSendAT("AT+CMGF=1",     "OK", 1000);    // SMS text mode
    gsmSendAT("AT+CSCS=\"GSM\"","OK", 1000);   // GSM character set

    // Wait for network registration (up to 30 s)
    GSMLOG("Waiting for network registration...");
    uint32_t start = millis();
    bool reg = false;
    while (millis() - start < 30000) {
        char r[128];
        GSM_SERIAL.print("AT+CREG?\r\n");
        gsmReadResponse(r, sizeof(r), 2000);
        if (strstr(r, ",1") || strstr(r, ",5")) { reg = true; break; }
        delay(2000);
    }
    GSMLOG(reg ? "SIM800L registered on network" : "WARN: not registered — SMS will fail");
    gsmSendAT("AT+CSQ", "OK", 1000);  // log signal quality
}

// ── Send SMS (blocking) ────────────────────────────────────
bool gsmSendSms(const char* to, const char* message) {
    char cmd[64];
    snprintf(cmd, sizeof(cmd), "AT+CMGS=\"%s\"", to);

    while (GSM_SERIAL.available()) GSM_SERIAL.read();
    GSM_SERIAL.print(cmd);
    GSM_SERIAL.print("\r\n");
    GSMLOG("SMS → %s", to);

    // Wait for '>' prompt
    uint32_t start = millis();
    bool got = false;
    while (millis() - start < 5000) {
        if (GSM_SERIAL.available() && GSM_SERIAL.read() == '>') { got = true; break; }
        delay(10);
    }
    if (!got) { GSMLOG("ERROR: no '>' prompt"); return false; }

    GSM_SERIAL.print(message);
    GSM_SERIAL.write(0x1A);   // Ctrl+Z = send

    char response[256];
    gsmReadResponse(response, sizeof(response), 15000);
    bool sent = (strstr(response, "+CMGS") != nullptr);
    GSMLOG(sent ? "SMS sent OK" : "ERROR: SMS send failed — %s", response);
    return sent;
}

// ── Owner SMS: plain-language evacuation ───────────────────
void gsmSendOwnerSms(float co_ppm, float temp_c,
                     double lat, double lng,
                     const char* ownerNumber)
{
    char msg[160];
    snprintf(msg, sizeof(msg),
        "BANTAY APOY ALERTO!\n"
        "Lumayas na agad. CO:%.0fppm Temp:%.1fC\n"
        "Lokasyon: maps.google.com/?q=%.5f,%.5f",
        co_ppm, temp_c, lat, lng
    );
    GSMLOG("Sending owner SMS to %s", ownerNumber);
    gsmSendSms(ownerNumber, msg);
}

// ── BFP SMS: technical responder message ───────────────────
void gsmSendBfpSms(float co_ppm, float temp_c,
                   double lat, double lng,
                   const char* bfpNumber)
{
    char msg[160];
    // Include device ID, sensor readings, and coordinates
    // Timestamp omitted (160-char limit); backend logs full record
    snprintf(msg, sizeof(msg),
        "BFP ALERT [%s]\n"
        "CO:%.0fppm Temp:%.1fC\n"
        "GPS:%.5f,%.5f\n"
        "maps.google.com/?q=%.5f,%.5f",
        DEVICE_ID,
        co_ppm, temp_c,
        lat, lng,
        lat, lng
    );
    GSMLOG("Sending BFP SMS to %s", bfpNumber);
    gsmSendSms(bfpNumber, msg);
}

// ── Async queue ────────────────────────────────────────────
void gsmQueueSms(const char* number, const char* message) {
    if (!smsMutex) return;
    if (xSemaphoreTake(smsMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        if (!smsQueue.pending) {
            strncpy(smsQueue.number,  number,  sizeof(smsQueue.number)  - 1);
            strncpy(smsQueue.message, message, sizeof(smsQueue.message) - 1);
            smsQueue.pending = true;
        } else {
            GSMLOG("WARN: SMS queue full — message dropped");
        }
        xSemaphoreGive(smsMutex);
    }
}

void gsmProcessQueue() {
    if (!smsMutex) return;
    if (xSemaphoreTake(smsMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        if (smsQueue.pending) {
            char num[20], msg[160];
            strncpy(num, smsQueue.number,  sizeof(num) - 1);
            strncpy(msg, smsQueue.message, sizeof(msg) - 1);
            smsQueue.pending = false;
            xSemaphoreGive(smsMutex);
            gsmSendSms(num, msg);   // send outside mutex (blocking)
        } else {
            xSemaphoreGive(smsMutex);
        }
    }
}

bool gsmIsRegistered() {
    char r[128];
    GSM_SERIAL.print("AT+CREG?\r\n");
    gsmReadResponse(r, sizeof(r), 2000);
    return (strstr(r, ",1") != nullptr || strstr(r, ",5") != nullptr);
}

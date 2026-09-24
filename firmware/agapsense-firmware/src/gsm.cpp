// ============================================================
// gsm.cpp — SIM800L AT Command Handler  (v2.1)
//
// Changes from v2.0:
//   ~ gsmSendOwnerSms()/gsmSendBfpSms() now call gsmQueueSms() instead
//     of gsmSendSms() directly, so composing + sending an SMS never
//     blocks the caller (the Connectivity task).
//   ~ Queue is now a SMS_QUEUE_SIZE-slot ring buffer (was a single
//     job) so Tier 2's owner + BFP messages can both be queued
//     without the second one being dropped.
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

static SmsJob            smsQueue[SMS_QUEUE_SIZE];
static uint8_t           smsHead  = 0;   // next slot to dequeue
static uint8_t           smsTail  = 0;   // next free slot to enqueue
static uint8_t           smsCount = 0;   // jobs currently queued

static SmsResult         resultQueue[SMS_QUEUE_SIZE];
static uint8_t           resultHead  = 0;   // next slot to dequeue
static uint8_t           resultTail  = 0;   // next free slot to enqueue
static uint8_t           resultCount = 0;   // results currently queued

static SemaphoreHandle_t smsMutex = nullptr;   // guards both queues above

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
// Composes the message and hands it to the async queue — does not
// block the caller (previously called gsmSendSms() directly, which
// could stall the Connectivity task and its WDT reset).
void gsmSendOwnerSms(float co_ppm, float temp_c,
                     double lat, double lng,
                     const char* address,
                     const char* ownerNumber,
                     const char* alertEventId)
{
    char msg[200];
    if (address && address[0] != '\0') {
        // Maps link comes before the address, not after: no concatenated-SMS
        // setup exists on this module (plain AT+CMGS text mode), so a message
        // this long risks silent truncation at the single-segment ~160 GSM-7
        // char boundary. If it's cut, this ordering means only the address's
        // tail is lost — the link (the one thing the spec calls mandatory in
        // every message) always survives intact.
        snprintf(msg, sizeof(msg),
            "BANTAY APOY ALERTO!\n"
            "Lumayas na agad. CO:%.0fppm Temp:%.1fC\n"
            "https://maps.google.com/?q=%.5f,%.5f\n"
            "Lokasyon: %.40s",
            co_ppm, temp_c, lat, lng, address
        );
    } else {
        snprintf(msg, sizeof(msg),
            "BANTAY APOY ALERTO!\n"
            "Lumayas na agad. CO:%.0fppm Temp:%.1fC\n"
            "Lokasyon: https://maps.google.com/?q=%.5f,%.5f",
            co_ppm, temp_c, lat, lng
        );
    }
    GSMLOG("Queuing owner SMS to %s", ownerNumber);
    gsmQueueSms(ownerNumber, msg, "owner", alertEventId);
}

// ── BFP SMS: technical responder message ───────────────────
// Composes the message and hands it to the async queue — does not
// block the caller.
void gsmSendBfpSms(float co_ppm, float temp_c,
                   double lat, double lng,
                   const char* address,
                   const char* triggeredAt,
                   const char* bfpNumber,
                   const char* alertEventId)
{
    char msg[220];
    // Device ID, server timestamp (the ESP32 has no RTC/NTP of its own —
    // triggered_at comes from trigger-alert's response), sensor readings,
    // maps link (which already encodes lat/lng — no separate "GPS:" line;
    // every byte matters here, see below), and reverse-geocoded address
    // when available (SW-2.2.2).
    const char* timeStr = (triggeredAt && triggeredAt[0] != '\0') ? triggeredAt : "unknown";
    if (address && address[0] != '\0') {
        // Address is appended last, after the maps link, for the same
        // truncation-safety reason as gsmSendOwnerSms() above — no
        // concatenated-SMS setup exists, so if this gets cut at the
        // module/network's single-segment (~160 GSM-7 char) limit, only
        // the address's tail is lost, never the link.
        snprintf(msg, sizeof(msg),
            "BFP ALERT [%s]\n"
            "Time:%s\n"
            "CO:%.0fppm Temp:%.1fC\n"
            "https://maps.google.com/?q=%.5f,%.5f\n"
            "Loc:%.40s",
            DEVICE_ID, timeStr,
            co_ppm, temp_c,
            lat, lng, address
        );
    } else {
        snprintf(msg, sizeof(msg),
            "BFP ALERT [%s]\n"
            "Time:%s\n"
            "CO:%.0fppm Temp:%.1fC\n"
            "https://maps.google.com/?q=%.5f,%.5f",
            DEVICE_ID, timeStr,
            co_ppm, temp_c,
            lat, lng
        );
    }
    GSMLOG("Queuing BFP SMS to %s", bfpNumber);
    gsmQueueSms(bfpNumber, msg, "bfp", alertEventId);
}

// ── Async queue (ring buffer, SMS_QUEUE_SIZE slots) ─────────
// Tier 2 always queues two jobs back to back (owner + BFP), so the
// queue must hold at least 2 without dropping either one.
void gsmQueueSms(const char* number, const char* message,
                 const char* role, const char* alertEventId) {
    if (!smsMutex) return;
    if (xSemaphoreTake(smsMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        if (smsCount < SMS_QUEUE_SIZE) {
            SmsJob* job = &smsQueue[smsTail];
            strncpy(job->number,  number,  sizeof(job->number)  - 1);
            job->number[sizeof(job->number) - 1] = '\0';
            strncpy(job->message, message, sizeof(job->message) - 1);
            job->message[sizeof(job->message) - 1] = '\0';
            strncpy(job->role, role, sizeof(job->role) - 1);
            job->role[sizeof(job->role) - 1] = '\0';
            strncpy(job->alertEventId, alertEventId, sizeof(job->alertEventId) - 1);
            job->alertEventId[sizeof(job->alertEventId) - 1] = '\0';
            job->pending = true;
            smsTail = (smsTail + 1) % SMS_QUEUE_SIZE;
            smsCount++;
            GSMLOG("SMS queued for %s (depth %d/%d)", number, smsCount, SMS_QUEUE_SIZE);
        } else {
            GSMLOG("WARN: SMS queue full (%d/%d) — message to %s dropped",
                   SMS_QUEUE_SIZE, SMS_QUEUE_SIZE, number);
        }
        xSemaphoreGive(smsMutex);
    }
}

// Dequeues and sends (blocking) at most one job per call — called
// once per GSM task loop tick, so a slow SIM800L response only ever
// stalls the GSM task, never the Connectivity task's WDT reset.
void gsmProcessQueue() {
    if (!smsMutex) return;

    char num[20]          = {0};
    char msg[220]         = {0};
    char role[8]          = {0};
    char alertEventId[40] = {0};
    bool haveJob          = false;

    if (xSemaphoreTake(smsMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        if (smsCount > 0) {
            SmsJob* job = &smsQueue[smsHead];
            strncpy(num, job->number,  sizeof(num) - 1);
            strncpy(msg, job->message, sizeof(msg) - 1);
            strncpy(role, job->role,   sizeof(role) - 1);
            strncpy(alertEventId, job->alertEventId, sizeof(alertEventId) - 1);
            job->pending = false;
            smsHead = (smsHead + 1) % SMS_QUEUE_SIZE;
            smsCount--;
            haveJob = true;
        }
        xSemaphoreGive(smsMutex);
    }

    if (!haveJob) return;

    bool sent = gsmSendSms(num, msg);   // send outside mutex (blocking)

    if (xSemaphoreTake(smsMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        if (resultCount < SMS_QUEUE_SIZE) {
            SmsResult* res = &resultQueue[resultTail];
            strncpy(res->role, role, sizeof(res->role) - 1);
            res->role[sizeof(res->role) - 1] = '\0';
            strncpy(res->alertEventId, alertEventId, sizeof(res->alertEventId) - 1);
            res->alertEventId[sizeof(res->alertEventId) - 1] = '\0';
            res->success = sent;
            resultTail = (resultTail + 1) % SMS_QUEUE_SIZE;
            resultCount++;
        } else {
            GSMLOG("WARN: SMS result queue full — dropping result for role=%s", role);
        }
        xSemaphoreGive(smsMutex);
    }
}

// Pops one completed delivery result — called from the Connectivity
// task loop until it returns false, draining everything from one tick.
bool gsmPopSmsResult(char* role, size_t roleLen,
                     char* alertEventId, size_t alertEventIdLen,
                     bool* success) {
    if (!smsMutex) return false;

    bool got = false;
    if (xSemaphoreTake(smsMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        if (resultCount > 0) {
            SmsResult* res = &resultQueue[resultHead];
            strncpy(role, res->role, roleLen - 1);
            role[roleLen - 1] = '\0';
            strncpy(alertEventId, res->alertEventId, alertEventIdLen - 1);
            alertEventId[alertEventIdLen - 1] = '\0';
            *success = res->success;
            resultHead = (resultHead + 1) % SMS_QUEUE_SIZE;
            resultCount--;
            got = true;
        }
        xSemaphoreGive(smsMutex);
    }
    return got;
}

bool gsmIsRegistered() {
    char r[128];
    GSM_SERIAL.print("AT+CREG?\r\n");
    gsmReadResponse(r, sizeof(r), 2000);
    return (strstr(r, ",1") != nullptr || strstr(r, ",5") != nullptr);
}

#include "diag_log.h"

#ifdef ENABLE_DIAG_SERVER
#include <stdarg.h>

#define DIAG_LOG_BUF_LINES 80
// 360: comfortably fits a full ingest-reading/trigger-alert JSON payload
// (connectivity.cpp's CLOG("POST %s -> %s", ...)) without truncating —
// that used to cut off mid-field at 120. Costs ~28.8KB total, acceptable
// against 320KB RAM.
#define DIAG_LOG_LINE_MAX  360

static char diagLogLines[DIAG_LOG_BUF_LINES][DIAG_LOG_LINE_MAX];
static int  diagLogHead    = 0;
static bool diagLogWrapped = false;

void diagLogAdd(const char* fmt, ...) {
    static SemaphoreHandle_t mutex = xSemaphoreCreateMutex();

    char msg[DIAG_LOG_LINE_MAX - 12];
    va_list args;
    va_start(args, fmt);
    vsnprintf(msg, sizeof(msg), fmt, args);
    va_end(args);
    Serial.printf("%s\n", msg);   // still useful if USB/serial happens to be available

    // Called from every sensor/connectivity task — guards the shared ring
    // buffer against concurrent writes corrupting a line or racing the index.
    if (mutex && xSemaphoreTake(mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        snprintf(diagLogLines[diagLogHead], DIAG_LOG_LINE_MAX, "[%8lu s] %s", millis() / 1000, msg);
        diagLogHead = (diagLogHead + 1) % DIAG_LOG_BUF_LINES;
        if (diagLogHead == 0) diagLogWrapped = true;
        xSemaphoreGive(mutex);
    }
}

String diagLogDump() {
    String out;
    out.reserve(DIAG_LOG_BUF_LINES * DIAG_LOG_LINE_MAX);
    int start = diagLogWrapped ? diagLogHead : 0;
    int count = diagLogWrapped ? DIAG_LOG_BUF_LINES : diagLogHead;
    for (int i = 0; i < count; i++) {
        out += diagLogLines[(start + i) % DIAG_LOG_BUF_LINES];
        out += "\n";
    }
    if (count == 0) out = "(no log lines yet)\n";
    return out;
}

#else
void diagLogAdd(const char*, ...) {}
#endif

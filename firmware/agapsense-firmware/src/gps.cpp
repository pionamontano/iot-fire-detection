// ============================================================
// gps.cpp — NEO-6M GPS Implementation  (v2.0 — unchanged from v1.0)
// ============================================================

#include "gps.h"

#if DEBUG_MODE
  #define GLOG(fmt, ...) Serial.printf("[GPS] " fmt "\n", ##__VA_ARGS__)
#else
  #define GLOG(fmt, ...)
#endif

static TinyGPSPlus gps;
static GpsFix lastFix = {0.0, 0.0, 0.0f, 0, 99.9f, false, 0};

void gpsInit() {
    GPS_SERIAL.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
    GLOG("NEO-6M started at %d baud (RX=%d TX=%d)", GPS_BAUD, GPS_RX_PIN, GPS_TX_PIN);
}

void gpsUpdate(GpsFix* fix, SemaphoreHandle_t mutex) {
    while (GPS_SERIAL.available()) gps.encode(GPS_SERIAL.read());

    if (gps.location.isUpdated() && gps.location.isValid()) {
        GpsFix nf;
        nf.lat          = gps.location.lat();
        nf.lng          = gps.location.lng();
        nf.altitude_m   = gps.altitude.isValid()  ? (float)gps.altitude.meters() : 0.0f;
        nf.satellites   = gps.satellites.isValid() ? (uint8_t)gps.satellites.value() : 0;
        nf.hdop         = gps.hdop.isValid()       ? (float)gps.hdop.hdop() : 99.9f;
        nf.valid        = true;
        nf.timestamp_ms = millis();
        lastFix = nf;

        GLOG("Fix lat=%.6f lng=%.6f sats=%d HDOP=%.1f", nf.lat, nf.lng, nf.satellites, nf.hdop);

        if (xSemaphoreTake(mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
            *fix = nf;
            xSemaphoreGive(mutex);
        }
    } else {
        // Publish stale fix with valid=false so backend knows coords are cached
        if (xSemaphoreTake(mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
            fix->lat          = lastFix.lat;
            fix->lng          = lastFix.lng;
            fix->altitude_m   = lastFix.altitude_m;
            fix->satellites   = 0;
            fix->hdop         = 99.9f;
            fix->valid        = false;
            fix->timestamp_ms = lastFix.timestamp_ms;
            xSemaphoreGive(mutex);
        }
    }
}

bool   gpsHasFix()     { return lastFix.valid; }
GpsFix gpsGetLastFix() { return lastFix; }

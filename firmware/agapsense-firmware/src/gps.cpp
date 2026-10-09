// ============================================================
// gps.cpp — NEO-6M / NEO-7M GPS Implementation
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
    GLOG("GPS started at %d baud (RX=%d TX=%d)", GPS_BAUD, GPS_RX_PIN, GPS_TX_PIN);
}

void gpsUpdate(GpsFix* fix, SemaphoreHandle_t mutex) {
    while (GPS_SERIAL.available()) {
        gps.encode(GPS_SERIAL.read());
    }

    // A lock is valid if TinyGPS has a location AND the data is less than 5 seconds old.
    // This removes the reliance on `isUpdated()` which flips to false between sentences.
    bool hasLiveLock = gps.location.isValid() && (gps.location.age() < 5000);

    GpsFix nf;
    nf.lat          = gps.location.lat();
    nf.lng          = gps.location.lng();
    nf.altitude_m   = gps.altitude.isValid()   ? (float)gps.altitude.meters() : 0.0f;
    nf.satellites   = gps.satellites.isValid() ? (uint8_t)gps.satellites.value() : 0;
    nf.hdop         = gps.hdop.isValid()       ? (float)gps.hdop.hdop() : 99.9f;
    nf.valid        = hasLiveLock;
    nf.timestamp_ms = millis();

    // Only update lastFix if it is genuinely valid
    if (hasLiveLock) {
        lastFix = nf;
    } else {
        // If no live lock, publish the stale fix with valid=false
        nf.lat = lastFix.lat;
        nf.lng = lastFix.lng;
        nf.altitude_m = lastFix.altitude_m;
        nf.satellites = lastFix.satellites;
        nf.hdop = lastFix.hdop;
        nf.valid = false;
        nf.timestamp_ms = lastFix.timestamp_ms;
    }

    if (xSemaphoreTake(mutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        *fix = nf;
        xSemaphoreGive(mutex);
    }
}

bool   gpsHasFix()     { return lastFix.valid; }
GpsFix gpsGetLastFix() { return lastFix; }

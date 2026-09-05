#pragma once
// ============================================================
// gps.h — NEO-6M GPS Module  (v2.0 — unchanged from v1.0)
// ============================================================

#include <Arduino.h>
#include <TinyGPS++.h>
#include "config.h"

struct GpsFix {
    double   lat;
    double   lng;
    float    altitude_m;
    uint8_t  satellites;
    float    hdop;
    bool     valid;          // false when using cached coordinates
    uint32_t timestamp_ms;
};

void    gpsInit();
void    gpsUpdate(GpsFix* fix, SemaphoreHandle_t mutex);
bool    gpsHasFix();
GpsFix  gpsGetLastFix();

#pragma once
#include <Arduino.h>
struct WiFiClientSecure {
    void setCACert(const char*) {}
    void setTimeout(int) {}
    bool connect(const char*, int) { return g_hal.probeReachable; }
    void stop() {}
};

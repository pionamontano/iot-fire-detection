#pragma once
#include <Arduino.h>
// Minimal stream surface used by the OTA download loop (never reached in the simulation).
struct WiFiClient {
    size_t available() { return 0; }
    size_t readBytes(uint8_t*, size_t) { return 0; }
};
struct WiFiClientSecure : WiFiClient {
    void setCACert(const char*) {}
    void setTimeout(int) {}
    bool connect(const char*, int) { return g_hal.probeReachable; }
    void stop() {}
};

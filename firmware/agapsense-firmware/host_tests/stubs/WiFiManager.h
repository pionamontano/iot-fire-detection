#pragma once
#include <Arduino.h>
struct WiFiManager {
    void setConnectTimeout(int) {}
    void setConfigPortalTimeout(int) {}
    bool autoConnect(const char*, const char*) { return g_hal.wifiUp; }
};

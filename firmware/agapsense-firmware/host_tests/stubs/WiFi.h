#pragma once
#include <Arduino.h>
#define WL_CONNECTED 3
#define WL_DISCONNECTED 6
struct FakeIP { String toString() const { return String("192.0.2.10"); } };
struct FakeWiFi {
    int status() { return g_hal.wifiUp ? WL_CONNECTED : WL_DISCONNECTED; }
    int RSSI() { return -60; }
    FakeIP localIP() { return FakeIP(); }
    void disconnect() {}
    void begin() {}
};
extern FakeWiFi WiFi;

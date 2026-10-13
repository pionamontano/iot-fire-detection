#pragma once
#include <Arduino.h>
#include <functional>
struct WiFiManagerParameter {
    WiFiManagerParameter(const char*, const char*, const char* v, int) : val(v ? v : "") {}
    const char* getValue() const { return val.c_str(); }
    std::string val;
};
struct WiFiManager {
    void setConnectTimeout(int) {}
    void setConfigPortalTimeout(int) {}
    void setConfigPortalBlocking(bool) {}
    bool addParameter(WiFiManagerParameter*) { return true; }
    void setSaveParamsCallback(std::function<void()>) {}
    void setSaveConfigCallback(std::function<void()>) {}
    bool autoConnect(const char*, const char*) { return g_hal.wifiUp; }
    bool startConfigPortal(const char*, const char*) { return false; }
    bool process() { return false; }
};

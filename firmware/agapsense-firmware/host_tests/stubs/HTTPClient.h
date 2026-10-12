#pragma once
#include <Arduino.h>
#include "WiFiClientSecure.h"
// Scripted HTTP client: forwards to g_hal.server, advancing the fake clock by the scripted latency.
struct HTTPClient {
    std::string url, resp;
    bool begin(WiFiClientSecure&, const String& u) { url = u.s; return true; }
    void addHeader(const char*, const String&) {}
    void setTimeout(int) {}
    int run(const char* method, const char* payload) {
        std::string body; uint32_t lat = 50;
        int code = g_hal.server ? g_hal.server(url, payload ? payload : "", body, lat) : -1;
        g_hal.now += lat;
        g_hal.calls.push_back({g_hal.now, method, url, payload ? payload : "", code});
        resp = body; return code;
    }
    int POST(const char* p) { return run("POST", p); }
    int GET() { return run("GET", nullptr); }
    String getString() { return String(resp); }
    String errorToString(int) { return String("err"); }
    void end() {}
};

#pragma once
// Fake hardware/network layer for host simulation of the REAL connectivity.cpp and gsm.cpp.
// Everything here is a test double: the clock, Wi-Fi, HTTPS server and SIM800L are scripted.
#include <stdint.h>
#include <string>
#include <vector>
#include <functional>

struct HttpCall { uint32_t atMs; std::string method, url, payload; int code; };

struct SimHal {
    uint32_t now = 100000;                 // fake millis()
    bool     wifiUp = true;
    bool     probeReachable = true;
    bool     modemSendsOk = true;          // SIM800L accepts SMS
    int      wdtResets = 0;
    std::vector<uint32_t> wdtAt;
    std::vector<HttpCall> calls;
    // Scripted server: returns HTTP code (<=0 = transport failure), fills body. latencyMs is consumed on the clock.
    std::function<int(const std::string& url, const std::string& payload, std::string& body, uint32_t& latencyMs)> server;
    std::vector<std::string> smsSent;      // numbers texted
    std::vector<std::string> smsBodies;
    std::vector<std::pair<int,int>> pinWrites;
    void reset() { *this = SimHal(); }
};
extern SimHal g_hal;

#pragma once
// Host stub for the ESP32 Update library. The simulation never reaches OTA
// (fetchRemoteConfig is scripted without firmware_url), so these only need to compile.
#include <cstddef>
#include <cstdint>
struct UpdateClass {
    bool begin(size_t) { return false; }
    bool setMD5(const char*) { return false; }
    size_t write(uint8_t*, size_t) { return 0; }
    bool end() { return false; }
    void abort() {}
    const char* errorString() { return ""; }
};
static UpdateClass Update;

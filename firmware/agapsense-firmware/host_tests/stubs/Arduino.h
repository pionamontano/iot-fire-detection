#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <string>
#include <deque>
#include "sim_hal.h"
#define PROGMEM
#define HIGH 1
#define LOW 0
#define OUTPUT 1
#define SERIAL_8N1 0
typedef void* SemaphoreHandle_t;
#define pdTRUE 1
#define pdMS_TO_TICKS(x) (x)
inline SemaphoreHandle_t xSemaphoreCreateMutex() { static int x; return &x; }
inline int xSemaphoreTake(SemaphoreHandle_t, uint32_t) { return pdTRUE; }
inline void xSemaphoreGive(SemaphoreHandle_t) {}
inline uint32_t millis() { return g_hal.now; }
inline void delay(uint32_t ms) { g_hal.now += ms; }
inline void pinMode(int, int) {}
inline void digitalWrite(int pin, int v) { g_hal.pinWrites.push_back({pin, v}); }
inline int analogRead(int) { return 2048; }

class String {
public:
    std::string s;
    String() {}
    String(const char* c) : s(c ? c : "") {}
    String(const std::string& c) : s(c) {}
    String operator+(const String& o) const { return String(s + o.s); }
    String operator+(const char* o) const { return String(s + o); }
    void replace(const char* a, const char* b) {
        size_t p; std::string A(a);
        while ((p = s.find(A)) != std::string::npos) s.replace(p, A.size(), b);
    }
    const char* c_str() const { return s.c_str(); }
};
inline String operator+(const char* a, const String& b) { return String(std::string(a) + b.s); }

// SIM800L as a scripted UART
class FakeUart {
    std::deque<char> rx;
    std::string tx;
public:
    void begin(long, int, int, int) {}
    int available() { return (int)rx.size(); }
    int read() { if (rx.empty()) return -1; char c = rx.front(); rx.pop_front(); return (unsigned char)c; }
    void print(const char* t) { std::string x(t); tx += x; if (x.find("AT+CMGS=\"") == 0) { cur = x.substr(9, x.find('"', 9) - 9); rx.push_back('>'); } else if (x != "\r\n") { /* body */ body = x; } }
    void write(int b) {
        if (b == 0x1A) {
            if (g_hal.modemSendsOk) { g_hal.smsSent.push_back(cur); g_hal.smsBodies.push_back(body); for (char c : std::string("\r\n+CMGS: 1\r\n\r\nOK\r\n")) rx.push_back(c); }
            else for (char c : std::string("\r\n+CMS ERROR: 500\r\n\r\nERROR\r\n")) rx.push_back(c);
        }
    }
    std::string cur, body;
};
extern FakeUart Serial1;
extern FakeUart Serial2;
struct FakeSerial { template<class... A> void printf(const char*, A...) {} };
extern FakeSerial Serial;

// OTA path only (compiles; never executed by the simulation)
#include <algorithm>
using std::min;
inline void vTaskDelay(int) {}
struct EspClass { void restart() {} };
static EspClass ESP;

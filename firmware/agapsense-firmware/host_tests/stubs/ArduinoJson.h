#pragma once
// Minimal stand-in for the ArduinoJson subset connectivity.cpp uses (flat string/number objects only).
#include <Arduino.h>
#include <stdlib.h>
struct DeserializationError { bool bad; explicit operator bool() const { return bad; } const char* c_str() const { return "InvalidInput"; } };
class JsonVariantStub {
public:
    const std::string* sv = nullptr;
    const char* operator|(const char* d) const { return sv ? sv->c_str() : d; }
    float operator|(float d) const { return sv ? (float)atof(sv->c_str()) : d; }
};
struct JsonDocument {
    std::vector<std::pair<std::string,std::string>> kv;
    JsonVariantStub operator[](const char* k) const { JsonVariantStub v; for (auto& p : kv) if (p.first == k) v.sv = &p.second; return v; }
};
inline DeserializationError deserializeJson(JsonDocument& d, const String& in) {
    const std::string& s = in.s; size_t i = s.find('{'); if (i == std::string::npos) return {true};
    d.kv.clear(); ++i;
    while (i < s.size()) {
        size_t a = s.find('"', i); if (a == std::string::npos) break;
        size_t b = s.find('"', a + 1); if (b == std::string::npos) return {true};
        std::string key = s.substr(a + 1, b - a - 1);
        size_t c = s.find(':', b); if (c == std::string::npos) return {true};
        size_t v = c + 1; while (v < s.size() && s[v] == ' ') ++v;
        std::string val;
        if (s[v] == '"') { size_t e = s.find('"', v + 1); if (e == std::string::npos) return {true}; val = s.substr(v + 1, e - v - 1); i = e + 1; }
        else { size_t e = s.find_first_of(",}", v); val = s.substr(v, e - v); if (val == "null") { i = e; continue; } i = e; }
        d.kv.push_back({key, val});
    }
    return {false};
}

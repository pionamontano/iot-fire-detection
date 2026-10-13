#pragma once
// ============================================================
// identity.h — per-device identity (device ID + API key)  (v1.0)
//
// The device ID and API key used to be compile-time constants in config.h,
// which tied every firmware image (and therefore every OTA image) to one
// physical node. They now live in NVS (flash) on each node and are entered
// once through the Wi-Fi setup portal, so a single build runs on every node.
//
// Written only during boot provisioning (connectivityInit(), before the
// connectivity task's main loop and before any SMS/HTTP use); read-only after
// that, so no locking is needed.
//
// The validators are header-only and pure so the host tests can cover them.
// ============================================================

#include <stddef.h>

namespace agap {

constexpr size_t kDeviceIdMax = 39;   // e.g. "AGS-001"; ends up in JSON, a URL query and SMS text
constexpr size_t kApiKeyMax   = 64;   // backend generates "sk_" + 48 hex chars (51)

inline bool isIdentityChar(char c, bool allowDot) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
           c == '-' || c == '_' || (allowDot && c == '.');
}

// 1..kDeviceIdMax chars of [A-Za-z0-9._-]. The restricted set keeps the value safe to splice into
// the JSON payloads, the config URL query and the SMS body without escaping.
inline bool validDeviceId(const char* s) {
    if (!s || !s[0]) return false;
    size_t n = 0;
    for (; s[n]; n++) {
        if (n >= kDeviceIdMax || !isIdentityChar(s[n], true)) return false;
    }
    return true;
}

// 8..kApiKeyMax chars of [A-Za-z0-9_-].
inline bool validApiKey(const char* s) {
    if (!s) return false;
    size_t n = 0;
    for (; s[n]; n++) {
        if (n >= kApiKeyMax || !isIdentityChar(s[n], false)) return false;
    }
    return n >= 8;
}

}  // namespace agap

// ── Runtime API (identity.cpp; host tests supply a stub) ───

/** Load identity from NVS. Call once at boot; leaves it unconfigured if missing or invalid. */
void identityLoad();

/** True when a valid device ID and API key are loaded. */
bool identityConfigured();

/** Current device ID / API key; empty strings when not configured. */
const char* deviceId();
const char* deviceApiKey();

/** Validate and persist both values to NVS and update the in-RAM copy.
 *  Returns false (and changes nothing) if either value is invalid or the write fails. */
bool identitySave(const char* id, const char* apiKey);

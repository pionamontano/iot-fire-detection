// ============================================================
// identity.cpp — NVS-backed device identity  (v1.0)
// ============================================================

#include "identity.h"
#include <Arduino.h>
#include "config.h"

#include <Preferences.h>
#include <string.h>

#if DEBUG_MODE
  #define ILOG(fmt, ...) Serial.printf("[IDENT] " fmt "\n", ##__VA_ARGS__)
#else
  #define ILOG(fmt, ...)
#endif

static const char* kKeyId  = "dev_id";
static const char* kKeyKey = "dev_key";

static char s_id[agap::kDeviceIdMax + 1];
static char s_key[agap::kApiKeyMax + 1];
static bool s_configured = false;

void identityLoad() {
    s_id[0] = '\0';
    s_key[0] = '\0';
    s_configured = false;

    Preferences prefs;
    // Read-only open fails if the namespace has never been written (first boot) — that just means
    // "not provisioned yet".
    if (!prefs.begin(IDENTITY_NVS_NAMESPACE, true)) {
        ILOG("no stored identity");
        return;
    }
    char id[agap::kDeviceIdMax + 1]  = {0};
    char key[agap::kApiKeyMax + 1]   = {0};
    prefs.getString(kKeyId,  id,  sizeof(id));
    prefs.getString(kKeyKey, key, sizeof(key));
    prefs.end();

    if (agap::validDeviceId(id) && agap::validApiKey(key)) {
        strncpy(s_id,  id,  sizeof(s_id)  - 1);
        strncpy(s_key, key, sizeof(s_key) - 1);
        s_configured = true;
        ILOG("identity loaded: %s", s_id);
    } else {
        ILOG("stored identity missing or invalid");
    }
}

bool identityConfigured() { return s_configured; }
const char* deviceId()     { return s_id; }
const char* deviceApiKey() { return s_key; }

bool identitySave(const char* id, const char* apiKey) {
    if (!agap::validDeviceId(id) || !agap::validApiKey(apiKey)) {
        ILOG("identitySave: invalid value rejected");
        return false;
    }
    Preferences prefs;
    if (!prefs.begin(IDENTITY_NVS_NAMESPACE, false)) return false;
    bool ok = prefs.putString(kKeyId, id) > 0 && prefs.putString(kKeyKey, apiKey) > 0;
    prefs.end();
    if (!ok) {
        ILOG("identitySave: NVS write failed");
        return false;
    }
    strncpy(s_id,  id,     sizeof(s_id)  - 1); s_id[sizeof(s_id) - 1]   = '\0';
    strncpy(s_key, apiKey, sizeof(s_key) - 1); s_key[sizeof(s_key) - 1] = '\0';
    s_configured = true;
    ILOG("identity saved: %s", s_id);
    return true;
}

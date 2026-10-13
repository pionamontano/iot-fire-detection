// Host stub for src/identity.cpp (NVS-backed on the board): the simulation runs as a provisioned node.
#include "identity.h"
void identityLoad() {}
bool identityConfigured() { return true; }
const char* deviceId() { return "sim-device-001"; }
const char* deviceApiKey() { return "sk_simulated_key_0123456789"; }
bool identitySave(const char*, const char*) { return true; }

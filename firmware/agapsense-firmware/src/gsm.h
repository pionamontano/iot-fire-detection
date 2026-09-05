#pragma once
// ============================================================
// gsm.h — SIM800L AT Command Handler / SMS Fallback  (v2.0)
//
// Changes from v1.0:
//   + gsmSendOwnerSms() — plain-language evacuation message
//   + gsmSendBfpSms()   — technical message with device ID + coords
//   ~ gsmSendAlertSms() removed (replaced by role-specific functions)
// ============================================================

#include <Arduino.h>
#include "config.h"

struct SmsJob {
    char number[20];
    char message[160];
    bool pending;
};

/** Initialise SIM800L UART and run AT handshake + network registration. */
void gsmInit();

/**
 * Send an AT command and wait for an expected response token.
 * @return true if expected token found within timeout.
 */
bool gsmSendAT(const char* cmd, const char* expected, uint32_t timeoutMs = 3000);

/**
 * Send a plain-text SMS (blocks until sent or fails).
 * @return true on success (+CMGS confirmation received).
 */
bool gsmSendSms(const char* to, const char* message);

/**
 * Role-specific Tier 2 SMS — property owner.
 * Plain-language evacuation message + Google Maps link.
 */
void gsmSendOwnerSms(float co_ppm, float temp_c,
                     double lat, double lng,
                     const char* ownerNumber);

/**
 * Role-specific Tier 2 SMS — BFP responder.
 * Technical message: device ID, CO, temp, GPS coords, Maps link.
 */
void gsmSendBfpSms(float co_ppm, float temp_c,
                   double lat, double lng,
                   const char* bfpNumber);

/** Queue an SMS job for async processing by the GSM task. */
void gsmQueueSms(const char* number, const char* message);

/** Process the SMS queue — call from GSM FreeRTOS task loop. */
void gsmProcessQueue();

/** @return true if SIM800L is registered on network (home or roaming). */
bool gsmIsRegistered();

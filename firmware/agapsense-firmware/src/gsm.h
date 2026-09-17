#pragma once
// ============================================================
// gsm.h — SIM800L AT Command Handler / SMS Fallback  (v2.1)
//
// Changes from v2.0:
//   ~ gsmSendOwnerSms()/gsmSendBfpSms() now enqueue via gsmQueueSms()
//     instead of calling gsmSendSms() directly — they no longer block
//     the caller (the Connectivity task), so its WDT reset can't be
//     starved by a slow SIM800L response.
//   ~ SmsJob queue is now a ring buffer of SMS_QUEUE_SIZE (config.h,
//     currently 2) slots instead of a single job — Tier 2 always
//     queues owner + BFP together and both must fit without dropping.
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
    char role[8];      // "owner" or "bfp" — carried through to the result queue
    bool pending;
};

struct SmsResult {
    char role[8];
    bool success;
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
 * Composes the message and enqueues it via gsmQueueSms() — does not
 * block the caller.
 */
void gsmSendOwnerSms(float co_ppm, float temp_c,
                     double lat, double lng,
                     const char* ownerNumber);

/**
 * Role-specific Tier 2 SMS — BFP responder.
 * Technical message: device ID, CO, temp, GPS coords, Maps link.
 * Composes the message and enqueues it via gsmQueueSms() — does not
 * block the caller.
 */
void gsmSendBfpSms(float co_ppm, float temp_c,
                   double lat, double lng,
                   const char* bfpNumber);

/** Queue an SMS job for async processing by the GSM task. Holds up to
 *  SMS_QUEUE_SIZE jobs (config.h); logs and drops the message if full.
 *  @param role short tag ("owner"/"bfp") carried through to the result
 *  queue so the caller can report delivery status per recipient. */
void gsmQueueSms(const char* number, const char* message, const char* role);

/** Dequeue and blocking-send the oldest queued SMS, if any — call
 *  once per GSM FreeRTOS task loop iteration. Pushes the outcome onto
 *  the result queue for gsmPopSmsResult(). */
void gsmProcessQueue();

/**
 * Pop one completed SMS delivery result (role + success) into the
 * caller's buffers. Holds up to SMS_QUEUE_SIZE results; call in a loop
 * until it returns false to drain everything from one tick.
 * @return true if a result was available and popped.
 */
bool gsmPopSmsResult(char* role, size_t roleLen, bool* success);

/** @return true if SIM800L is registered on network (home or roaming). */
bool gsmIsRegistered();

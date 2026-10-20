#pragma once
// ============================================================
// alert_retry.h — retry/backoff policy for POSTing a fire alert to trigger-alert.
//
// PURE LOGIC: no Arduino, FreeRTOS or Wi-Fi dependencies and no clock of its own. The caller passes
// millis() in, so the same code runs on the ESP32 and in the host-side tests (host_tests/).
// C++11-compatible (arduino-esp32 toolchains differ).
//
// Wired into connectivity.cpp in Step 5.3 (attemptAlertPost()).
//
// What it decides (and what it deliberately does not):
//   * WHEN to (re)send the alert POST and WHICH tier to send: the highest tier entered since the
//     last reset that the server has not yet acknowledged with a 2xx.
//   * Backoff after a transient failure (connect error/timeout/5xx/408/429): 5,10,20,40,60,60... s.
//   * Gives up after a few permanent rejections (other 4xx) - retrying cannot fix those.
//   * It does NOT queue or send SMS. connectivity.cpp sends the Tier 2 SMS only when the POST made on entering
//     Tier 2 was not acknowledged (ackedTier() < 2), and then at once; later retries never send SMS.
//   * It does NOT guarantee exactly-once delivery. A retry after a lost response can reach the server
//     again; the SERVER makes that safe (one open incident per device, claim-before-send ledger), and
//     recipients may in rare cases receive a duplicate (at-least-once). See
//     docs/ALERT_DELIVERY_AND_INCIDENT_INVARIANTS.md.
//
// Time is uint32_t milliseconds (millis()). All comparisons are wrap-safe (49.7-day rollover).
// ============================================================

#include <stdint.h>

namespace agap {

enum class PostOutcome : uint8_t {
    Success,     // 2xx: the server has recorded the alert for this tier
    Transient,   // worth retrying: no response, timeout, 5xx, 408, 429
    Permanent    // retrying will not help (other 4xx / 3xx)
};

// HTTPClient reports transport failures as negative codes (e.g. -1 connection refused, -11 read timeout).
inline PostOutcome classifyAlertHttp(int code) {
    if (code >= 200 && code < 300) return PostOutcome::Success;
    if (code <= 0) return PostOutcome::Transient;
    if (code == 408 || code == 429 || code >= 500) return PostOutcome::Transient;
    return PostOutcome::Permanent;
}

struct AlertRetryConfig {
    uint32_t backoffInitialMs;      // first retry delay
    uint32_t backoffMaxMs;          // cap
    uint8_t  maxPermanentAttempts;  // give up on a tier after this many permanent rejections
};

inline AlertRetryConfig defaultAlertRetryConfig() {
    AlertRetryConfig c;
    c.backoffInitialMs = 5000;
    c.backoffMaxMs = 60000;
    c.maxPermanentAttempts = 3;
    return c;
}

class AlertRetryScheduler {
public:
    explicit AlertRetryScheduler(const AlertRetryConfig& cfg = defaultAlertRetryConfig())
        : cfg_(cfg) { reset(); }

    // Boot, and whenever the alert state machine returns to CLEAR: forget everything. The next alarm is a
    // new incident and starts with an immediate attempt and a fresh backoff.
    void reset() {
        wantedTier_ = 0; ackedTier_ = 0; inFlightTier_ = 0;
        nextAttemptMs_ = 0; transientFails_ = 0; permanentFails_ = 0;
        gaveUp_ = false; attemptsTotal_ = 0;
    }

    // The state machine entered (or escalated to) `tier` (1 or 2). Only a HIGHER tier than any seen since
    // the last reset changes anything; re-entering a tier already wanted is a no-op.
    void onTierEntered(uint8_t tier, uint32_t nowMs) {
        if (tier == 0 || tier > 2 || tier <= wantedTier_) return;
        wantedTier_ = tier;
        transientFails_ = 0; permanentFails_ = 0; gaveUp_ = false;
        nextAttemptMs_ = nowMs;  // attempt immediately
    }

    // The state machine re-entered `tier` (e.g. TIER2 -> TIER1 -> TIER2 within one incident). Unlike
    // onTierEntered() this forces a fresh send even if that tier was already acknowledged, preserving the
    // firmware's pre-5.3 behaviour of re-POSTing on every escalation (the server treats it as an update of
    // the same open incident; the notification ledger prevents duplicate sends for the same tier).
    void reassert(uint8_t tier, uint32_t nowMs) {
        if (tier == 0 || tier > 2) return;
        if (tier > wantedTier_) { onTierEntered(tier, nowMs); return; }
        if (tier < wantedTier_) return;   // never lowers what is wanted
        if (ackedTier_ >= tier) ackedTier_ = static_cast<uint8_t>(tier - 1);
        transientFails_ = 0; permanentFails_ = 0; gaveUp_ = false;
        nextAttemptMs_ = nowMs;
    }

    // True when the caller should POST now. Poll as often as you like; it never causes an attempt by itself.
    bool shouldAttempt(uint32_t nowMs) const {
        return inFlightTier_ == 0 && wantedTier_ > ackedTier_ && !gaveUp_ && due(nowMs);
    }

    // Call right before POSTing. Returns the tier to put in the request (always the highest wanted tier).
    uint8_t beginAttempt(uint32_t /*nowMs*/) {
        inFlightTier_ = wantedTier_;
        ++attemptsTotal_;
        return inFlightTier_;
    }

    // Report the HTTP result of the attempt started by beginAttempt(). Ignored if none is in flight.
    void onResult(PostOutcome outcome, uint32_t nowMs) {
        if (inFlightTier_ == 0) return;
        const uint8_t tier = inFlightTier_;
        inFlightTier_ = 0;
        switch (outcome) {
            case PostOutcome::Success:
                if (tier > ackedTier_) ackedTier_ = tier;
                transientFails_ = 0; permanentFails_ = 0;
                if (wantedTier_ > ackedTier_) nextAttemptMs_ = nowMs;  // escalated meanwhile: send that tier now
                break;
            case PostOutcome::Transient:
                ++transientFails_;
                nextAttemptMs_ = nowMs + backoffMs(transientFails_);
                break;
            case PostOutcome::Permanent:
                ++permanentFails_;
                if (permanentFails_ >= cfg_.maxPermanentAttempts) gaveUp_ = true;
                else nextAttemptMs_ = nowMs + backoffMs(permanentFails_);
                break;
        }
    }

    bool     pending()       const { return wantedTier_ > ackedTier_ && !gaveUp_; }
    bool     gaveUp()        const { return gaveUp_; }
    bool     inFlight()      const { return inFlightTier_ != 0; }
    uint8_t  wantedTier()    const { return wantedTier_; }
    uint8_t  ackedTier()     const { return ackedTier_; }
    uint32_t attemptsTotal() const { return attemptsTotal_; }
    uint32_t nextAttemptMs() const { return nextAttemptMs_; }

private:
    bool due(uint32_t nowMs) const { return static_cast<int32_t>(nowMs - nextAttemptMs_) >= 0; }

    // delay after the n-th consecutive failure (n >= 1): initial, 2x, 4x ... capped
    uint32_t backoffMs(uint32_t failures) const {
        uint32_t b = cfg_.backoffInitialMs;
        for (uint32_t i = 1; i < failures; ++i) {
            if (b >= cfg_.backoffMaxMs / 2) { b = cfg_.backoffMaxMs; break; }
            b *= 2;
        }
        return b > cfg_.backoffMaxMs ? cfg_.backoffMaxMs : b;
    }

    AlertRetryConfig cfg_;
    uint8_t  wantedTier_, ackedTier_, inFlightTier_;
    uint32_t nextAttemptMs_;
    uint32_t transientFails_, permanentFails_;
    bool     gaveUp_;
    uint32_t attemptsTotal_;
};

}  // namespace agap

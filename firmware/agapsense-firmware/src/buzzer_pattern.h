#pragma once
// ============================================================
// buzzer_pattern.h — what the buzzer should be doing at a given moment.
//
// PURE LOGIC: no Arduino or FreeRTOS. The caller passes the time since the current mode started, so the
// same code runs on the ESP32 (buzzer.cpp) and in the host-side tests (host_tests/). C++11-compatible.
//
//   OFF        - silent (CLEAR, sensor warm-up)
//   CHIRP      - Tier 1 warning: 3 short beeps (150 ms on / 150 ms off) right away, then the same
//                3 beeps every BUZZER_CHIRP_PERIOD_MS for as long as the warning lasts. Deliberately
//                unlike the fire tone, so a single-sensor warning never sounds like a fire.
//   CONTINUOUS - Tier 2 fire alert: steady tone (unchanged behaviour).
//
// There is no silence button on the hardware: Tier 1 stops when the readings return to normal (or the
// device escalates to Tier 2); resolving the warning in the app does not reach the device.
// ============================================================
#include <stdint.h>

namespace agap {

enum class BuzzerMode : uint8_t { OFF = 0, CHIRP = 1, CONTINUOUS = 2 };

static const uint32_t BUZZER_BEEP_MS         = 150;     // each beep, and each gap between beeps
static const uint8_t  BUZZER_CHIRP_BEEPS     = 3;
static const uint32_t BUZZER_CHIRP_PERIOD_MS = 45000;   // one burst every 45 s (within the 30-60 s target)

/** true when the buzzer should be sounding `elapsed_ms` after `mode` was entered. */
inline bool buzzerOnAt(BuzzerMode mode, uint32_t elapsed_ms) {
    switch (mode) {
        case BuzzerMode::CONTINUOUS:
            return true;
        case BuzzerMode::CHIRP: {
            const uint32_t t = elapsed_ms % BUZZER_CHIRP_PERIOD_MS;
            if (t >= 2u * BUZZER_BEEP_MS * BUZZER_CHIRP_BEEPS) return false;
            return (t / BUZZER_BEEP_MS) % 2u == 0;   // even slots are beeps, odd slots are gaps
        }
        default:
            return false;
    }
}

}  // namespace agap

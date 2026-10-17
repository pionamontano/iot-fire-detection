// buzzer.cpp — see buzzer.h / buzzer_pattern.h.
#include <Arduino.h>
#include "config.h"
#include "buzzer.h"

using agap::BuzzerMode;

// Written by the connectivity task, read by the buzzer task. A single byte, so no lock is needed.
static volatile uint8_t s_requested = static_cast<uint8_t>(BuzzerMode::OFF);

void buzzerSetMode(BuzzerMode mode) {
    s_requested = static_cast<uint8_t>(mode);
}

BuzzerMode buzzerMode() {
    return static_cast<BuzzerMode>(s_requested);
}

void buzzerTick(uint32_t now_ms) {
    // Only the buzzer task touches these, so the pattern restarts exactly when the mode changes.
    static BuzzerMode current   = BuzzerMode::OFF;
    static uint32_t   startedAt = 0;
    static int        pinLevel  = -1;

    const BuzzerMode requested = static_cast<BuzzerMode>(s_requested);
    if (requested != current) {
        current   = requested;
        startedAt = now_ms;
    }

    const int level = agap::buzzerOnAt(current, now_ms - startedAt) ? HIGH : LOW;
    if (level != pinLevel) {
        digitalWrite(BUZZER_PIN, level);
        pinLevel = level;
    }
}

#pragma once
// ============================================================
// buzzer.h — non-blocking buzzer driver.
//
// The alert FSM (connectivity.cpp) runs every 2 s and can block for seconds on HTTPS, so it cannot time
// 150 ms beeps itself. It only sets the MODE here; a small dedicated task (taskBuzzer in main.cpp) calls
// buzzerTick() every BUZZER_TICK_MS and drives the pin. Pattern logic lives in buzzer_pattern.h.
// ============================================================
#include "buzzer_pattern.h"

#define BUZZER_TICK_MS 10

// Defaults so an existing config.h copied from an older config.example.h still builds.
#ifndef STACK_BUZZER
#define STACK_BUZZER 2048
#endif
#ifndef PRIO_BUZZER
#define PRIO_BUZZER 2
#endif

/** Safe to call from any task, as often as wanted: setting the current mode again does not restart the pattern. */
void buzzerSetMode(agap::BuzzerMode mode);

/** The mode last requested by the alert FSM. */
agap::BuzzerMode buzzerMode();

/** Drives BUZZER_PIN for the current mode. Call every BUZZER_TICK_MS from one task only. */
void buzzerTick(uint32_t now_ms);

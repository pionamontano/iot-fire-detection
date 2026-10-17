// Host-side tests for src/buzzer_pattern.h (pure pattern) and src/buzzer.cpp (pin driver), stubbed Arduino.
// Build/run: ./run.sh
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include "Arduino.h"
#include "config.h"
#include "../src/buzzer.h"

SimHal g_hal;
using namespace agap;

static int g_checks = 0, g_fails = 0;
static void report_failure(int line, const char* expr, const char* fmt, ...) {
    ++g_fails;
    printf("  FAIL line %d: %s", line, expr);
    if (fmt && *fmt) { printf("  -- "); va_list ap; va_start(ap, fmt); vprintf(fmt, ap); va_end(ap); }
    printf("\n");
}
#define CHECK(cond, ...) do { ++g_checks; if (!(cond)) report_failure(__LINE__, #cond, "" __VA_ARGS__); } while (0)

// Rising edges (beep starts) of `mode` in [0, until_ms), sampled every ms.
static int beepsIn(BuzzerMode mode, uint32_t from_ms, uint32_t until_ms) {
    int n = 0; bool prev = from_ms > 0 && buzzerOnAt(mode, from_ms - 1);
    for (uint32_t t = from_ms; t < until_ms; ++t) { bool on = buzzerOnAt(mode, t); if (on && !prev) ++n; prev = on; }
    return n;
}

static void test_pattern() {
    printf("pattern\n");
    for (uint32_t t : {0u, 1u, 999u, 45000u, 3600000u}) {
        CHECK(!buzzerOnAt(BuzzerMode::OFF, t));
        CHECK(buzzerOnAt(BuzzerMode::CONTINUOUS, t), "Tier 2 tone is continuous (t=%u)", t);
    }
    // 3 beeps of 150 ms with 150 ms gaps, starting immediately.
    const uint32_t on[]  = {0, 149, 300, 449, 600, 749};
    const uint32_t off[] = {150, 299, 450, 599, 750, 1000, 30000, 44999};
    for (uint32_t t : on)  CHECK(buzzerOnAt(BuzzerMode::CHIRP, t),  "beep at %u", t);
    for (uint32_t t : off) CHECK(!buzzerOnAt(BuzzerMode::CHIRP, t), "quiet at %u", t);
    CHECK(beepsIn(BuzzerMode::CHIRP, 0, BUZZER_CHIRP_PERIOD_MS) == 3, "one burst of 3 per period");
    CHECK(BUZZER_CHIRP_PERIOD_MS >= 30000 && BUZZER_CHIRP_PERIOD_MS <= 60000, "repeats every 30-60 s");
    // Repeats for as long as the warning lasts (an hour = 80 bursts).
    CHECK(beepsIn(BuzzerMode::CHIRP, 0, 3600000) == 3 * 80, "got %d beeps in an hour", beepsIn(BuzzerMode::CHIRP, 0, 3600000));
    CHECK(buzzerOnAt(BuzzerMode::CHIRP, BUZZER_CHIRP_PERIOD_MS) && buzzerOnAt(BuzzerMode::CHIRP, 2 * BUZZER_CHIRP_PERIOD_MS + 300));
    // Still 3 per period after a warning that has lasted ~46 days of elapsed time.
    CHECK(beepsIn(BuzzerMode::CHIRP, 3960000000u, 3960000000u + BUZZER_CHIRP_PERIOD_MS) == 3);
}

static int lastBuzzerLevel() {
    for (auto it = g_hal.pinWrites.rbegin(); it != g_hal.pinWrites.rend(); ++it)
        if (it->first == BUZZER_PIN) return it->second;
    return -1;
}

static void test_driver() {
    printf("driver\n");
    g_hal.reset();
    uint32_t t = 5000;
    buzzerTick(t);                                  // OFF at boot
    CHECK(lastBuzzerLevel() == LOW);

    buzzerSetMode(BuzzerMode::CHIRP);               // Tier 1 entered
    buzzerTick(t += 10); CHECK(lastBuzzerLevel() == HIGH, "first beep starts right away");
    // The FSM re-asserts the same mode every 2 s: that must not restart the burst.
    buzzerTick(t += 160); CHECK(lastBuzzerLevel() == LOW);
    buzzerSetMode(BuzzerMode::CHIRP);
    buzzerTick(t += 10); CHECK(lastBuzzerLevel() == LOW, "re-setting CHIRP did not restart the pattern");
    size_t writes = g_hal.pinWrites.size();
    buzzerTick(t += 1); CHECK(g_hal.pinWrites.size() == writes, "pin only written on a change");

    buzzerSetMode(BuzzerMode::CONTINUOUS);          // escalation to Tier 2
    for (int i = 0; i < 100; ++i) { buzzerTick(t += 10); CHECK(lastBuzzerLevel() == HIGH); }

    buzzerSetMode(BuzzerMode::CHIRP);               // de-escalation: a fresh burst right away
    buzzerTick(t += 10); CHECK(lastBuzzerLevel() == HIGH);

    buzzerSetMode(BuzzerMode::OFF);                 // CLEAR, even mid-beep
    buzzerTick(t += 10); CHECK(lastBuzzerLevel() == LOW);

    // millis() wraps after ~49.7 days: a burst that straddles the wrap keeps its timing.
    t = 0xFFFFFF00u;                                // 256 ms before the wrap
    buzzerSetMode(BuzzerMode::CHIRP);
    buzzerTick(t);           CHECK(lastBuzzerLevel() == HIGH, "beep 1");
    buzzerTick(t + 200);     CHECK(lastBuzzerLevel() == LOW,  "gap 1");
    buzzerTick(t + 310);     CHECK(lastBuzzerLevel() == HIGH, "beep 2, after the wrap");
    buzzerTick(t + 1000);    CHECK(lastBuzzerLevel() == LOW,  "burst over");
    buzzerSetMode(BuzzerMode::OFF); buzzerTick(t + 1010);
}

int main() {
    test_pattern();
    test_driver();
    printf("%d checks, %d failures\n", g_checks, g_fails);
    return g_fails ? 1 : 0;
}

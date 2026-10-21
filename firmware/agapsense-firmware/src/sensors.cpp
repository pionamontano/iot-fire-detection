// ============================================================
// sensors.cpp — MQ-7 & DS18B20 Implementation  (v2.5)
//
// Changes in v2.5:
//   ~ MQ-7 AO now reaches GPIO 33 through a 10k/10k divider. The ADC is read
//     with analogReadMilliVolts() (eFuse-calibrated), scaled back up by the
//     divider ratio, and the divider is included in the sensor's load
//     (RL ∥ 20k) — see mq7_curve.h. The old code mapped full-scale ADC to
//     5 V, which is wrong for any wiring: the pin can only read ~3.1 V.
//   + Log line now includes the pin voltage, AO voltage and Rs, so R0 can be
//     calibrated straight from the debug/diag log.
//
// Changes from v2.0:
//   ~ a saturated sensor (Rs ≈ 0) returns the top of the range instead of
//     0 ppm, which read as clean air; readings are capped at the MQ-7's
//     rated 2000 ppm (MQ7_PPM_MAX, was 10000)
//
// Changes from v1.0:
//   + sensor_ready flag: set true after first full heat+measure cycle
//   + MQ7 ADC reads throttled to every MQ7_READ_INTERVAL_MS (5 s)
//     during MEASURING phase instead of every 500 ms task tick
// ============================================================

#include "sensors.h"
#include <math.h>
#include "diag_log.h"
#include "mq7_curve.h"

#if DEBUG_MODE
  #define SLOG(fmt, ...) Serial.printf("[SENSOR] " fmt "\n", ##__VA_ARGS__)
#elif ENABLE_DIAG_SERVER
  #define SLOG(fmt, ...) diagLogAdd("[SENSOR] " fmt, ##__VA_ARGS__)
#else
  #define SLOG(fmt, ...)
#endif

// ── DS18B20 objects ────────────────────────────────────────
static OneWire           oneWire(DS18B20_PIN);
static DallasTemperature ds18b20(&oneWire);

// ── MQ-7 analog front end ──────────────────────────────────
// Vc is the sensor circuit's supply: the fixed 5 V rail on the constant-5V
// build, the 1.4 V PWM level during MEASURING on the duty-cycle build.
#ifdef MQ7_CONTINUOUS_5V
  #define MQ7_VC_VOLTS  MQ7_SUPPLY_V
#else
  #define MQ7_VC_VOLTS  1.4f
#endif

static const agap::Mq7Circuit kMq7Circuit = {
    MQ7_VC_VOLTS,
    MQ7_RL_OHMS,
    MQ7_DIVIDER_R_TOP_OHMS,
    MQ7_DIVIDER_R_BOTTOM_OHMS,
    MQ7_R0_OHMS,
    MQ7_PPM_MAX,
};

float mq7AdcMvToPpm(int adcMv) {
    return agap::mq7PpmFromAdcVolts((float)adcMv / 1000.0f, kMq7Circuit);
}

// 32-sample average (reduces ESP32 ADC noise), in calibrated millivolts at
// the ADC pin — i.e. after the divider.
static int mq7ReadAdcMv() {
    const int N = 32;
    long sum = 0;
    for (int i = 0; i < N; i++) {
        sum += analogReadMilliVolts(MQ7_ANALOG_PIN);
        delayMicroseconds(100);
    }
    return (int)(sum / N);
}

// One averaged read → ppm, logged with everything needed to calibrate R0.
static float mq7Sample() {
    const int   adcMv = mq7ReadAdcMv();
    const float adcV  = (float)adcMv / 1000.0f;
    const float ppm   = mq7AdcMvToPpm(adcMv);
    (void)adcV;   // only used by SLOG, which a production build compiles out
    SLOG("MQ-7 pin=%d mV  AO=%.2f V  Rs=%.0f ohm  CO=%.1f ppm",
         adcMv, agap::mq7AoVolts(adcV, kMq7Circuit),
         agap::mq7RsOhms(adcV, kMq7Circuit), ppm);
    return ppm;
}

#ifdef MQ7_CONTINUOUS_5V
// ============================================================
// MQ-7 — constant-5V variant (AGS-001 hardware: MQ7_HEATER_PIN's PWM is not
// wired into the sensor's supply — it runs continuously off a fixed 5V rail,
// confirmed on hardware during bench testing). No heat/measure duty cycle
// to track, so this just reads continuously and reports MEASURING always —
// mq7GetPhase()'s signature stays the same so connectivity.cpp/main.cpp need
// no changes either way.
// ============================================================
static uint32_t  mq7StartMs     = 0;
static bool      mq7WarmupDone  = false;
static uint32_t  mq7LastRead_ms = 0;
#define MQ7_WARMUP_MS 60000UL   // datasheet warm-up before readings are trusted

void mq7Init() {
    ledcSetup(MQ7_PWM_CHANNEL, MQ7_PWM_FREQ, MQ7_PWM_RESOLUTION);
    ledcAttachPin(MQ7_HEATER_PIN, MQ7_PWM_CHANNEL);
    ledcWrite(MQ7_PWM_CHANNEL, 255);
    mq7StartMs = millis();
    SLOG("MQ-7 init — constant %.1f V, divider %.0f/%.0f ohm, RL %.0f ohm, R0 %.0f ohm, warm-up %lu ms",
         MQ7_SUPPLY_V, MQ7_DIVIDER_R_TOP_OHMS, MQ7_DIVIDER_R_BOTTOM_OHMS,
         MQ7_RL_OHMS, MQ7_R0_OHMS, MQ7_WARMUP_MS);
}

void mq7Update(SensorData* data, SemaphoreHandle_t mutex) {
    uint32_t now = millis();
    if (now - mq7LastRead_ms < MQ7_READ_INTERVAL_MS) return;
    mq7LastRead_ms = now;

    float ppm = mq7Sample();

    if (!mq7WarmupDone && now - mq7StartMs >= MQ7_WARMUP_MS) {
        mq7WarmupDone = true;
        SLOG("MQ-7 warm-up complete — sensor_ready=true");
    }

    if (xSemaphoreTake(mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        data->co_ppm       = ppm;
        data->co_valid     = true;
        data->last_co_ms   = millis();
        data->sensor_ready = mq7WarmupDone;
        xSemaphoreGive(mutex);
    } else {
        SLOG("ERROR: mutex timeout — MQ-7 write skipped");
    }
}

MQ7Phase mq7GetPhase() { return MQ7Phase::MEASURING; }

#else
// ============================================================
// MQ-7 — original heat/measure duty-cycle variant (default). Heater voltage
// is cycled between 5V (HEATING, chemically unstable — no ADC reads) and
// 1.4V (MEASURING, via MQ7_HEATER_PIN's PWM/transistor) per the MQ-7
// datasheet's measurement protocol.
// ============================================================
static MQ7Phase  mq7Phase         = MQ7Phase::HEATING;
static uint32_t  mq7PhaseStart    = 0;
static bool      mq7FirstCycleDone = false;  // tracks warm-up completion
static uint32_t  mq7LastRead_ms   = 0;       // throttle ADC reads to 5 s

// ── MQ-7 Init ──────────────────────────────────────────────
void mq7Init() {
    ledcSetup(MQ7_PWM_CHANNEL, MQ7_PWM_FREQ, MQ7_PWM_RESOLUTION);
    ledcAttachPin(MQ7_HEATER_PIN, MQ7_PWM_CHANNEL);
    ledcWrite(MQ7_PWM_CHANNEL, 255);   // full duty = 5 V heating
    mq7Phase      = MQ7Phase::HEATING;
    mq7PhaseStart = millis();
    SLOG("MQ-7 init — HEATING phase (%lu ms)", MQ7_HEAT_DURATION_MS);
}

// ── MQ-7 Phase Update ──────────────────────────────────────
void mq7Update(SensorData* data, SemaphoreHandle_t mutex) {
    uint32_t now     = millis();
    uint32_t elapsed = now - mq7PhaseStart;

    switch (mq7Phase) {

        // ── HEATING PHASE ─────────────────────────────────
        case MQ7Phase::HEATING:
            if (elapsed >= MQ7_HEAT_DURATION_MS) {
                // Transition → MEASURING (1.4 V)
                ledcWrite(MQ7_PWM_CHANNEL, MQ7_LOW_DUTY);
                mq7Phase      = MQ7Phase::MEASURING;
                mq7PhaseStart = now;
                mq7LastRead_ms = 0;   // allow immediate first read in MEASURING
                SLOG("MQ-7 → MEASURING phase (1.4 V, %lu ms)", MQ7_MEAS_DURATION_MS);
            }
            // No ADC reads during heating — output chemically unstable
            break;

        // ── MEASURING PHASE ───────────────────────────────
        case MQ7Phase::MEASURING: {
            // Throttle ADC reads to every MQ7_READ_INTERVAL_MS (5 s)
            if (now - mq7LastRead_ms >= MQ7_READ_INTERVAL_MS) {
                mq7LastRead_ms = now;

                float ppm = mq7Sample();

                if (xSemaphoreTake(mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
                    data->co_ppm     = ppm;
                    data->co_valid   = true;
                    data->last_co_ms = millis();
                    xSemaphoreGive(mutex);
                } else {
                    SLOG("ERROR: mutex timeout — MQ-7 write skipped");
                }
            }

            // Check measuring phase expiry → back to heating
            if (elapsed >= MQ7_MEAS_DURATION_MS) {
                ledcWrite(MQ7_PWM_CHANNEL, 255);  // 5 V heating
                mq7Phase      = MQ7Phase::HEATING;
                mq7PhaseStart = now;

                // Mark sensor ready after first complete cycle
                if (!mq7FirstCycleDone) {
                    mq7FirstCycleDone = true;
                    if (xSemaphoreTake(mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
                        data->sensor_ready = true;
                        xSemaphoreGive(mutex);
                    }
                    SLOG("MQ-7 warm-up complete — sensor_ready=true");
                }
                SLOG("MQ-7 → HEATING phase (5 V, %lu ms)", MQ7_HEAT_DURATION_MS);
            }
            break;
        }
    }
}

MQ7Phase mq7GetPhase() { return mq7Phase; }
#endif // MQ7_CONTINUOUS_5V

// ── DS18B20 Init ───────────────────────────────────────────
void ds18b20Init() {
    ds18b20.begin();
    ds18b20.setResolution(12);   // 12-bit = 0.0625 °C, ~750 ms conversion
    uint8_t count = ds18b20.getDeviceCount();
    SLOG("DS18B20 devices found: %d", count);
    if (count == 0) SLOG("ERROR: no DS18B20 — check wiring and pull-up resistor");
}

// ── DS18B20 Read ───────────────────────────────────────────
void ds18b20Read(SensorData* data, SemaphoreHandle_t mutex) {
    ds18b20.requestTemperatures();              // blocks ~750 ms (12-bit)
    float tempC = ds18b20.getTempCByIndex(0);

    // DEVICE_DISCONNECTED_C = -127 — library sentinel for read failure
    if (tempC == DEVICE_DISCONNECTED_C || tempC < -55.0f || tempC > 125.0f) {
        SLOG("ERROR: DS18B20 read failed (%.1f °C) — keeping last valid", tempC);
        return;
    }
    SLOG("DS18B20 = %.2f °C", tempC);

    if (xSemaphoreTake(mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        data->temperature_c = tempC;
        data->temp_valid    = true;
        data->last_temp_ms  = millis();
        xSemaphoreGive(mutex);
    } else {
        SLOG("ERROR: mutex timeout — DS18B20 write skipped");
    }
}

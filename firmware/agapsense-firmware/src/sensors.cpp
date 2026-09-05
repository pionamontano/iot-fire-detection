// ============================================================
// sensors.cpp — MQ-7 & DS18B20 Implementation  (v2.0)
//
// Changes from v1.0:
//   + sensor_ready flag: set true after first full heat+measure cycle
//   + MQ7 ADC reads throttled to every MQ7_READ_INTERVAL_MS (5 s)
//     during MEASURING phase instead of every 500 ms task tick
// ============================================================

#include "sensors.h"
#include <math.h>

#if DEBUG_MODE
  #define SLOG(fmt, ...) Serial.printf("[SENSOR] " fmt "\n", ##__VA_ARGS__)
#else
  #define SLOG(fmt, ...)
#endif

// ── DS18B20 objects ────────────────────────────────────────
static OneWire           oneWire(DS18B20_PIN);
static DallasTemperature ds18b20(&oneWire);

// ── MQ-7 state ─────────────────────────────────────────────
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

// ── ADC → PPM conversion ───────────────────────────────────
// Measurement phase Vc = 1.4 V.
// Rs = RL * (Vc - Vout) / Vout
// ppm = 100 * (Rs/R0)^(-1.513)  [curve-fitted from MQ-7 datasheet Fig 3]
float mq7RawToPpm(int rawAdc) {
    if (rawAdc <= 0) return 0.0f;
    const float Vc   = 1.4f;
    const float Vout = (float)rawAdc * Vc / (float)ADC_MAX_RAW;
    if (Vout <= 0.0f) return 0.0f;
    float Rs    = MQ7_RL_OHMS * (Vc - Vout) / Vout;
    float ratio = Rs / MQ7_R0_OHMS;
    if (ratio <= 0.0f) return 0.0f;
    float ppm = 100.0f * powf(ratio, -1.513f);
    ppm = constrain(ppm, 0.0f, 10000.0f);
    return ppm;
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

                // 32-sample average to reduce ESP32 ADC noise
                const int N = 32;
                long sum = 0;
                for (int i = 0; i < N; i++) {
                    sum += analogRead(MQ7_ANALOG_PIN);
                    delayMicroseconds(100);
                }
                int   rawAvg = (int)(sum / N);
                float ppm    = mq7RawToPpm(rawAvg);
                SLOG("MQ-7 ADC raw=%d  CO=%.1f ppm", rawAvg, ppm);

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

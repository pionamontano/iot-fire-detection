#pragma once
// ============================================================
// sensors.h — MQ-7 CO Sensor & DS18B20 Temperature Sensor
//
// Changes from v1.0:
//   + sensor_ready flag (suppresses alerts during warm-up)
//   + MQ7 ADC now read every MQ7_READ_INTERVAL_MS (5 s)
//     instead of every 500 ms task tick
// ============================================================

#include <Arduino.h>
#include <DallasTemperature.h>
#include <OneWire.h>
#include "config.h"

// ── Shared Sensor Data ─────────────────────────────────────
struct SensorData {
    float    co_ppm;
    float    temperature_c;
    bool     co_valid;
    bool     temp_valid;
    bool     sensor_ready;   // false until first full heat+measure cycle
    uint32_t last_co_ms;
    uint32_t last_temp_ms;
};

// ── MQ-7 Phase ─────────────────────────────────────────────
enum class MQ7Phase { HEATING, MEASURING };

// ── Public API ─────────────────────────────────────────────

/** Initialise LEDC PWM for MQ-7 heater. Call once before task loop. */
void mq7Init();

/**
 * Non-blocking MQ-7 phase manager + ADC read.
 * Reads ADC every MQ7_READ_INTERVAL_MS during MEASURING phase.
 * Sets data->sensor_ready = true after first full cycle.
 */
void mq7Update(SensorData* data, SemaphoreHandle_t mutex);

/** Returns current MQ-7 phase. */
MQ7Phase mq7GetPhase();

/** Convert 12-bit ADC raw to estimated CO ppm (Rs/R0 curve fit). */
float mq7RawToPpm(int rawAdc);

/** Initialise OneWire + DallasTemperature. Call once before task loop. */
void ds18b20Init();

/**
 * Request + read DS18B20 temperature (~750 ms blocking).
 * Keeps last valid reading on failure.
 */
void ds18b20Read(SensorData* data, SemaphoreHandle_t mutex);

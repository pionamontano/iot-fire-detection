#pragma once
// ============================================================
// sensors.h — MQ-7 CO Sensor & DS18B20 Temperature Sensor
//
// Changes in v2.5:
//   ~ MQ-7 AO is read through a 10k/10k divider (MQ7_DIVIDER_R_*_OHMS);
//     ADC is read as calibrated millivolts and converted by mq7_curve.h
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

// ── Sensor freshness (KI-17) ───────────────────────────────
// A sensor whose last good reading is older than this is reported as failed
// (connectivity.cpp logs it and stops presenting the frozen value as live).
// The duty-cycle MQ-7 takes no readings while heating, so its limit covers
// a whole heating phase.
#define TEMP_STALE_MS       30000UL   // ~6 missed DS18B20 reads
#ifdef MQ7_CONTINUOUS_5V
  #define CO_STALE_MS       30000UL   // ~6 missed MQ-7 reads
#else
  #define CO_STALE_MS       (MQ7_HEAT_DURATION_MS + 30000UL)
#endif

// Top of the MQ-7's rated range (datasheet: 20-2000 ppm). Readings are capped
// here, and a saturated sensor reports it, so the dashboard shows "at the top
// of the range" rather than a meaningless extrapolation such as 10000 ppm. It
// stays above every allowed alert threshold (devices.co_threshold <= 1000).
#define MQ7_PPM_MAX         2000.0f

// Temperature reported to the backend for a probe with no usable reading —
// the same value DallasTemperature uses for a disconnected sensor, so it reads
// as a fault on the dashboard rather than as a plausible room temperature.
#define TEMP_FAULT_C        (-127.0f)

// ── MQ-7 analog front end (defaults for a config.h that predates them) ──
#ifndef MQ7_SUPPLY_V
  #define MQ7_SUPPLY_V              5.0f
#endif
#ifndef MQ7_DIVIDER_R_TOP_OHMS
  #define MQ7_DIVIDER_R_TOP_OHMS    10000.0f
#endif
#ifndef MQ7_DIVIDER_R_BOTTOM_OHMS
  #define MQ7_DIVIDER_R_BOTTOM_OHMS 10000.0f
#endif

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

/**
 * Convert the voltage at the ADC pin (millivolts, after the 10k/10k divider)
 * to estimated CO ppm (Rs/R0 curve fit, see mq7_curve.h).
 */
float mq7AdcMvToPpm(int adcMv);

/** Initialise OneWire + DallasTemperature. Call once before task loop. */
void ds18b20Init();

/**
 * Request + read DS18B20 temperature (~750 ms blocking).
 * Keeps last valid reading on failure.
 */
void ds18b20Read(SensorData* data, SemaphoreHandle_t mutex);

#pragma once
// ============================================================
// mq7_curve.h — MQ-7 ADC voltage → CO ppm (pure math, host-testable)
//
// Hardware model (AGS-001):
//
//   Vc (5 V) ── Rs (sensor) ──┬── AO ── R_TOP (10k) ──┬── GPIO 33 (ADC)
//                             │                        │
//                         RL (module)            R_BOTTOM (10k)
//                             │                        │
//                            GND                      GND
//
// The MQ-7 module's AO swings 0-5 V, above the ESP32's ADC input range, so
// a 10k/10k divider halves it (0-2.5 V at the pin). Two consequences:
//   1. The AO voltage is the ADC pin voltage × (R_TOP + R_BOTTOM) / R_BOTTOM.
//   2. The divider (R_TOP + R_BOTTOM to ground) sits in parallel with the
//      module's own load resistor RL, so the effective load the sensor sees
//      is RL ∥ (R_TOP + R_BOTTOM) — 6.67 kΩ for a 10 kΩ RL, not 10 kΩ.
//
// Rs  = RL_eff * (Vc - V_AO) / V_AO
// ppm = 100 * (Rs / R0) ^ -1.513   [curve-fitted from MQ-7 datasheet Fig 3;
//                                   R0 = Rs at 100 ppm]
// ============================================================

#include <math.h>

namespace agap {

struct Mq7Circuit {
    float vcVolts;        // sensor circuit supply (Vc)
    float rlOhms;         // module's on-board load resistor
    float rTopOhms;       // divider, AO side
    float rBottomOhms;    // divider, ground side
    float r0Ohms;         // calibrated Rs at 100 ppm
    float ppmMax;         // cap (top of the sensor's rated range)
};

// AO voltage (before the divider) from the voltage measured at the ADC pin.
inline float mq7AoVolts(float adcVolts, const Mq7Circuit& c) {
    return adcVolts * (c.rTopOhms + c.rBottomOhms) / c.rBottomOhms;
}

// Effective load resistance: RL in parallel with the divider chain.
inline float mq7LoadOhms(const Mq7Circuit& c) {
    const float rDiv = c.rTopOhms + c.rBottomOhms;
    return c.rlOhms * rDiv / (c.rlOhms + rDiv);
}

// Sensor resistance Rs from the ADC pin voltage. Returns 0 when the sensor is
// saturated (AO at or above Vc), and a negative value when the ADC reads 0 V
// (no usable reading — open circuit or below the ADC's floor).
inline float mq7RsOhms(float adcVolts, const Mq7Circuit& c) {
    const float vAo = mq7AoVolts(adcVolts, c);
    if (vAo <= 0.0f) return -1.0f;
    if (vAo >= c.vcVolts) return 0.0f;
    return mq7LoadOhms(c) * (c.vcVolts - vAo) / vAo;
}

// CO ppm from the ADC pin voltage, capped to [0, ppmMax].
//   0 V at the pin   -> 0 ppm (Rs far above anything the ADC can resolve)
//   AO >= Vc (Rs≈0)  -> ppmMax, so a saturated sensor raises an alert
inline float mq7PpmFromAdcVolts(float adcVolts, const Mq7Circuit& c) {
    const float rs = mq7RsOhms(adcVolts, c);
    if (rs < 0.0f) return 0.0f;
    if (rs == 0.0f) return c.ppmMax;
    float ppm = 100.0f * powf(rs / c.r0Ohms, -1.513f);
    if (!(ppm >= 0.0f)) ppm = 0.0f;          // also catches NaN
    if (ppm > c.ppmMax) ppm = c.ppmMax;
    return ppm;
}

// R0 from a clean-air Rs: clean air sits at Rs/R0 ≈ 27.5 on the datasheet
// curve, so clean air then reads ~0.5-1 ppm.
#define MQ7_CLEAN_AIR_RATIO 27.5f
inline float mq7R0FromCleanAirRs(float rsOhms) {
    return rsOhms / MQ7_CLEAN_AIR_RATIO;
}

} // namespace agap

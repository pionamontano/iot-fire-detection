// Host tests for the MQ-7 voltage -> ppm conversion in src/mq7_curve.h
// (10k/10k divider between the module's AO and the ADC pin).
#include "../src/mq7_curve.h"
#include <cmath>
#include <cstdio>

static int fails = 0, checks = 0;
#define CHECK(c) do { checks++; if (!(c)) { fails++; std::printf("FAIL line %d: %s\n", __LINE__, #c); } } while (0)
#define NEAR(a, b, tol) (std::fabs((a) - (b)) <= (tol))

int main() {
    using namespace agap;
    const Mq7Circuit c = { 5.0f, 10000.0f, 10000.0f, 10000.0f, 10000.0f, 2000.0f };

    // Divider: pin voltage is half the AO voltage.
    CHECK(NEAR(mq7AoVolts(1.25f, c), 2.5f, 1e-5f));
    CHECK(NEAR(mq7AoVolts(2.5f, c), 5.0f, 1e-5f));
    // The divider (20k) loads the sensor in parallel with RL (10k): 6.67k.
    CHECK(NEAR(mq7LoadOhms(c), 20000.0f / 3.0f, 0.5f));

    // AO = Vc/2 -> Rs = RL_eff.
    CHECK(NEAR(mq7RsOhms(1.25f, c), 20000.0f / 3.0f, 0.5f));
    // ppm = 100 * (6666.7 / 10000)^-1.513 ≈ 184.7
    CHECK(NEAR(mq7PpmFromAdcVolts(1.25f, c), 184.7f, 0.5f));
    // Higher AO (more CO, lower Rs) -> higher ppm.
    CHECK(mq7PpmFromAdcVolts(1.5f, c) > mq7PpmFromAdcVolts(1.25f, c));
    CHECK(mq7PpmFromAdcVolts(0.5f, c) < mq7PpmFromAdcVolts(1.25f, c));

    // 0 V at the pin: no resolvable reading, reads as 0 ppm (not an alert).
    CHECK(mq7RsOhms(0.0f, c) < 0.0f);
    CHECK(mq7PpmFromAdcVolts(0.0f, c) == 0.0f);
    CHECK(mq7PpmFromAdcVolts(-0.1f, c) == 0.0f);
    // AO at/above Vc (Rs ≈ 0, saturated): top of the range, never 0 ppm.
    CHECK(mq7RsOhms(2.5f, c) == 0.0f);
    CHECK(mq7PpmFromAdcVolts(2.5f, c) == 2000.0f);
    CHECK(mq7PpmFromAdcVolts(3.1f, c) == 2000.0f);
    // Just below saturation is capped, never above ppmMax.
    CHECK(mq7PpmFromAdcVolts(2.49f, c) <= 2000.0f);

    // Calibration round trip: R0 from a clean-air Rs makes that voltage read
    // the datasheet's clean-air level (100 * 27.5^-1.513 ≈ 0.66 ppm).
    const float cleanPinV = 0.4f;
    Mq7Circuit cal = c;
    cal.r0Ohms = mq7R0FromCleanAirRs(mq7RsOhms(cleanPinV, c));
    CHECK(NEAR(mq7PpmFromAdcVolts(cleanPinV, cal), 0.664f, 0.01f));

    // A 1k RL module: the divider barely changes the load (952 ohm).
    Mq7Circuit rl1k = c; rl1k.rlOhms = 1000.0f;
    CHECK(NEAR(mq7LoadOhms(rl1k), 20000.0f / 21.0f, 0.5f));

    std::printf("mq7_curve: %d checks, %d failures\n", checks, fails);
    return fails ? 1 : 0;
}

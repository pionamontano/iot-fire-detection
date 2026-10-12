// Host-side tests for src/alert_retry.h. Pure C++ - no Arduino, no hardware, no network, fake clock.
// Build/run: ./run.sh
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include "../src/alert_retry.h"

using namespace agap;

static int g_checks = 0, g_fails = 0;
static void report_failure(int line, const char* expr, const char* fmt, ...) {
    ++g_fails;
    printf("  FAIL line %d: %s", line, expr);
    if (fmt && *fmt) { printf("  -- "); va_list ap; va_start(ap, fmt); vprintf(fmt, ap); va_end(ap); }
    printf("\n");
}
#define CHECK(cond, ...) do { ++g_checks; if (!(cond)) report_failure(__LINE__, #cond, "" __VA_ARGS__); } while (0)

static const uint32_t S = 1000;  // ms per second

// one "attempt" helper: returns the tier posted, applies the outcome
static uint8_t attempt(AlertRetryScheduler& s, uint32_t now, PostOutcome o) {
    uint8_t t = s.beginAttempt(now);
    s.onResult(o, now);
    return t;
}

static void test_classify() {
    printf("classify HTTP codes\n");
    const int ok[] = {200, 201, 204, 299};
    for (size_t i = 0; i < sizeof(ok) / sizeof(ok[0]); ++i) CHECK(classifyAlertHttp(ok[i]) == PostOutcome::Success, "%d", ok[i]);
    const int transient[] = {0, -1, -11, -5, 408, 429, 500, 502, 503, 504, 599};
    for (size_t i = 0; i < sizeof(transient) / sizeof(transient[0]); ++i) CHECK(classifyAlertHttp(transient[i]) == PostOutcome::Transient, "%d", transient[i]);
    const int perm[] = {301, 302, 400, 401, 403, 404, 405, 409, 422};
    for (size_t i = 0; i < sizeof(perm) / sizeof(perm[0]); ++i) CHECK(classifyAlertHttp(perm[i]) == PostOutcome::Permanent, "%d", perm[i]);
}

static void test_idle_and_first_attempt() {
    printf("idle, then immediate first attempt\n");
    AlertRetryScheduler s;
    CHECK(!s.shouldAttempt(0) && !s.shouldAttempt(1000000), "idle scheduler never attempts");
    CHECK(!s.pending());
    s.onTierEntered(1, 10 * S);
    CHECK(s.shouldAttempt(10 * S), "attempt immediately when a tier is entered");
    CHECK(s.pending() && s.wantedTier() == 1);
    CHECK(attempt(s, 10 * S, PostOutcome::Success) == 1);
    CHECK(!s.pending() && s.ackedTier() == 1, "success acknowledges the tier");
    CHECK(!s.shouldAttempt(10 * S) && !s.shouldAttempt(99999 * S), "no more attempts after success");
}

static void test_backoff_sequence() {
    printf("transient failures back off 5,10,20,40,60,60 s\n");
    AlertRetryScheduler s;
    uint32_t now = 1000;
    s.onTierEntered(2, now);
    const uint32_t expected[] = {5, 10, 20, 40, 60, 60, 60};
    for (size_t i = 0; i < sizeof(expected) / sizeof(expected[0]); ++i) {
        CHECK(s.shouldAttempt(now), "attempt %u due", (unsigned)i);
        attempt(s, now, PostOutcome::Transient);
        const uint32_t wait = expected[i] * S;
        CHECK(!s.shouldAttempt(now + wait - 1), "not due 1 ms early (wait %us)", (unsigned)expected[i]);
        CHECK(s.shouldAttempt(now + wait), "due exactly after %us", (unsigned)expected[i]);
        now += wait;
    }
    CHECK(s.pending() && !s.gaveUp(), "transient failures never give up while the alarm persists");
    attempt(s, now, PostOutcome::Success);
    CHECK(!s.pending() && s.ackedTier() == 2, "eventual success clears pending");
}

static void test_no_double_attempt_in_flight() {
    printf("no second attempt while one is in flight\n");
    AlertRetryScheduler s;
    s.onTierEntered(2, 0);
    CHECK(s.shouldAttempt(0));
    s.beginAttempt(0);
    CHECK(s.inFlight() && !s.shouldAttempt(0) && !s.shouldAttempt(100000), "in-flight blocks attempts");
    s.onResult(PostOutcome::Transient, 3000);
    CHECK(!s.inFlight());
    s.onResult(PostOutcome::Success, 3000);  // spurious result with nothing in flight
    CHECK(s.ackedTier() == 0, "a result with no attempt in flight is ignored");
}

static void test_escalation() {
    printf("escalation\n");
    {   // escalate while tier 1 is still failing
        AlertRetryScheduler s;
        s.onTierEntered(1, 0);
        attempt(s, 0, PostOutcome::Transient);
        CHECK(!s.shouldAttempt(1000), "backing off");
        s.onTierEntered(2, 2000);
        CHECK(s.shouldAttempt(2000), "escalation attempts immediately and resets backoff");
        CHECK(attempt(s, 2000, PostOutcome::Transient) == 2, "posts the HIGHEST tier");
        CHECK(!s.shouldAttempt(2000 + 5 * S - 1) && s.shouldAttempt(2000 + 5 * S), "backoff restarted at 5 s for the new tier");
    }
    {   // escalate after tier 1 was acknowledged
        AlertRetryScheduler s;
        s.onTierEntered(1, 0);
        attempt(s, 0, PostOutcome::Success);
        CHECK(!s.pending());
        s.onTierEntered(2, 50 * S);
        CHECK(s.pending() && s.shouldAttempt(50 * S) && attempt(s, 50 * S, PostOutcome::Success) == 2);
        CHECK(s.ackedTier() == 2 && !s.pending());
    }
    {   // re-entering a tier already wanted / lower tier is a no-op (state machine de-escalate then re-escalate)
        AlertRetryScheduler s;
        s.onTierEntered(2, 0);
        attempt(s, 0, PostOutcome::Success);
        s.onTierEntered(1, 10 * S);
        s.onTierEntered(2, 20 * S);
        CHECK(!s.pending() && !s.shouldAttempt(30 * S), "no repost for a tier the server already acknowledged");
        CHECK(s.attemptsTotal() == 1);
    }
    {   // escalation arrives while an attempt is in flight (defensive; the real task is single threaded)
        AlertRetryScheduler s;
        s.onTierEntered(1, 0);
        s.beginAttempt(0);
        s.onTierEntered(2, 100);
        s.onResult(PostOutcome::Success, 200);
        CHECK(s.ackedTier() == 1 && s.pending(), "tier 2 still pending after tier 1 acknowledged");
        CHECK(s.shouldAttempt(200), "and is sent immediately");
    }
}

static void test_clear_and_reboot() {
    printf("CLEAR cancels; reboot starts clean\n");
    AlertRetryScheduler s;
    s.onTierEntered(2, 0);
    attempt(s, 0, PostOutcome::Transient);
    s.reset();  // state machine returned to CLEAR
    CHECK(!s.pending() && !s.shouldAttempt(1000000) && s.wantedTier() == 0, "CLEAR cancels pending retries");
    s.onTierEntered(1, 500 * S);  // a NEW alarm later
    CHECK(s.shouldAttempt(500 * S) && attempt(s, 500 * S, PostOutcome::Transient) == 1);
    CHECK(!s.shouldAttempt(500 * S + 4999) && s.shouldAttempt(500 * S + 5000), "fresh backoff for the new alarm");
    AlertRetryScheduler rebooted;  // power cycle: no memory of the previous incident
    CHECK(!rebooted.pending() && !rebooted.shouldAttempt(0) && rebooted.attemptsTotal() == 0);
    rebooted.onTierEntered(2, 0);   // readings still high -> state machine re-detects -> posts again
    CHECK(rebooted.shouldAttempt(0), "after reboot the re-detected alarm is posted (server dedupes)");
}

static void test_permanent_rejections() {
    printf("permanent rejections stop after 3\n");
    AlertRetryScheduler s;
    uint32_t now = 0;
    s.onTierEntered(1, now);
    attempt(s, now, PostOutcome::Permanent);
    CHECK(!s.gaveUp() && !s.shouldAttempt(now + 4999) && s.shouldAttempt(now + 5000));
    now += 5 * S; attempt(s, now, PostOutcome::Permanent);
    CHECK(!s.gaveUp() && s.shouldAttempt(now + 10 * S));
    now += 10 * S; attempt(s, now, PostOutcome::Permanent);
    CHECK(s.gaveUp() && !s.pending() && !s.shouldAttempt(now + 9999 * S), "gives up after 3 permanent rejections");
    s.onTierEntered(2, now + 100 * S);
    CHECK(s.shouldAttempt(now + 100 * S) && !s.gaveUp(), "a higher tier re-arms it");
    // mixed: transient failures do not count toward giving up
    AlertRetryScheduler m;
    m.onTierEntered(1, 0);
    uint32_t t = 0;
    for (int i = 0; i < 10; ++i) { attempt(m, t, PostOutcome::Transient); t += 60 * S; }
    CHECK(!m.gaveUp() && m.pending(), "transient failures never count as permanent");
}

static void test_clock_wraparound() {
    printf("millis() wrap-around\n");
    AlertRetryScheduler s;
    uint32_t now = 0xFFFFFFF0u;  // 16 ms before wrap
    s.onTierEntered(2, now);
    CHECK(s.shouldAttempt(now));
    attempt(s, now, PostOutcome::Transient);  // next = now + 5000 wraps past zero
    CHECK(!s.shouldAttempt(now + 4999), "not due 1 ms early across the wrap");
    CHECK(s.shouldAttempt(now + 5000), "due after the wrap");
    CHECK(!s.shouldAttempt(0xFFFFFFF1u), "just after scheduling, before the wrap");
}

static void test_no_attempt_storm() {
    printf("polling every 10 ms for 1 h of continuous failure stays bounded\n");
    AlertRetryScheduler s;
    s.onTierEntered(2, 0);
    uint32_t attempts = 0;
    uint32_t lastAttemptAt = 0;
    for (uint32_t now = 0; now <= 3600u * S; now += 10) {
        if (s.shouldAttempt(now)) {
            if (attempts > 0) CHECK(now - lastAttemptAt >= 5 * S, "gap %u ms < 5 s", (unsigned)(now - lastAttemptAt));
            attempt(s, now, PostOutcome::Transient);
            lastAttemptAt = now; ++attempts;
        }
    }
    // 0, 5, 15, 35, 75 s then one per 60 s => about 5 + (3600-75)/60 + 1
    CHECK(attempts >= 60 && attempts <= 66, "attempts=%u", (unsigned)attempts);
}

// ---- randomised invariants ----
static uint32_t rng = 12345u;
static uint32_t rnd() { rng = rng * 1664525u + 1013904223u; return rng >> 8; }

static void test_random_invariants() {
    printf("randomised state-machine invariants (200k steps)\n");
    AlertRetryScheduler s;
    uint32_t now = 0xFFFF0000u;  // start near the wrap on purpose
    bool inflight = false;
    for (int step = 0; step < 200000; ++step) {
        now += 1 + (rnd() % 3000);
        switch (rnd() % 10) {
            case 0: s.onTierEntered(1, now); break;
            case 1: s.onTierEntered(2, now); break;
            case 2: if (rnd() % 20 == 0) { s.reset(); inflight = false; } break;
            default: break;
        }
        if (inflight) {
            PostOutcome o = (PostOutcome)(rnd() % 3);
            s.onResult(o, now); inflight = false;
        } else if (s.shouldAttempt(now)) {
            CHECK(s.pending(), "attempt only while pending");
            uint8_t before = s.wantedTier();
            uint8_t t = s.beginAttempt(now);
            CHECK(t == before && t >= 1 && t <= 2, "posts the wanted tier");
            inflight = true;
        }
        CHECK(s.ackedTier() <= s.wantedTier(), "acked <= wanted");
        CHECK(!(s.shouldAttempt(now) && s.inFlight()), "never attempt while in flight");
        CHECK(!(s.shouldAttempt(now) && s.gaveUp()), "never attempt after giving up");
    }
}

static void test_random_gap_invariant() {
    printf("randomised: consecutive attempts for an unchanged tier are >= 5 s apart\n");
    for (int run = 0; run < 200; ++run) {
        AlertRetryScheduler s;
        uint32_t now = (uint32_t)rnd();
        s.onTierEntered(1 + (rnd() % 2), now);
        uint32_t last = 0; bool have = false;
        for (int step = 0; step < 300; ++step) {
            now += 10 + (rnd() % 2500);
            if (s.shouldAttempt(now)) {
                if (have) CHECK((uint32_t)(now - last) >= 5 * S, "run %d gap %u", run, (unsigned)(now - last));
                s.beginAttempt(now);
                s.onResult((rnd() % 4 == 0) ? PostOutcome::Permanent : PostOutcome::Transient, now);
                last = now; have = true;
            }
        }
    }
}

static void test_reassert() {
    printf("reassert(): re-entering an acknowledged tier forces a fresh send\n");
    AlertRetryScheduler s;
    s.onTierEntered(2, 0); attempt(s, 0, PostOutcome::Success);
    CHECK(!s.pending() && !s.shouldAttempt(1 * S));
    s.onTierEntered(2, 10 * S);
    CHECK(!s.shouldAttempt(10 * S), "onTierEntered on an acked tier is still a no-op");
    s.reassert(2, 10 * S);
    CHECK(s.pending() && s.shouldAttempt(10 * S), "reassert makes it due immediately");
    CHECK(attempt(s, 10 * S, PostOutcome::Success) == 2 && !s.pending(), "re-sent as tier 2 and acked again");
    s.reassert(1, 20 * S);
    CHECK(!s.shouldAttempt(20 * S), "reassert never lowers the wanted tier");
    s.reassert(0, 20 * S); s.reassert(3, 20 * S);
    CHECK(!s.shouldAttempt(20 * S), "invalid tiers ignored");
    AlertRetryScheduler f;
    f.onTierEntered(2, 0); attempt(f, 0, PostOutcome::Transient); attempt(f, 5 * S, PostOutcome::Transient);
    CHECK(!f.shouldAttempt(6 * S));
    f.reassert(2, 6 * S);
    CHECK(f.shouldAttempt(6 * S), "reassert while failing resets backoff and tries now");
    attempt(f, 6 * S, PostOutcome::Transient);
    CHECK(f.nextAttemptMs() == 6 * S + 5 * S, "backoff restarted from the initial delay");
    AlertRetryScheduler g;
    g.onTierEntered(1, 0); attempt(g, 0, PostOutcome::Success);
    g.reassert(2, 30 * S);
    CHECK(g.shouldAttempt(30 * S) && g.beginAttempt(30 * S) == 2, "reassert of a higher tier behaves like escalation");
    AlertRetryScheduler d;
    d.onTierEntered(1, 0); for (int i = 0; i < 3; ++i) attempt(d, i * S, PostOutcome::Permanent);
    CHECK(d.gaveUp());
    d.reassert(1, 100 * S);
    CHECK(!d.gaveUp() && d.shouldAttempt(100 * S), "reassert clears give-up");
}

int main() {
    test_reassert();
    test_classify();
    test_idle_and_first_attempt();
    test_backoff_sequence();
    test_no_double_attempt_in_flight();
    test_escalation();
    test_clear_and_reboot();
    test_permanent_rejections();
    test_clock_wraparound();
    test_no_attempt_storm();
    test_random_invariants();
    test_random_gap_invariant();
    printf("\n%d checks, %d failed\n", g_checks, g_fails);
    return g_fails ? 1 : 0;
}

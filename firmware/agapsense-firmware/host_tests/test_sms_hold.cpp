// Host-side tests for src/sms_result_hold.h. Pure C++, fake clock.
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "../src/sms_result_hold.h"

using namespace agap;
static int g_checks = 0, g_fails = 0;
static void report_failure(int line, const char* expr, const char* fmt, ...) {
    ++g_fails; printf("  FAIL line %d: %s", line, expr);
    if (fmt && *fmt) { printf("  -- "); va_list ap; va_start(ap, fmt); vprintf(fmt, ap); va_end(ap); }
    printf("\n");
}
#define CHECK(cond, ...) do { ++g_checks; if (!(cond)) report_failure(__LINE__, #cond, "" __VA_ARGS__); } while (0)

static const uint32_t S = 1000;
static const char* ID1 = "11111111-1111-1111-1111-111111111111";
static const char* ID2 = "22222222-2222-2222-2222-222222222222";

static void test_bind_when_id_arrives() {
    printf("an unbound result waits, then binds to the CURRENT incident's id\n");
    SmsResultHolder h; HeldSmsResult r;
    h.hold("owner", "", true, 1, 0);
    h.hold("bfp", "", false, 1, 1 * S);
    CHECK(h.count() == 2);
    CHECK(!h.takeReady(1, "", 5 * S, &r), "no id yet: nothing ready");
    CHECK(h.count() == 2, "...and nothing lost while waiting");
    CHECK(h.takeReady(1, ID1, 60 * S, &r) && strcmp(r.role, "owner") == 0 && strcmp(r.eventId, ID1) == 0 && r.success, "oldest first, bound");
    CHECK(h.takeReady(1, ID1, 60 * S, &r) && strcmp(r.role, "bfp") == 0 && !r.success);
    CHECK(!h.takeReady(1, ID1, 60 * S, &r) && h.count() == 0);
}

static void test_never_bind_to_a_later_incident() {
    printf("a result from an earlier incident is NEVER attached to a later incident's id\n");
    SmsResultHolder h; HeldSmsResult r;
    h.hold("owner", "", true, 1, 0);            // incident 1, id never obtained
    CHECK(!h.takeReady(2, ID2, 10 * S, &r), "incident 2 is current: the old unbound result is not reported against ID2");
    CHECK(h.count() == 0, "...and it is discarded");
}

static void test_own_id_always_ready() {
    printf("a result that already carries its id is ready regardless of the current incident\n");
    SmsResultHolder h; HeldSmsResult r;
    h.hold("owner", ID1, true, 1, 0);
    CHECK(h.takeReady(7, "", 1 * S, &r) && strcmp(r.eventId, ID1) == 0, "reported against ITS id, not the current one");
}

static void test_ttl() {
    printf("results are dropped after the 10 minute limit\n");
    SmsResultHolder h; HeldSmsResult r;
    h.hold("owner", "", true, 1, 1000);
    CHECK(!h.takeReady(1, "", 1000 + SmsResultHolder::ttlMs(), &r) && h.count() == 1, "exactly at the limit: still held");
    CHECK(!h.takeReady(1, ID1, 1001 + SmsResultHolder::ttlMs(), &r) && h.count() == 0, "past the limit: dropped even though the id now exists");
    // wrap-around
    SmsResultHolder w; w.hold("owner", "", true, 1, 0xFFFFFF00u);
    CHECK(w.takeReady(1, ID1, 0x00000100u, &r), "held across the millis() wrap, 512 ms old: still valid");
}

static void test_capacity() {
    printf("bounded: the oldest is dropped when full\n");
    SmsResultHolder h; HeldSmsResult r;
    for (int i = 0; i < SmsResultHolder::CAPACITY; ++i) CHECK(!h.hold(i == 0 ? "owner" : "bfp", "", true, 1, i));
    CHECK(h.count() == SmsResultHolder::CAPACITY);
    CHECK(h.hold("bfp", "", false, 1, 99), "dropping the oldest is reported");
    CHECK(h.count() == SmsResultHolder::CAPACITY);
    CHECK(h.takeReady(1, ID1, 100, &r) && strcmp(r.role, "owner") != 0, "the original oldest (owner) is the one that was dropped");
}

static void test_requeue_budget() {
    printf("a failing report is retried a bounded number of times\n");
    SmsResultHolder h; HeldSmsResult r;
    h.hold("owner", "", true, 1, 0);
    int reports = 0;
    uint32_t t = 5 * S, last = 0;
    for (int guard = 0; guard < 100000; ++guard, t += 100) {          // poll every 100 ms
        if (!h.takeReady(1, ID1, t, &r)) continue;
        ++reports;
        if (reports > 1) { uint32_t gap = t - last; CHECK(gap >= 5 * S && gap <= 60 * S + 100, "gap %u ms", gap); }
        last = t;
        if (!h.requeue(r, t)) break;
    }
    CHECK(reports == SmsResultHolder::MAX_FAILED_REPORTS, "reported %d times", reports);
    CHECK(h.count() == 0, "then dropped");
    CHECK(last - 5 * S >= 5000 + 10000 + 20000 + 40000 + 60000 + 60000 + 60000 - 100 && last - 5 * S < 600 * S, "the 8 attempts span ~4 minutes, inside the 10 minute TTL");
}

static void test_boundaries_and_duplicates() {
    printf("TTL boundary with the id arriving just before / just after; duplicates are independent entries\n");
    SmsResultHolder h; HeldSmsResult r;
    h.hold("owner", "", true, 1, 1000);
    CHECK(h.takeReady(1, ID1, 1000 + SmsResultHolder::ttlMs(), &r) && strcmp(r.eventId, ID1) == 0, "id arrives exactly at the limit: reported");
    h.hold("owner", "", true, 1, 1000);
    CHECK(h.takeReady(1, ID1, 1000 + SmsResultHolder::ttlMs() - 1, &r), "1 ms before the limit: reported");
    h.hold("owner", "", true, 1, 1000);
    CHECK(!h.takeReady(1, ID1, 1000 + SmsResultHolder::ttlMs() + 1, &r) && h.count() == 0, "1 ms after the limit: discarded, never reported");
    h.hold("owner", ID1, true, 1, 0);
    CHECK(!h.takeReady(2, ID2, SmsResultHolder::ttlMs() + 1, &r), "an entry that carries its own id also expires");
    // the same result presented twice: kept as two entries (the server makes duplicate reports harmless)
    h.hold("owner", ID1, true, 1, 0); h.hold("owner", ID1, true, 1, 0);
    CHECK(h.count() == 2 && h.takeReady(1, ID1, 1, &r) && h.takeReady(1, ID1, 1, &r) && !h.takeReady(1, ID1, 1, &r), "two identical results -> two reports, not deduplicated on the device");
    // not-yet-due retry does not block others
    h.hold("owner", ID1, true, 1, 0); h.hold("bfp", ID1, true, 1, 0);
    CHECK(h.takeReady(1, ID1, 10, &r) && strcmp(r.role, "owner") == 0);
    CHECK(h.requeue(r, 10));
    CHECK(h.takeReady(1, ID1, 11, &r) && strcmp(r.role, "bfp") == 0, "bfp is reported while owner waits out its backoff");
    CHECK(!h.takeReady(1, ID1, 10 + 4999, &r) && h.takeReady(1, ID1, 10 + 5000, &r) && strcmp(r.role, "owner") == 0, "owner due exactly 5 s after the failure");
}

static void test_fifo_and_independence() {
    printf("oldest-first among ready entries; unready entries do not block ready ones\n");
    SmsResultHolder h; HeldSmsResult r;
    h.hold("owner", "", true, 2, 0);       // current incident, unbound
    h.hold("bfp", ID1, true, 1, 1);        // older incident but has its own id
    CHECK(h.takeReady(2, "", 10, &r) && strcmp(r.role, "bfp") == 0, "the entry with its own id is ready even though an older entry waits");
    CHECK(h.count() == 1);
    CHECK(h.takeReady(2, ID2, 10, &r) && strcmp(r.role, "owner") == 0 && strcmp(r.eventId, ID2) == 0);
}

static void test_null_and_long_inputs() {
    printf("defensive: null/over-long inputs never overflow\n");
    SmsResultHolder h; HeldSmsResult r;
    char longId[200]; memset(longId, 'x', sizeof(longId)); longId[199] = 0;
    h.hold(0, longId, true, 1, 0);
    CHECK(h.takeReady(1, 0, 1, &r) && strlen(r.eventId) == 39 && strlen(r.role) == 0);
    h.hold("owner-extra-long-role", "", true, 1, 0);
    CHECK(!h.takeReady(1, 0, 1, &r), "null current id is treated as unknown");
    CHECK(h.takeReady(1, ID1, 1, &r) && strlen(r.role) == 7);
}

int main() {
    test_bind_when_id_arrives();
    test_never_bind_to_a_later_incident();
    test_own_id_always_ready();
    test_ttl();
    test_capacity();
    test_requeue_budget();
    test_boundaries_and_duplicates();
    test_fifo_and_independence();
    test_null_and_long_inputs();
    printf("\n%d checks, %d failed\n", g_checks, g_fails);
    return g_fails ? 1 : 0;
}

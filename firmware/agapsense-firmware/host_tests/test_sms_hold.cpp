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
    while (h.takeReady(1, ID1, 5 * S, &r)) { ++reports; if (!h.requeue(r, 5 * S)) break; }
    CHECK(reports == SmsResultHolder::MAX_FAILED_REPORTS, "reported %d times", reports);
    CHECK(h.count() == 0, "then dropped");
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
    test_fifo_and_independence();
    test_null_and_long_inputs();
    printf("\n%d checks, %d failed\n", g_checks, g_fails);
    return g_fails ? 1 : 0;
}

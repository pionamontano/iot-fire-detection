#pragma once
// ============================================================
// sms_result_hold.h — holds finished SMS delivery results until they can be reported.
//
// PURE LOGIC (no Arduino/FreeRTOS), C++11, wrap-safe time, host-tested in host_tests/.
//
// Problem: the SMS goes out immediately and independently of the Wi-Fi/Supabase path (GSM fallback), so an SMS can finish
// BEFORE the alert POST has succeeded. The result then has no alert_event_id to be reported against, and the old
// code dropped it (confirm-sms-status never learnt about it; alert_events.sms_sent_* stayed false).
//
// This holder keeps such results (bounded, with a time limit) until the incident's id is known, then hands them out for
// reporting. Correctness rule: a result belongs to ONE incident, identified by `incidentSeq` (incremented every time the
// alert state machine starts a new incident). An unbound result is bound ONLY to the current incident's id when the
// sequence numbers match; a result from an earlier incident is discarded, never attached to a later one.
//
// It does NOT deliver anything itself and does not guarantee delivery of the report: it bounds how long and how often
// a report is tried (TTL 10 min, 5 failed reports), after which the result is dropped.
// ============================================================

#include <stdint.h>
#include <string.h>

namespace agap {

struct HeldSmsResult {
    char     role[8];        // "owner" | "bfp"
    char     eventId[40];    // alert_events.id; "" = not known yet
    bool     success;
    uint32_t incidentSeq;
    uint32_t heldSinceMs;
    uint8_t  failedReports;  // failed attempts to report this result
    uint32_t notBeforeMs;    // do not report before this time (backoff after a failed report)
};

class SmsResultHolder {
public:
    enum { CAPACITY = 4, MAX_FAILED_REPORTS = 8 };   // 8 failed reports in total, then dropped
    static uint32_t ttlMs() { return 600000UL; }   // 10 minutes

    SmsResultHolder() { clear(); }

    void clear() { n_ = 0; }
    int  count() const { return n_; }

    // Add a finished SMS result. When full the OLDEST entry is dropped (returns true if something was dropped).
    bool hold(const char* role, const char* eventId, bool success, uint32_t incidentSeq, uint32_t nowMs) {
        HeldSmsResult e;
        memset(&e, 0, sizeof(e));
        copy(e.role, sizeof(e.role), role);
        copy(e.eventId, sizeof(e.eventId), eventId);
        e.success = success;
        e.incidentSeq = incidentSeq;
        e.heldSinceMs = nowMs;
        e.notBeforeMs = nowMs;
        return push(e);
    }

    // Remove and return the oldest entry that can be reported now, with eventId filled in.
    //  * expired entries (older than the TTL) are discarded;
    //  * unbound entries from an EARLIER incident are discarded (their incident never got an id);
    //  * an unbound entry of the CURRENT incident is ready once currentEventId is known;
    //  * an entry that already carries its own id is always ready.
    bool takeReady(uint32_t currentSeq, const char* currentEventId, uint32_t nowMs, HeldSmsResult* out) {
        // discard what can never be reported
        for (int i = 0; i < n_;) {
            const HeldSmsResult& e = items_[i];
            const bool expired = static_cast<uint32_t>(nowMs - e.heldSinceMs) > ttlMs();
            const bool orphaned = e.eventId[0] == '\0' && e.incidentSeq != currentSeq;
            if (expired || orphaned) removeAt(i); else ++i;
        }
        const bool haveCurrent = currentEventId != 0 && currentEventId[0] != '\0';
        for (int i = 0; i < n_; ++i) {
            HeldSmsResult& e = items_[i];
            const bool due = static_cast<int32_t>(nowMs - e.notBeforeMs) >= 0;
            const bool ready = due && (e.eventId[0] != '\0' || (e.incidentSeq == currentSeq && haveCurrent));
            if (!ready) continue;
            *out = e;
            if (out->eventId[0] == '\0') copy(out->eventId, sizeof(out->eventId), currentEventId);
            removeAt(i);
            return true;
        }
        return false;
    }

    // Put an entry back after a TRANSIENT report failure. Returns false if its attempts are used up (dropped).
    // The next report is delayed 5,10,20,40,60,60,60 s (so a ~4 minute outage is survived instead of burning
    // every attempt in the first seconds). The entry still expires after ttlMs() from when it was held.
    bool requeue(const HeldSmsResult& e, uint32_t nowMs) {
        HeldSmsResult r = e;
        if (r.failedReports + 1 >= MAX_FAILED_REPORTS) return false;
        r.failedReports = static_cast<uint8_t>(r.failedReports + 1);
        uint32_t delay = 5000UL;
        for (int i = 1; i < r.failedReports && delay < 60000UL; ++i) delay *= 2;
        if (delay > 60000UL) delay = 60000UL;
        r.notBeforeMs = nowMs + delay;
        push(r);
        return true;
    }

private:
    static void copy(char* dst, size_t cap, const char* src) {
        if (cap == 0) return;
        if (!src) { dst[0] = '\0'; return; }
        strncpy(dst, src, cap - 1);
        dst[cap - 1] = '\0';
    }
    bool push(const HeldSmsResult& e) {
        bool dropped = false;
        if (n_ == CAPACITY) { removeAt(0); dropped = true; }
        items_[n_++] = e;
        return dropped;
    }
    void removeAt(int i) {
        for (int j = i; j + 1 < n_; ++j) items_[j] = items_[j + 1];
        --n_;
    }

    HeldSmsResult items_[CAPACITY];
    int n_;
};

}  // namespace agap

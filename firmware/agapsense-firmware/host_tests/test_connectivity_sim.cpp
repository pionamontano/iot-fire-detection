// Host-side SIMULATION of the real firmware sources src/connectivity.cpp and src/gsm.cpp (Step 5.3).
// The Arduino/ESP32/Wi-Fi/HTTP/SIM800L layers are test doubles (host_tests/stubs). What runs for real: the alert
// state machine, retry wiring, SMS queue, SMS result late-binding. What does NOT: the ESP32 toolchain, FreeRTOS
// scheduling (tasks are run sequentially), TLS, the real SIM800L. See host_tests/README.md.
// Build with -DORIGINAL_FIRMWARE against the pre-5.3 sources to see which scenarios the old code fails.
#include <stdarg.h>
#include <map>
#include <string>
#include <vector>
#include <stdlib.h>
#include "connectivity.h"
#include "gsm.h"
#include "sensors.h"
#include <WiFi.h>
#include <esp_task_wdt.h>

SimHal g_hal; FakeUart Serial1; FakeUart Serial2; FakeSerial Serial; FakeWiFi WiFi;
#ifdef ORIGINAL_FIRMWARE   // negative control against the pre-5.3 sources: they have no SMS holder
static const int kMaxReports = 8;
static int heldCount(const ConnectivityCtx&) { return 0; }
static const int kHoldCapacity = 4;
#else
static const int kMaxReports = agap::SmsResultHolder::MAX_FAILED_REPORTS;
static int heldCount(const ConnectivityCtx& c) { return c.smsHold.count(); }
static const int kHoldCapacity = agap::SmsResultHolder::CAPACITY;
#endif
MQ7Phase mq7GetPhase() { return MQ7Phase::MEASURING; }

static int g_checks = 0, g_fails = 0;
static void report_failure(int line, const char* expr, const char* fmt, ...) {
    ++g_fails; printf("  FAIL line %d: %s", line, expr);
    if (fmt && *fmt) { printf("  -- "); va_list ap; va_start(ap, fmt); vprintf(fmt, ap); va_end(ap); }
    printf("\n");
}
#define CHECK(cond, ...) do { ++g_checks; if (!(cond)) report_failure(__LINE__, #cond, "" __VA_ARGS__); } while (0)

// ── scripted backend ─────────────────────────────────────────
enum Mode { OK, DOWN, ERR500, BAD400, LOST };   // LOST: server processes the request but the response is lost
struct Server {
    Mode mode = OK;
    int smsFailures = 0;            // next N confirm-sms-status calls return 503
    int smsStatusCode = 0;          // if nonzero: always return this for confirm-sms-status
    int incidents = 0;              // distinct incidents created
    int openId = 0;                 // id number of the open incident (0 = none)
    int maxTier = 0;
    std::vector<int> alertTiers;    // tier of every trigger-alert request that REACHED the server
    struct Rep { std::string id, role; bool ok; }; std::vector<Rep> reports;   // accepted confirm-sms-status
    int smsCalls = 0;
    bool noIdInAlertReply = false;   // 200 OK but no alert_event_id (e.g. an old deployed function)
    int smsLostResponses = 0;        // next N confirm-sms-status are APPLIED but the response is lost
    uint32_t latencyOnFail = 10000;  // how long a failing call blocks the device
    std::string bfpContact = "+639222222222";   // devices.bfp_contact as an admin set it ("" = cleared)
    void closeIncident() { openId = 0; maxTier = 0; }
    std::string idStr() const { return "evt-" + std::to_string(openId); }
};
static Server srv;

static std::string field(const std::string& p, const char* key) {
    std::string k = std::string("\"") + key + "\":"; size_t i = p.find(k); if (i == std::string::npos) return "";
    i += k.size(); if (p[i] == '"') { size_t e = p.find('"', i + 1); return p.substr(i + 1, e - i - 1); }
    size_t e = p.find_first_of(",}", i); return p.substr(i, e - i);
}
static int handle(const std::string& url, const std::string& payload, std::string& body, uint32_t& lat) {
    if (url.find("get-device-config") != std::string::npos) {
        if (srv.mode == DOWN) { lat = srv.latencyOnFail; return -1; }
        body = "{\"co_alert_ppm\":200,\"temp_alert_c\":70,\"owner_number\":\"+639111111111\",\"bfp_number\":\"" + srv.bfpContact + "\"}"; return 200;
    }
    bool isAlert = url.find("trigger-alert") != std::string::npos;
    bool isSms = url.find("confirm-sms-status") != std::string::npos;
    if (srv.mode == DOWN) { lat = srv.latencyOnFail; return -1; }
    if (srv.mode == ERR500 && (isAlert || isSms)) return 500;
    if (srv.mode == BAD400 && isAlert) return 400;
    if (isAlert) {
        int tier = atoi(field(payload, "tier").c_str());
        srv.alertTiers.push_back(tier);
        if (srv.openId == 0) { srv.openId = ++srv.incidents; }
        if (tier > srv.maxTier) srv.maxTier = tier;
        if (srv.mode == LOST) { lat = 10000; return -11; }
        if (srv.noIdInAlertReply) { body = "{\"success\":true}"; return 200; }
        body = "{\"alert_event_id\":\"" + srv.idStr() + "\",\"owner_contact\":\"+639111111111\",\"bfp_contact\":\"" + srv.bfpContact + "\","
               "\"address_resolved\":\"Test Street\",\"triggered_at\":\"2026-10-12T00:00:00Z\"}";
        return 200;
    }
    if (isSms) {
        ++srv.smsCalls;
        if (srv.smsStatusCode) return srv.smsStatusCode;
        if (srv.smsFailures > 0) { --srv.smsFailures; return 503; }
        srv.reports.push_back({field(payload, "alert_event_id"), field(payload, "role"), field(payload, "success") == "true"});
        if (srv.smsLostResponses > 0) { --srv.smsLostResponses; lat = srv.latencyOnFail; return -11; }
        return 200;
    }
    return 200;   // ingest-reading
}

// ── device under test ────────────────────────────────────────
struct Dev {
    ConnectivityCtx ctx{};
    SensorData sd{}; GpsFix fix{};
    bool gsmPaused = false;
    bool coDead = false, tempDead = false;   // sensor stopped answering: its last-reading time stops advancing
    void boot() {
        ctx = ConnectivityCtx{};
        sd.co_valid = sd.temp_valid = sd.sensor_ready = true; sd.co_ppm = 5; sd.temperature_c = 25;
        sd.last_co_ms = sd.last_temp_ms = g_hal.now;
        fix.lat = 14.5995; fix.lng = 120.9842; fix.valid = true;
        connectivityInit(&ctx);
    }
    void noProbe() { sd.temp_valid = false; sd.temperature_c = 0; sd.last_temp_ms = 0; tempDead = true; }   // DS18B20 absent from boot
    void readings(float co, float t) { sd.co_ppm = co; sd.temperature_c = t; }
    void safe()  { readings(5, 25); }
    void tier1() { readings(250, 25); }
    void tier2() { readings(250, 90); }
    void tick() {                       // one connectivity-task iteration + GSM task + 2 s delay (as main.cpp)
        if (!coDead)   sd.last_co_ms   = g_hal.now;   // the sensor tasks keep refreshing their readings
        if (!tempDead) sd.last_temp_ms = g_hal.now;
        esp_task_wdt_reset();
        connectivityUpdate(&ctx, &sd, (SemaphoreHandle_t)1, &fix, (SemaphoreHandle_t)1);
        uint32_t t = g_hal.now; if (!gsmPaused) gsmProcessQueue(); g_hal.now = t;   // GSM task runs concurrently: don't charge its time
        delay(2000);
    }
    void run(int seconds) { int n = seconds / 2; for (int i = 0; i < n; i++) tick(); }
};

static void world() {
    g_hal.reset(); srv = Server(); g_hal.server = handle; gsmInit();
    g_hal.calls.clear(); g_hal.smsSent.clear(); g_hal.smsBodies.clear(); g_hal.wdtAt.clear(); g_hal.wdtResets = 0;
}
static int countCalls(const char* what) { int n = 0; for (auto& c : g_hal.calls) if (c.url.find(what) != std::string::npos) ++n; return n; }
static std::vector<uint32_t> callTimes(const char* what) { std::vector<uint32_t> v; for (auto& c : g_hal.calls) if (c.url.find(what) != std::string::npos) v.push_back(c.atMs); return v; }
static uint32_t maxWdtGap() { uint32_t m = 0; for (size_t i = 1; i < g_hal.wdtAt.size(); i++) { uint32_t g = g_hal.wdtAt[i] - g_hal.wdtAt[i-1]; if (g > m) m = g; } return m; }
static int reportsFor(const std::string& id, const std::string& role) { int n = 0; for (auto& r : srv.reports) if (r.id == id && r.role == role) ++n; return n; }
static std::string lastField(const char* what, const char* key) { std::string v; for (auto& c : g_hal.calls) if (c.url.find(what) != std::string::npos) v = field(c.payload, key); return v; }

// Sensor faults (KI-17): a missing or failed sensor must not silence the other one, must not clear an alert,
// and must show as a fault (-127 °C) instead of a frozen plausible value.
static int buzzerOnWrites() { int n = 0; for (auto& w : g_hal.pinWrites) if (w.first == BUZZER_PIN && w.second == HIGH) ++n; return n; }
static void c01_tier1_chirps() {
    printf("C01 Tier 1 chirps: one beep at once, then one every 10 s (not every tick); silent again after CLEAR\n");
    world(); Dev d; d.boot(); d.run(10);
    g_hal.pinWrites.clear(); d.tier1(); d.run(8);           // 3-tick rise, then Tier 1
    CHECK(d.ctx.alertTier == AlertTier::TIER1, "Tier 1 raised");
    CHECK(buzzerOnWrites() == 1, "chirped once on entering Tier 1 (got %d)", buzzerOnWrites());
    g_hal.pinWrites.clear(); d.run(60);
    CHECK(buzzerOnWrites() >= 5 && buzzerOnWrites() <= 7, "about one chirp per 10 s over 60 s (got %d)", buzzerOnWrites());
    d.safe(); d.run(10); g_hal.pinWrites.clear(); d.run(30);
    CHECK(d.ctx.alertTier == AlertTier::CLEAR && buzzerOnWrites() == 0, "no chirps after CLEAR (got %d)", buzzerOnWrites());
}
static void f01_no_probe_from_boot() {
    printf("F01 DS18B20 missing from boot: readings still posted (temp -127), CO alone raises Tier 1\n");
    world(); Dev d; d.boot(); d.noProbe(); d.run(40);
    CHECK(countCalls("ingest-reading") >= 1, "telemetry posted without a temperature probe (got %d)", countCalls("ingest-reading"));
    CHECK(lastField("ingest-reading", "temp_celsius") == "-127.00", "fault value reported (got %s)", lastField("ingest-reading", "temp_celsius").c_str());
    d.tier1(); d.run(20);
    CHECK(srv.alertTiers.size() == 1 && srv.alertTiers[0] == 1, "one tier-1 POST from CO alone (got %zu)", srv.alertTiers.size());
    CHECK(d.ctx.alertTier == AlertTier::TIER1, "device in TIER1");
    CHECK(lastField("trigger-alert", "temp_celsius") == "-127.00", "alert carries the fault value, not a made-up temperature");
    CHECK(g_hal.smsSent.empty(), "Tier 1 sends no SMS (got %zu)", g_hal.smsSent.size());
}
static void f02_probe_fails_at_room_temperature() {
    printf("F02 DS18B20 stops answering at room temperature: reported as -127 after the stale limit, CO still alerts, recovery restores it\n");
    world(); Dev d; d.boot(); d.run(10);
    d.tempDead = true; d.run(70);
    CHECK(lastField("ingest-reading", "temp_celsius") == "-127.00", "frozen 25 C no longer reported as live (got %s)", lastField("ingest-reading", "temp_celsius").c_str());
    d.tier1(); d.run(20);
    CHECK(srv.alertTiers.size() == 1 && srv.alertTiers[0] == 1, "CO still raises Tier 1 (got %zu)", srv.alertTiers.size());
    d.tempDead = false; d.run(40);
    CHECK(lastField("ingest-reading", "temp_celsius") == "25.00", "live value again once the probe answers (got %s)", lastField("ingest-reading", "temp_celsius").c_str());
}
static void f03_probe_dies_hot_during_tier2() {
    printf("F03 DS18B20 dies while over threshold in a Tier 2: alert held, hot value still reported, nothing re-sent\n");
    world(); Dev d; d.boot(); d.tier2(); d.run(20);
    CHECK(d.ctx.alertTier == AlertTier::TIER2, "Tier 2 raised");
    d.tempDead = true; d.run(120);
    CHECK(d.ctx.alertTier == AlertTier::TIER2, "not de-escalated by a dead probe");
    CHECK(lastField("ingest-reading", "temp_celsius") == "90.00", "last hot value kept (got %s)", lastField("ingest-reading", "temp_celsius").c_str());
    CHECK(srv.alertTiers.size() == 1, "no extra alert POST (got %zu)", srv.alertTiers.size());
}

// ── scenarios ────────────────────────────────────────────────
// BFP contact changes made by an admin on the Devices page (devices.bfp_contact). The device
// loads the number at boot (get-device-config) and again from every trigger-alert reply.
static bool textedNumber(const std::string& n) { for (auto& s : g_hal.smsSent) if (s == n) return true; return false; }
static void b01_cleared_bfp_contact_is_not_texted() {
    printf("B01 admin clears the BFP contact after boot: the next fire texts only the owner, never the old number\n");
    world(); Dev d; d.boot(); d.run(10);                 // booted with the old number loaded
    srv.bfpContact = ""; d.tier2(); d.run(30);
    CHECK(srv.alertTiers.size() == 1, "alert still reported (got %zu)", srv.alertTiers.size());
    CHECK(!textedNumber("+639222222222"), "old BFP number not texted");
    CHECK(g_hal.smsSent.size() == 1 && g_hal.smsSent[0] == "+639111111111", "owner SMS only (got %zu)", g_hal.smsSent.size());
    CHECK(reportsFor("evt-1", "owner") == 1 && reportsFor("evt-1", "bfp") == 0, "no BFP delivery reported (%zu)", srv.reports.size());
}
static void b02_replaced_bfp_contact_is_used_at_once() {
    printf("B02 admin replaces the BFP contact after boot: the next fire texts the new number, not the old one\n");
    world(); Dev d; d.boot(); d.run(10);
    srv.bfpContact = "09333333333"; d.tier2(); d.run(30);
    CHECK(textedNumber("09333333333"), "new BFP number texted");
    CHECK(!textedNumber("+639222222222"), "old BFP number not texted");
    CHECK(reportsFor("evt-1", "bfp") == 1, "BFP delivery reported once");
}
static void b03_cleared_at_boot_and_server_down() {
    printf("B03 BFP contact already cleared when the device booted, server down during the fire: owner SMS only\n");
    world(); srv.bfpContact = ""; Dev d; d.boot(); d.run(10);
    srv.mode = DOWN; d.tier2(); d.run(30);
    CHECK(g_hal.smsSent.size() == 1 && g_hal.smsSent[0] == "+639111111111", "owner SMS only (got %zu)", g_hal.smsSent.size());
    CHECK(!textedNumber("+639222222222"), "no BFP SMS");
}
static void s01_normal() {
    printf("S01 normal: one alert POST, two SMS, two confirmations, nothing repeated\n");
    world(); Dev d; d.boot(); d.tier2(); d.run(20);
    CHECK(srv.alertTiers.size() == 1 && srv.alertTiers[0] == 2, "one tier-2 POST (got %zu)", srv.alertTiers.size());
    CHECK(g_hal.smsSent.size() == 2, "owner+bfp SMS (got %zu)", g_hal.smsSent.size());
    CHECK(g_hal.smsSent.size() == 2 && g_hal.smsSent[0] == "+639111111111" && g_hal.smsSent[1] == "+639222222222");
    CHECK(reportsFor("evt-1", "owner") == 1 && reportsFor("evt-1", "bfp") == 1 && srv.reports.size() == 2, "reports=%zu", srv.reports.size());
    d.run(300);
    CHECK(srv.alertTiers.size() == 1, "no repeated POST while the fire continues");
    CHECK(g_hal.smsSent.size() == 2, "SMS debounce unchanged: no repeat");
    d.safe(); d.run(10);
    CHECK(srv.alertTiers.size() == 1 && d.ctx.alertTier == AlertTier::CLEAR, "clearing sends nothing");
}
static void s02_server_down_then_recovers() {
    printf("S02 server unreachable for the first ~60 s: SMS go out at once, POST retried with backoff, SMS result bound late\n");
    world(); Dev d; d.boot(); srv.mode = DOWN; g_hal.probeReachable = true; d.tier2();
    uint32_t t0 = g_hal.now; d.run(8);                           // debounce (3 ticks) + a few more
    CHECK(g_hal.smsSent.size() == 2, "both SMS sent before any POST succeeded (got %zu)", g_hal.smsSent.size());
    d.run(52);
    srv.mode = OK; d.run(60);
    auto times = callTimes("trigger-alert");
    CHECK(srv.alertTiers.size() >= 1 && srv.alertTiers.back() == 2, "tier 2 finally reached the server");
    CHECK(times.size() >= 3 && times.size() <= 8, "bounded number of attempts (got %zu)", times.size());
    for (size_t i = 2; i < times.size(); i++) CHECK(times[i] - times[i-1] >= 5000, "gap %u ms", times[i] - times[i-1]);
    CHECK(reportsFor("evt-1", "owner") == 1 && reportsFor("evt-1", "bfp") == 1, "late-bound SMS results reported once each (%zu)", srv.reports.size());
    size_t n = srv.reports.size(); d.run(200);
    CHECK(srv.reports.size() == n && countCalls("trigger-alert") == (int)times.size(), "nothing repeated after success");
    CHECK(maxWdtGap() < (uint32_t)WDT_TIMEOUT_S * 1000, "WDT gap %u ms", maxWdtGap());
    (void)t0;
}
static void s03_5xx_then_ok() {
    printf("S03 two 500s then success: retries then stops\n");
    world(); Dev d; d.boot(); srv.mode = ERR500; d.tier2(); d.run(14);
    int during = countCalls("trigger-alert"); CHECK(during >= 2 && during <= 3, "attempts while failing = %d", during);
    srv.mode = OK; d.run(40);
    CHECK(srv.alertTiers.size() == 1, "one accepted POST");
    int total = countCalls("trigger-alert"); d.run(120);
    CHECK(countCalls("trigger-alert") == total, "no POST after success");
    CHECK(srv.reports.size() == 2);
}
static void s04_permanent_400() {
    printf("S04 permanent 400: gives up after 3, SMS still sent, no confirmation with a bogus id\n");
    world(); Dev d; d.boot(); srv.mode = BAD400; d.tier2(); d.run(120);
    CHECK(countCalls("trigger-alert") == 3, "exactly 3 attempts (got %d)", countCalls("trigger-alert"));
    CHECK(g_hal.smsSent.size() == 2, "GSM fallback unaffected");
    CHECK(srv.smsCalls == 0, "no confirm-sms-status call without an alert_event_id");
    d.run(700);
    CHECK(countCalls("trigger-alert") == 3 && srv.smsCalls == 0, "still nothing after the hold TTL");
}
static void s05_escalation_while_failing() {
    printf("S05 tier1 then escalation while the server is down: the tier that finally lands is 2\n");
    world(); Dev d; d.boot(); srv.mode = DOWN; d.tier1(); d.run(8);
    CHECK(g_hal.smsSent.empty(), "tier 1 sends no SMS");
    d.tier2(); d.run(10); srv.mode = OK; d.run(80);
    CHECK(!srv.alertTiers.empty() && srv.alertTiers.front() == 2, "first accepted POST is tier 2 (got %d)", srv.alertTiers.empty() ? -1 : srv.alertTiers.front());
    CHECK(g_hal.smsSent.size() == 2);
    CHECK(srv.reports.size() == 2, "reports=%zu", srv.reports.size());
}
static void s06_escalation_after_ack() {
    printf("S06 tier 1 acknowledged, then escalation, then de-escalate and re-escalate: tier 2 is (re)POSTed each time, as before 5.3\n");
    world(); Dev d; d.boot(); d.tier1(); d.run(10);
    CHECK(srv.alertTiers.size() == 1 && srv.alertTiers[0] == 1 && g_hal.smsSent.empty());
    d.tier2(); d.run(10);
    CHECK(srv.alertTiers.size() == 2 && srv.alertTiers[1] == 2, "escalation POSTed immediately");
    CHECK(g_hal.smsSent.size() == 2 && srv.reports.size() == 2);
    d.tier1(); d.run(8); CHECK(d.ctx.alertTier == AlertTier::TIER1);
    d.tier2(); d.run(10);
    CHECK(srv.alertTiers.size() == 3 && srv.alertTiers[2] == 2, "re-escalation re-POSTs (pre-5.3 behaviour) (%zu)", srv.alertTiers.size());
    CHECK(g_hal.smsSent.size() == 2, "...but the 5-minute SMS debounce still suppresses a second SMS pair");
}
static void s07_clear_cancels() {
    printf("S07 CLEAR cancels a pending retry\n");
    world(); Dev d; d.boot(); srv.mode = DOWN; d.tier2(); d.run(10);
    d.safe(); d.run(6); CHECK(d.ctx.alertTier == AlertTier::CLEAR);
    int n = countCalls("trigger-alert"); srv.mode = OK; d.run(300);
    CHECK(countCalls("trigger-alert") == n, "no alert POST after CLEAR (%d -> %d)", n, countCalls("trigger-alert"));
    CHECK(srv.incidents == 0, "server never created the stale incident");
    CHECK(srv.smsCalls == 0, "the orphaned SMS results were never reported against any id");
}
static void s07b_tier1_clear_cancels() {
    printf("S07b CLEAR cancels a pending TIER 1 retry as well\n");
    world(); Dev d; d.boot(); srv.mode = DOWN; d.tier1(); d.run(10);
    d.safe(); d.run(6); CHECK(d.ctx.alertTier == AlertTier::CLEAR);
    int n = countCalls("trigger-alert"); srv.mode = OK; d.run(300);
    CHECK(countCalls("trigger-alert") == n, "no alert POST after CLEAR (%d -> %d)", n, countCalls("trigger-alert"));
}
static void s08_new_incident_does_not_inherit() {
    printf("S08 a new incident never inherits the previous incident's SMS results\n");
    world(); Dev d; d.boot(); srv.mode = DOWN; d.tier2(); d.run(10);
    d.safe(); d.run(6); srv.mode = OK; d.run(320);   // > the 5-minute SMS debounce, so incident 2 may text again
    d.tier2(); d.run(30);
    CHECK(srv.incidents == 1 && srv.alertTiers.size() == 1, "second incident created once");
    CHECK(g_hal.smsSent.size() == 4, "4 SMS in total (2 per incident) (%zu)", g_hal.smsSent.size());
    CHECK(srv.reports.size() == 2, "only incident 2's two results are reported, not four (%zu)", srv.reports.size());
}
static void s09_offline_then_online() {
    printf("S09 Wi-Fi down during the fire, comes back later\n");
    world(); Dev d; d.boot(); g_hal.wifiUp = false; d.tier2(); d.run(20);
    CHECK(g_hal.smsSent.size() == 2, "SMS go out independent of Wi-Fi");
    CHECK(countCalls("trigger-alert") == 0 && d.ctx.deviceState == DeviceState::OFFLINE);
    g_hal.wifiUp = true; d.run(30);
    CHECK(srv.alertTiers.size() == 1 && srv.alertTiers[0] == 2, "alert delivered once connectivity returns");
    CHECK(srv.reports.size() == 2, "late SMS results reported (%zu)", srv.reports.size());
}
static void s10_sms_report_transient() {
    printf("S10 confirm-sms-status fails transiently: retried, reported exactly once each\n");
    world(); Dev d; d.boot(); srv.smsFailures = 3; d.tier2(); d.run(40);
    CHECK(reportsFor("evt-1", "owner") == 1 && reportsFor("evt-1", "bfp") == 1, "reports=%zu", srv.reports.size());
}
static void s11_sms_report_permanent_outage() {
    printf("S11 confirm-sms-status down forever: bounded retries, then dropped\n");
    world(); Dev d; d.boot(); srv.smsStatusCode = 503; d.tier2(); d.run(120);
    d.run(300);
    int n = srv.smsCalls; CHECK(n == 2 * kMaxReports, "bounded (%d)", n);
    d.run(600); CHECK(srv.smsCalls == n, "stopped retrying");
    auto c = callTimes("confirm-sms-status");
    for (size_t i = 1; i < c.size(); i++) CHECK(c[i] - c[i-1] >= 1500, "at most one failing report per tick (gap %u ms)", c[i] - c[i-1]);
}
static void s12_reboot_during_fire() {
    printf("S12 device reboots mid-fire: alert re-sent (server dedupes), SMS pair repeats once (documented, D5.7)\n");
    world(); Dev d; d.boot(); d.tier2(); d.run(20);
    Dev d2; d2.boot(); d2.tier2(); d2.run(20);
    CHECK(srv.incidents == 1, "still one open incident on the server");
    CHECK(g_hal.smsSent.size() == 4, "SMS repeated after reboot (at-least-once) (%zu)", g_hal.smsSent.size());
    CHECK(reportsFor("evt-1", "owner") == 2, "both runs' results reported against the same incident");
}
static void s13_lost_response() {
    printf("S13 response lost after the server processed the alert: retry is harmless\n");
    world(); Dev d; d.boot(); srv.mode = LOST; d.tier2(); d.run(20); srv.mode = OK; d.run(60);
    CHECK(srv.incidents == 1, "server saw several requests but holds one incident");
    CHECK(srv.alertTiers.size() >= 2, "the server did receive the request more than once (at-least-once)");
    CHECK(srv.reports.size() == 2);
}
static void s14_one_post_per_tick_and_wdt() {
    printf("S14 everything failing at once: no tick makes more than 2 blocking calls' worth of work; WDT fed\n");
    world(); Dev d; d.boot(); srv.mode = DOWN; d.tier2(); d.run(600);
    CHECK(maxWdtGap() < (uint32_t)WDT_TIMEOUT_S * 1000, "max gap between WDT feeds %u ms", maxWdtGap());
    // per tick: at most 1 alert POST
    auto a = callTimes("trigger-alert"); for (size_t i = 1; i < a.size(); i++) CHECK(a[i] != a[i-1]);
}
static void s15_cap_on_attempts_over_an_hour() {
    printf("S15 one hour of a dead server: attempts follow the 5/10/20/40/60 s backoff, never a storm\n");
    world(); Dev d; d.boot(); srv.mode = DOWN; d.tier2(); uint32_t t0 = g_hal.now; d.run(3600);
    auto a = callTimes("trigger-alert"); uint32_t elapsed = g_hal.now - t0;
    CHECK(a.size() > 20 && a.size() <= elapsed / 60000 + 2, "attempts=%zu in %u s", a.size(), elapsed / 1000);
    for (size_t i = 6; i < a.size(); i++) CHECK(a[i] - a[i-1] >= 60000, "steady-state gap %u ms", a[i] - a[i-1]);
}

static void s16_bound_id_is_honoured() {
    printf("S16 a result that already carries its incident's id is reported against THAT id, even after a new incident began\n");
    world(); Dev d; d.boot(); d.tier2(); d.tick(); d.tick(); d.tick();   // POST ok (evt-1) and SMS queued with id evt-1
    g_hal.wifiUp = false;                                      // link lost before the results could be reported
    d.run(4);
    CHECK(srv.reports.empty() && g_hal.smsSent.size() == 2);
    d.safe(); d.run(6); CHECK(d.ctx.alertTier == AlertTier::CLEAR);
    srv.closeIncident(); d.tier2(); d.run(10);                 // second incident starts while still offline (SMS debounced)
    g_hal.wifiUp = true; d.run(30);
    CHECK(reportsFor("evt-1", "owner") == 1 && reportsFor("evt-1", "bfp") == 1, "incident 1's results reported against evt-1 (%zu)", srv.reports.size());
    CHECK(reportsFor("evt-2", "owner") == 0 && reportsFor("evt-2", "bfp") == 0 && reportsFor("", "owner") == 0, "...and never against incident 2 or an empty id");
}
static void s17_offline_across_sms_debounce() {
    printf("S17 offline for ~6 minutes with a second SMS pair: the GSM result ring never overflows, all four results are reported later\n");
    world(); Dev d; d.boot(); g_hal.wifiUp = false; d.tier2(); d.run(20);
    d.tier1(); d.run(8); CHECK(d.ctx.alertTier == AlertTier::TIER1);
    d.run(320);                                                // past the 5-minute SMS debounce
    d.tier2(); d.run(8);
    CHECK(g_hal.smsSent.size() == 4, "second pair sent after the debounce (%zu)", g_hal.smsSent.size());
    g_hal.wifiUp = true; d.run(40);
    CHECK(srv.reports.size() == 4, "all four SMS results reported (%zu)", srv.reports.size());
}
static void s18_late_gsm_results_after_new_incident() {
    printf("S18 GSM task is slow: results of incident 1 arrive after incident 2 has begun and must not be attributed to it\n");
    world(); Dev d; d.boot(); srv.mode = DOWN; d.gsmPaused = true; d.tier2(); d.run(6);
    d.safe(); d.run(6); CHECK(d.ctx.alertTier == AlertTier::CLEAR);
    srv.mode = OK; d.tier2(); d.run(10);
    CHECK(srv.alertTiers.size() == 1, "incident 2 reached the server");
    d.gsmPaused = false; d.run(30);
    CHECK(g_hal.smsSent.size() == 2, "incident 1's SMS were still delivered (%zu)", g_hal.smsSent.size());
    CHECK(srv.reports.empty(), "...but their results are not reported against incident 2 (%zu reports)", srv.reports.size());
}

// ── Step 5.3 review: targeted edge cases (numbering follows the review request) ──
static void r01_old_result_after_new_incident() {   // = S18, plus the bound-id variant S16
    printf("R01 an old SMS result arrives after a new incident started -> never attributed to it (see S16, S18)\n");
    s18_late_gsm_results_after_new_incident();
}
static void r02_two_incidents_lost_or_delayed_responses() {
    printf("R02 two incidents in sequence, POST responses lost/delayed: each result goes to its own incident\n");
    world(); Dev d; d.boot(); srv.mode = LOST; d.tier2(); d.run(12);          // incident 1: server records it (evt-1), device never hears
    CHECK(srv.incidents == 1 && g_hal.smsSent.size() == 2);
    d.safe(); d.run(6); CHECK(d.ctx.alertTier == AlertTier::CLEAR);
    srv.closeIncident(); srv.mode = LOST; d.run(320);                          // past the SMS debounce
    d.tier2(); d.run(12);                                                      // incident 2: server records it (evt-2), response lost again
    CHECK(srv.incidents == 2 && g_hal.smsSent.size() == 4, "incidents=%d sms=%zu", srv.incidents, g_hal.smsSent.size());
    srv.mode = OK; d.run(80);
    CHECK(reportsFor("evt-1", "owner") + reportsFor("evt-1", "bfp") == 0, "incident 1's results (never bound) are not reported against evt-1 or evt-2");
    CHECK(reportsFor("evt-2", "owner") == 1 && reportsFor("evt-2", "bfp") == 1, "incident 2's own results reported against evt-2 (%zu)", srv.reports.size());
}
static void r03_id_arrives_around_ttl() {
    printf("R03 incident id arrives before / after the ten minute expiry (exact boundary: test_sms_hold.cpp; end-to-end here)\n");
    for (int downSec : {300, 700}) {
        world(); Dev d; d.boot(); srv.mode = DOWN; srv.latencyOnFail = 1000; d.tier2(); d.run(downSec);
        srv.mode = OK; d.run(200);
        size_t n = srv.reports.size();
        if (downSec == 300) CHECK(n == 2, "id obtained ~5 min in: both results reported (%zu)", n);
        else CHECK(n == 0, "id obtained ~12 min in: results expired, nothing reported against the incident (%zu)", n);
        CHECK(srv.alertTiers.size() == 1, "the alert itself is delivered either way");
    }
}
static void r04_holder_capacity() {
    printf("R04 holder at capacity: oldest dropped, newest kept (unit: test_sms_hold.cpp); end-to-end 3 SMS pairs while no id\n");
    world(); Dev d; d.boot(); srv.mode = BAD400; d.tier2(); d.run(12);          // no id will ever arrive (400s)
    for (int k = 0; k < 2; k++) { d.tier1(); d.run(8); d.run(320); d.tier2(); d.run(8); }
    CHECK(g_hal.smsSent.size() == 6, "3 pairs sent (%zu)", g_hal.smsSent.size());
    CHECK(heldCount(d.ctx) <= kHoldCapacity, "holder bounded (%d)", heldCount(d.ctx));
    CHECK(srv.smsCalls == 0, "nothing reported without an id");
}
static void r05_duplicate_report_is_harmless() {
    printf("R05 the same delivery report is presented twice (response lost after the server applied it)\n");
    world(); Dev d; d.boot(); srv.smsLostResponses = 2; d.tier2(); d.run(60);
    CHECK(reportsFor("evt-1", "owner") >= 1 && reportsFor("evt-1", "bfp") >= 1);
    CHECK(srv.reports.size() >= 3 && srv.reports.size() <= 4, "server received %zu reports (>2 = duplicates, by design)", srv.reports.size());
    for (auto& r : srv.reports) CHECK(r.ok && r.id == "evt-1", "every duplicate says the same thing about the same incident");
    size_t n = srv.reports.size(); d.run(200); CHECK(srv.reports.size() == n, "and it stops");
}
static void r06_report_retry_exhaustion() {
    printf("R06 status report fails repeatedly: 8 attempts per result with backoff, then dropped\n");
    world(); Dev d; d.boot(); srv.smsStatusCode = 503; d.tier2(); d.run(600);
    CHECK(srv.smsCalls == 2 * kMaxReports, "calls=%d", srv.smsCalls);
    auto c = callTimes("confirm-sms-status");
    CHECK(c.size() >= 8 && c.back() - c[0] >= 150000, "spread over minutes, not burst (span %u ms)", c.size() >= 8 ? c.back() - c[0] : 0);
    CHECK(heldCount(d.ctx) == 0, "nothing left behind");
}
static void r06b_report_survives_short_outage() {
    printf("R06b a 60 s outage of confirm-sms-status does not lose the report\n");
    world(); Dev d; d.boot(); srv.smsStatusCode = 503; d.tier2(); d.run(60); srv.smsStatusCode = 0; d.run(200);
    CHECK(reportsFor("evt-1", "owner") == 1 && reportsFor("evt-1", "bfp") == 1, "reports=%zu", srv.reports.size());
}
static void r07_clear_while_retry_pending() {   // = S07/S07b
    printf("R07 CLEAR while a retry is pending (tier 1 and tier 2): see S07, S07b\n");
    s07_clear_cancels(); s07b_tier1_clear_cancels();
}
static void r08_reassert_after_failure() {
    printf("R08 tier 2 re-asserted after a previous request failed/timed out\n");
    world(); Dev d; d.boot(); srv.mode = DOWN; d.tier2(); d.run(6);              // attempt 1 times out
    d.tier1(); d.run(8); CHECK(d.ctx.alertTier == AlertTier::TIER1);
    srv.mode = OK; d.tier2(); d.run(10);                                         // re-escalation -> immediate fresh attempt with tier 2
    CHECK(!srv.alertTiers.empty() && srv.alertTiers.front() == 2, "tier 2 delivered at once on re-escalation");
    size_t n = srv.alertTiers.size(); d.run(120);
    CHECK(srv.alertTiers.size() == n, "and then no more");
    CHECK(g_hal.smsSent.size() == 2, "SMS debounce unchanged");
}
static void r09_offline_longer_than_interval() {
    printf("R09 offline for 10 minutes (>> retry interval): no attempts and no backoff growth while offline; immediate attempt on reconnect\n");
    world(); Dev d; d.boot(); srv.mode = DOWN; d.tier2(); d.run(40);
    int before = countCalls("trigger-alert");
    srv.mode = OK; g_hal.wifiUp = false; d.run(600);
    CHECK(countCalls("trigger-alert") == before, "no alert POST while offline");
    g_hal.wifiUp = true; d.run(6);
    CHECK(srv.alertTiers.size() == 1 && srv.alertTiers[0] == 2, "delivered within a few ticks of reconnecting");
}
static void r10_reboot_during_incident() {   // = S12
    printf("R10 reboot during an active incident: one duplicate SMS pair is possible and documented: see S12\n");
    s12_reboot_during_fire();
}
static void r11_200_without_usable_id() {
    printf("R11 2xx without alert_event_id: treated as delivered (no retry), results can never be bound, nothing bogus is reported\n");
    world(); Dev d; d.boot(); srv.noIdInAlertReply = true; d.tier2(); d.run(60);
    CHECK(countCalls("trigger-alert") == 1, "not retried: the server answered success");
    CHECK(g_hal.smsSent.size() == 2 && srv.smsCalls == 0, "SMS sent, no report without an id");
}
static void r12_wdt_with_slow_failures() {
    printf("R12 failing calls that block 20 s each (connect + request timeouts): feeds keep every gap < 30 s\n");
    world(); Dev d; d.boot(); srv.mode = DOWN; srv.latencyOnFail = 20000; d.tier2(); d.run(900);
    CHECK(maxWdtGap() < (uint32_t)WDT_TIMEOUT_S * 1000, "max gap %u ms", maxWdtGap());
}

static void r06c_two_ready_results_one_failing_report_per_tick() {
    printf("R06c two held results become ready in the same tick and the report endpoint fails: one failing report per tick\n");
    world(); Dev d; d.boot(); srv.mode = DOWN; srv.latencyOnFail = 1000; d.tier2(); d.run(20);
    srv.mode = OK; srv.smsStatusCode = 503; d.run(60);
    auto c = callTimes("confirm-sms-status");
    CHECK(c.size() >= 4, "reports were attempted (%zu)", c.size());
    for (size_t i = 1; i < c.size(); i++) CHECK(c[i] - c[i-1] >= 1500, "gap %u ms", c[i] - c[i-1]);
}
static void r12b_wdt_alert_after_config_and_telemetry_coincide() {
    printf("R12b config fetch + alert retry + telemetry due in the same tick, each blocking 20 s\n");
    world(); Dev d; d.boot(); srv.mode = DOWN; srv.latencyOnFail = 20000; d.tier2(); d.tick(); d.tick();
    d.ctx.lastConfigFetch_ms = g_hal.now - CONFIG_FETCH_INTERVAL_MS; d.ctx.lastTelemetry_ms = g_hal.now - TELEMETRY_INTERVAL_MS;
    d.tick(); d.run(60);
    CHECK(maxWdtGap() < (uint32_t)WDT_TIMEOUT_S * 1000, "max gap %u ms", maxWdtGap());
}
static void r12c_wdt_telemetry_and_report_coincide() {
    printf("R12c telemetry + SMS status report due in the same tick, each blocking 20 s\n");
    world(); Dev d; d.boot(); d.tier2(); d.tick(); d.tick(); d.tick();           // alert acked, SMS queued with id
    srv.mode = DOWN; srv.latencyOnFail = 20000; d.ctx.lastTelemetry_ms = g_hal.now - TELEMETRY_INTERVAL_MS;
    g_hal.wdtAt.clear(); d.tick(); d.run(40);
    CHECK(maxWdtGap() < (uint32_t)WDT_TIMEOUT_S * 1000, "max gap %u ms", maxWdtGap());
}

int main() {
    s01_normal(); s02_server_down_then_recovers(); s03_5xx_then_ok(); s04_permanent_400(); s05_escalation_while_failing();
    s06_escalation_after_ack(); s07_clear_cancels(); s07b_tier1_clear_cancels(); s08_new_incident_does_not_inherit(); s09_offline_then_online();
    s10_sms_report_transient(); s11_sms_report_permanent_outage(); s12_reboot_during_fire(); s13_lost_response();
    s14_one_post_per_tick_and_wdt(); s15_cap_on_attempts_over_an_hour();
    s16_bound_id_is_honoured(); s17_offline_across_sms_debounce(); s18_late_gsm_results_after_new_incident();
    r01_old_result_after_new_incident(); r02_two_incidents_lost_or_delayed_responses(); r03_id_arrives_around_ttl(); r04_holder_capacity();
    r05_duplicate_report_is_harmless(); r06_report_retry_exhaustion(); r06b_report_survives_short_outage(); r07_clear_while_retry_pending();
    r08_reassert_after_failure(); r09_offline_longer_than_interval(); r10_reboot_during_incident(); r11_200_without_usable_id(); r12_wdt_with_slow_failures();
    r06c_two_ready_results_one_failing_report_per_tick(); r12b_wdt_alert_after_config_and_telemetry_coincide(); r12c_wdt_telemetry_and_report_coincide();
    b01_cleared_bfp_contact_is_not_texted(); b02_replaced_bfp_contact_is_used_at_once(); b03_cleared_at_boot_and_server_down();
    f01_no_probe_from_boot(); f02_probe_fails_at_room_temperature(); f03_probe_dies_hot_during_tier2();
    c01_tier1_chirps();
    printf("\n%d checks, %d failed\n", g_checks, g_fails);
    return g_fails ? 1 : 0;
}

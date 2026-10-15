#include "diag_server.h"

#ifdef ENABLE_DIAG_SERVER
#include "diag_log.h"
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoOTA.h>
#include <ESPmDNS.h>

static WebServer  server(80);
static bool       serverStarted = false;
static IPAddress  lastIp;

static void handleLogRaw() {
    server.send(200, "text/plain", diagLogDump());
}

static const char LOG_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgapSense Diagnostic Log</title>
<style>
body{background:#0b0f14;color:#e8eef5;font-family:ui-monospace,Consolas,monospace;
 font-size:13px;margin:0;padding:12px}
h1{font-size:15px;font-weight:600;margin:0 0 10px;color:#4fc3f7}
pre{white-space:pre-wrap;word-break:break-word;line-height:1.5}
</style></head><body>
<h1>AgapSense — Live Diagnostic Log (production firmware)</h1>
<pre id="log">loading...</pre>
<script>
function tick(){
 fetch("/log/raw",{cache:"no-store"}).then(function(r){return r.text()})
 .then(function(t){
   var el=document.getElementById("log");
   var atBottom = (window.innerHeight + window.scrollY) >= document.body.offsetHeight - 40;
   el.textContent=t;
   if(atBottom) window.scrollTo(0, document.body.scrollHeight);
 });
}
tick();setInterval(tick,1000);
</script></body></html>
)rawliteral";

static void handleLogPage() {
    server.send_P(200, "text/html", LOG_HTML);
}

static void startServerAndOta() {
    ArduinoOTA.setHostname("agapsense-diag");
    ArduinoOTA.begin();
    MDNS.addService("http", "tcp", 80);
    server.on("/log", handleLogPage);
    server.on("/log/raw", handleLogRaw);
    server.begin();
    serverStarted = true;
    diagLogAdd("DIAG: HTTP log + OTA ready at http://%s/log", WiFi.localIP().toString().c_str());
}

// Polls Wi-Fi state rather than hooking connectivity.cpp's own state machine —
// keeps this file fully independent of (and safe to delete without touching)
// the production connectivity/alert code. Restarts the server/OTA listener
// whenever the IP changes (reconnect with a new DHCP lease), since a stale
// listener bound to the old IP won't necessarily keep working.
static void taskDiagServer(void* pv) {
    for (;;) {
        if (WiFi.status() == WL_CONNECTED) {
            IPAddress ip = WiFi.localIP();
            if (!serverStarted || ip != lastIp) {
                startServerAndOta();
                lastIp = ip;
            }
            server.handleClient();
            ArduinoOTA.handle();
        } else {
            serverStarted = false;
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

void diagServerInit() {
    xTaskCreatePinnedToCore(taskDiagServer, "DiagServer", 6144, nullptr, 1, nullptr, 0);
}

#else
void diagServerInit() {}
#endif

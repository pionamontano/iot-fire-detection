// ============================================================
// main.cpp — AgapSense IoT Fire Detection Node  (v2.0)
//
// Changes from v1.0:
//   + LED_YELLOW, LED_RED, LED_BLUE, BUZZER pin setup in setup()
//   + sensor_ready field initialised false in SensorData
//   + STACK_CONNECTIVITY bumped to 10240 (HTTPS POSTs + config fetch)
//   + taskConnectivity no longer gated on MQ-7 phase —
//     telemetry is now always posted (phase included in payload)
//   + Boot blink sequence on all LEDs for hardware verification
// ============================================================

#include <Arduino.h>
#include <esp_task_wdt.h>

#include "config.h"
#include "sensors.h"
#include "gps.h"
#include "connectivity.h"
#include "gsm.h"

#if DEBUG_MODE
  #define LOG(fmt, ...) Serial.printf("[MAIN] " fmt "\n", ##__VA_ARGS__)
#else
  #define LOG(fmt, ...)
#endif

// ── Shared State ───────────────────────────────────────────
static SensorData g_sensorData = {
    0.0f,   // co_ppm
    0.0f,   // temperature_c
    false,  // co_valid
    false,  // temp_valid
    false,  // sensor_ready  ← suppresses alerts during warm-up
    0,      // last_co_ms
    0       // last_temp_ms
};
static GpsFix          g_gpsFix   = {0.0, 0.0, 0.0f, 0, 99.9f, false, 0};
static ConnectivityCtx g_connCtx;

static SemaphoreHandle_t g_sensorMutex = nullptr;
static SemaphoreHandle_t g_gpsMutex    = nullptr;

static TaskHandle_t h_taskMQ7          = nullptr;
static TaskHandle_t h_taskDS18B20      = nullptr;
static TaskHandle_t h_taskGPS          = nullptr;
static TaskHandle_t h_taskConnectivity = nullptr;
static TaskHandle_t h_taskGSM          = nullptr;

// ============================================================
// Task 1: MQ-7 Voltage Cycling + ADC reads (Core 1)
// ============================================================
static void taskMQ7(void* pvParams) {
    LOG("taskMQ7 started on core %d", xPortGetCoreID());
    esp_task_wdt_add(nullptr);
    mq7Init();
    for (;;) {
        esp_task_wdt_reset();
        mq7Update(&g_sensorData, g_sensorMutex);
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}

// ============================================================
// Task 2: DS18B20 Temperature reads every 5 s (Core 1)
// ============================================================
static void taskDS18B20(void* pvParams) {
    LOG("taskDS18B20 started on core %d", xPortGetCoreID());
    esp_task_wdt_add(nullptr);
    ds18b20Init();
    for (;;) {
        esp_task_wdt_reset();
        ds18b20Read(&g_sensorData, g_sensorMutex);
        vTaskDelay(pdMS_TO_TICKS(DS18B20_READ_INTERVAL_MS));
    }
}

// ============================================================
// Task 3: NEO-6M GPS continuous parsing (Core 1)
// ============================================================
static void taskGPS(void* pvParams) {
    LOG("taskGPS started on core %d", xPortGetCoreID());
    esp_task_wdt_add(nullptr);
    gpsInit();
    for (;;) {
        esp_task_wdt_reset();
        gpsUpdate(&g_gpsFix, g_gpsMutex);
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}

// ============================================================
// Task 4: Connectivity management + HTTPS + alert FSM (Core 0)
//
// Runs every 2 s. Telemetry is now posted regardless of MQ-7 phase
// (the mq7_phase field in the payload tells the backend which phase
// is active, so it can suppress alert evaluation on heating readings).
// ============================================================
static void taskConnectivity(void* pvParams) {
    LOG("taskConnectivity started on core %d", xPortGetCoreID());
    esp_task_wdt_add(nullptr);

    // Wait for sensors to initialise before network activity
    vTaskDelay(pdMS_TO_TICKS(5000));

    connectivityInit(&g_connCtx);

    for (;;) {
        esp_task_wdt_reset();
        connectivityUpdate(&g_connCtx,
                           &g_sensorData, g_sensorMutex,
                           &g_gpsFix,     g_gpsMutex);
        vTaskDelay(pdMS_TO_TICKS(2000));
    }
}

// ============================================================
// Task 5: SIM800L SMS queue processor (Core 0)
// ============================================================
static void taskGSM(void* pvParams) {
    LOG("taskGSM started on core %d", xPortGetCoreID());
    esp_task_wdt_add(nullptr);
    gsmInit();
    for (;;) {
        esp_task_wdt_reset();
        gsmProcessQueue();
        vTaskDelay(pdMS_TO_TICKS(5000));
    }
}

// ============================================================
// setup()
// ============================================================
void setup() {
#if DEBUG_MODE
    Serial.begin(DEBUG_BAUD);
    delay(500);
    Serial.println("\n============================================================");
    Serial.println("  Bantay Apoy — IoT Fire Detection Node  v2.0");
    Serial.println("============================================================");
#endif

    // ── Hardware WDT ───────────────────────────────────────
    esp_task_wdt_init(WDT_TIMEOUT_S, true);
    esp_task_wdt_add(nullptr);   // subscribe setup/loop task
    LOG("WDT configured: %d s", WDT_TIMEOUT_S);

    // ── ADC ────────────────────────────────────────────────
    analogSetAttenuation(ADC_11db);
    analogReadResolution(12);

    // ── Indicator GPIO init ────────────────────────────────
    // Pins configured here so they light up during WiFiManager portal
    // (connectivityInit() also calls pinMode — safe to call twice)
    pinMode(LED_YELLOW_PIN, OUTPUT);
    pinMode(LED_RED_PIN,    OUTPUT);
    pinMode(LED_BLUE_PIN,   OUTPUT);
    pinMode(BUZZER_PIN,     OUTPUT);
    // Boot blink sequence: confirm all indicators are wired correctly
    // Yellow → Red → Blue → Buzzer short beep → all off
    digitalWrite(LED_YELLOW_PIN, HIGH); delay(200);
    digitalWrite(LED_YELLOW_PIN, LOW);
    digitalWrite(LED_RED_PIN,    HIGH); delay(200);
    digitalWrite(LED_RED_PIN,    LOW);
    digitalWrite(LED_BLUE_PIN,   HIGH); delay(200);
    digitalWrite(LED_BLUE_PIN,   LOW);
    digitalWrite(BUZZER_PIN,     HIGH); delay(100);
    digitalWrite(BUZZER_PIN,     LOW);
    LOG("Boot indicator blink complete");

    // ── Mutexes ────────────────────────────────────────────
    g_sensorMutex = xSemaphoreCreateMutex();
    g_gpsMutex    = xSemaphoreCreateMutex();
    if (!g_sensorMutex || !g_gpsMutex) {
        LOG("FATAL: mutex creation failed — halting");
        while (true) delay(1000);
    }
    LOG("Mutexes created OK");

    // ── FreeRTOS Tasks ─────────────────────────────────────
    // Core 1: sensor sampling + GPS (real-time I/O, latency-sensitive)
    // Core 0: Wi-Fi stack + connectivity + GSM (protocol-heavy)
    BaseType_t rc;

    rc = xTaskCreatePinnedToCore(taskMQ7, "MQ7",
         STACK_MQ7, nullptr, PRIO_MQ7, &h_taskMQ7, 1);
    configASSERT(rc == pdPASS);

    rc = xTaskCreatePinnedToCore(taskDS18B20, "DS18B20",
         STACK_DS18B20, nullptr, PRIO_DS18B20, &h_taskDS18B20, 1);
    configASSERT(rc == pdPASS);

    rc = xTaskCreatePinnedToCore(taskGPS, "GPS",
         STACK_GPS, nullptr, PRIO_GPS, &h_taskGPS, 1);
    configASSERT(rc == pdPASS);

    rc = xTaskCreatePinnedToCore(taskConnectivity, "Connectivity",
         STACK_CONNECTIVITY, nullptr, PRIO_CONNECTIVITY,
         &h_taskConnectivity, 0);
    configASSERT(rc == pdPASS);

    rc = xTaskCreatePinnedToCore(taskGSM, "GSM",
         STACK_GSM, nullptr, PRIO_GSM, &h_taskGSM, 0);
    configASSERT(rc == pdPASS);

    LOG("All tasks created — entering FreeRTOS scheduler");
    esp_task_wdt_delete(nullptr);   // unsubscribe setup task from WDT
}

// ============================================================
// loop() — unused; all logic is in FreeRTOS tasks
// ============================================================
void loop() {
    vTaskDelay(pdMS_TO_TICKS(10000));
}

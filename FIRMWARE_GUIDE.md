# AgapSense — Firmware Guide

This document covers the ESP32 firmware that runs on each AgapSense fire-detection
node (`firmware/agapsense-firmware/`). It explains the hardware it drives, how the
code is organized, how the alert logic works, and how to configure, build, and
flash it.

---

## 1. Hardware Overview

| Component | Role | Interface |
|---|---|---|
| ESP32 DevKit V1 | Main controller (dual-core, Wi-Fi) | — |
| MQ-7 | Carbon monoxide (CO) sensor | ADC1 + PWM-driven heater |
| DS18B20 | Ambient temperature sensor | OneWire |
| NEO-6M | GPS module | UART (`Serial2`) |
| SIM800L | GSM/SMS fallback modem | UART (`Serial1`) |
| Yellow / Red / Blue LEDs + active buzzer | Local indicators | GPIO |

### Pin Map (`src/config.example.h`)

| Signal | Pin | Notes |
|---|---|---|
| MQ7 analog out | GPIO 34 | ADC1_CH6, input-only |
| MQ7 heater PWM | GPIO 25 | Drives heater via BJT/MOSFET |
| DS18B20 data | GPIO 4 | Needs a 4.7 kΩ pull-up |
| GPS RX / TX | GPIO 16 / 17 | `Serial2`, 9600 baud |
| GSM RX / TX | GPIO 26 / 27 | `Serial1`, 9600 baud, dedicated 4.0 V rail + 1000 µF cap |
| Battery divider | GPIO 35 | ADC1_CH7, input-only, R1=R2 (ratio 2.0) |
| LED Yellow / Red / Blue | GPIO 14 / 12 / 13 | Tier 1 / Tier 2 / Wi-Fi status |
| Buzzer | GPIO 32 | Active buzzer module, HIGH = on |

All sensor/ADC pins are on **ADC1** deliberately — ADC2 pins conflict with the Wi-Fi
radio on the ESP32 and cannot be used while Wi-Fi is active.

---

## 2. Project Layout

```
firmware/agapsense-firmware/
├── platformio.ini        PlatformIO env, board, libraries, build flags
└── src/
    ├── config.example.h  Template — copy to config.h and fill in secrets
    ├── main.cpp           setup()/loop(), FreeRTOS task creation
    ├── sensors.h/.cpp      MQ-7 heat/measure cycle + DS18B20 reads
    ├── gps.h/.cpp          NEO-6M parsing via TinyGPS++
    ├── connectivity.h/.cpp Wi-Fi, HTTPS to Supabase, alert FSM, LEDs
    └── gsm.h/.cpp          SIM800L AT commands, async SMS queue
```

`config.h` is **not** committed (see `.gitignore`) because it holds the Supabase
anon key, device API key, and CA certificate. Copy the example before building:

```bash
cd firmware/agapsense-firmware/src
cp config.example.h config.h
```

Then edit `config.h`:
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DEVICE_API_KEY` — from your Supabase
  project and the device row created in the admin dashboard (Devices page).
- `DEVICE_ID` — must match the device's ID in the `devices` table.
- `OWNER_SMS_NUMBER_DEFAULT` / `BFP_SMS_NUMBER_DEFAULT` — fallback numbers used
  only until `fetchRemoteConfig()` pulls the real ones from the DB.
- `SUPABASE_ROOT_CA` — the USERTrust root cert bundled in the example is what
  Supabase's edge network currently uses; replace it only if Supabase changes
  their certificate chain and TLS handshakes start failing.

---

## 3. Firmware Architecture (FreeRTOS)

`main.cpp` creates five pinned FreeRTOS tasks instead of using the Arduino
`loop()` — `loop()` just idles. Each task is watchdog-registered
(`esp_task_wdt`) with a 30 s timeout.

| Task | Core | Priority | Period | Responsibility |
|---|---|---|---|---|
| `taskMQ7` | 1 | 2 | 500 ms tick (ADC read throttled to 5 s) | MQ-7 heat/measure cycling + CO ppm |
| `taskDS18B20` | 1 | 2 | 5 s | Blocking 12-bit temperature read (~750 ms) |
| `taskGPS` | 1 | 3 | 20 ms | Continuous NMEA parsing |
| `taskConnectivity` | 0 | 3 | 2 s | Wi-Fi health, alert FSM, HTTPS POSTs, LEDs |
| `taskGSM` | 0 | 2 | 5 s | Drains the SMS queue, one blocking send per tick |

**Core split rationale:** Core 1 handles latency-sensitive, real-time I/O
(sensor sampling, GPS). Core 0 handles the protocol-heavy work (Wi-Fi stack,
HTTPS, GSM AT commands), which can block for seconds at a time.

Shared state (`SensorData`, `GpsFix`) is protected by two FreeRTOS mutexes
(`g_sensorMutex`, `g_gpsMutex`) with short timeouts (50–100 ms) on every
take/give — a stalled task never permanently blocks the others.

On boot, `setup()`:
1. Initializes the hardware watchdog and subscribes the setup task.
2. Configures ADC attenuation (11 dB) and resolution (12-bit).
3. Runs a boot blink sequence (Yellow → Red → Blue → buzzer beep) to visually
   confirm all four indicators are wired correctly.
4. Creates the mutexes and five tasks, then unsubscribes from the WDT (each
   task self-registers instead).

---

## 4. Sensor Logic

### 4.1 MQ-7 (CO) — Heat/Measure Cycle

The MQ-7 datasheet requires alternating heater voltages to get a stable
reading, so `mq7Update()` runs a two-phase state machine:

1. **HEATING** (`MQ7_HEAT_DURATION_MS` = 60 s) — heater PWM at full duty
   (255/255 ≈ 5 V). No ADC reads; the sensor output is chemically unstable
   during this phase.
2. **MEASURING** (`MQ7_MEAS_DURATION_MS` = 90 s) — heater PWM drops to
   `MQ7_LOW_DUTY` (72/255 ≈ 1.4 V). ADC is sampled every
   `MQ7_READ_INTERVAL_MS` (5 s) as a 32-sample average to reduce ESP32 ADC
   noise, then converted to ppm.

Conversion (`mq7RawToPpm`) uses the standard Rs/R0 curve-fit from the MQ-7
datasheet:

```
Vout = rawAdc * Vc / 4095        (Vc = 1.4 V during MEASURING)
Rs   = RL * (Vc - Vout) / Vout
ppm  = 100 * (Rs / R0) ^ -1.513
```

`MQ7_R0_OHMS` must be calibrated per physical sensor: power the module in
clean air, let it complete a few heat/measure cycles, measure the resulting
Rs, and set `R0 = Rs`. Re-flash to apply.

`sensor_ready` (in `SensorData`) only flips `true` after the **first
complete** heat+measure cycle (~150 s after boot). The alert FSM in
`connectivity.cpp` is fully suppressed until then, so a cold, unstable sensor
can never fire a false alert on boot.

### 4.2 DS18B20 (Temperature)

Straightforward OneWire read at 12-bit resolution (0.0625 °C, ~750 ms
conversion time) every `DS18B20_READ_INTERVAL_MS` (5 s). `DEVICE_DISCONNECTED_C`
(-127) or any reading outside [-55, 125] °C is treated as a failed read — the
last valid value is kept rather than overwritten.

### 4.3 GPS (NEO-6M)

`TinyGPS++` parses NMEA sentences fed byte-by-byte from `Serial2`. When a
fresh, valid fix arrives it's copied into the shared `GpsFix`. When no fresh
fix is available, the **last known fix is republished with `valid = false`**
so the backend can tell the difference between "live GPS" and "stale cached
coordinates" in telemetry/alert payloads.

---

## 5. Connectivity & Alert State Machine

### 5.1 Wi-Fi Provisioning

`connectivityInit()` uses **WiFiManager** for zero-touch provisioning:
- Tries saved NVS credentials first.
- If that fails, it opens a captive-portal AP (`WIFI_AP_NAME` =
  `AgapSense-Setup`, open/no password) for up to 180 s so the installer can
  connect a phone and enter the site's Wi-Fi credentials.

### 5.2 Device State

`DeviceState` has three values, and drives the blue LED:

| State | Blue LED | Meaning |
|---|---|---|
| `ONLINE` | Solid | Wi-Fi connected **and** Supabase TCP probe (port 443) succeeded |
| `DEGRADED` | Blinking (500 ms) | Wi-Fi connected but Supabase unreachable |
| `OFFLINE` | Off | No Wi-Fi; retries every `WIFI_RECONNECT_INTERVAL_S` (60 s) |

### 5.3 Two-Tier Alert FSM

Thresholds (`co_alert_ppm`, `temp_alert_c`) default to `CO_ALERT_PPM_DEFAULT`
(200 ppm) / `TEMP_ALERT_PPM_DEFAULT` (70 °C) but are overridden at runtime by
`fetchRemoteConfig()` on boot and every `CONFIG_FETCH_INTERVAL_MS` (10 min),
so thresholds can be retuned from the admin dashboard without reflashing.

| Tier | Condition | Indicators | Backend / SMS |
|---|---|---|---|
| **CLEAR** | Neither sensor over threshold | All off | — |
| **TIER 1** | Exactly one sensor over threshold | Yellow LED | `trigger-alert` POST (tier=1) only — backend sends a Telegram warning, **no SMS** |
| **TIER 2** | Both sensors over threshold simultaneously | Red LED + buzzer | `trigger-alert` POST (tier=2) + owner SMS + BFP SMS — backend sends Telegram alert |

State transitions are debounced to avoid flapping on noisy readings:
- **Rising** into TIER1/TIER2 requires `ALERT_DEBOUNCE_COUNT` (3) consecutive
  over-threshold readings.
- **Falling** back to CLEAR (or de-escalating TIER2 → TIER1) requires
  `ALERT_RESOLUTION_COUNT` (2) consecutive safe readings.
- The FSM is entirely suppressed while `sensor_ready == false` (MQ-7 warm-up).

Every Tier 2 SMS send is debounced by `SMS_DEBOUNCE_MS` (5 minutes) so a
sustained fire doesn't spam the owner/BFP with a text every FSM tick.

### 5.4 HTTPS to Supabase Edge Functions

All requests go over `WiFiClientSecure` pinned to the CA cert in
`SUPABASE_ROOT_CA` (no `setInsecure()`), with `Authorization: Bearer
<anon key>` and `X-Device-Key: <device api key>` headers.

| Endpoint | Called from | Purpose |
|---|---|---|
| `ENDPOINT_INGEST` (`/functions/v1/ingest-reading`) | `postTelemetry()` — every `TELEMETRY_INTERVAL_MS` (30 s), regardless of MQ-7 phase | Routine CO/temp/GPS/battery/RSSI telemetry |
| `ENDPOINT_ALERT` (`/functions/v1/trigger-alert`) | `postAlert()` — on Tier 1 or Tier 2 entry | Logs the alert event; backend resolves address, dispatches Telegram, returns `alert_event_id` + `owner_contact`/`bfp_contact` |
| `ENDPOINT_GET_CONFIG` (`/functions/v1/get-device-config`) | `fetchRemoteConfig()` — boot + every 10 min | Pulls current thresholds and SMS numbers |
| `ENDPOINT_CONFIRM_SMS` (`/functions/v1/confirm-sms-status`) | `postSmsStatus()` — draining the GSM result queue every tick | Reports real `+CMGS` delivery success/failure back to the originating `alert_events` row |

The `alert_event_id` returned by `trigger-alert` is threaded through to the
queued SMS jobs and back to `confirm-sms-status`, so a delivery result always
updates the exact incident row — never a guess based on recency.

Telemetry is posted unconditionally every 30 s (not gated on MQ-7 phase); the
payload's `mq7_phase` field tells the backend whether the reading is a
"measuring" sample or a "heating" placeholder, so it can decide whether to run
alert evaluation server-side too.

---

## 6. GSM / SMS Fallback (SIM800L)

SMS exists as a fallback channel for Tier 2 alerts (Telegram is the primary
channel and is sent server-side by `trigger-alert`, never from firmware).

- `gsmInit()` auto-bauds against the module, disables AT echo, sets text-mode
  SMS (`AT+CMGF=1`), and waits up to 30 s for network registration
  (`AT+CREG?` → `,1` home or `,5` roaming).
- `gsmSendOwnerSms()` / `gsmSendBfpSms()` **compose and enqueue** messages —
  they never block the caller (`taskConnectivity`). Actual sending happens in
  `taskGSM`, one blocking `AT+CMGS` per 5 s tick, so a slow modem never starves
  the connectivity task's watchdog reset.
- The SMS queue and the result queue are each fixed `SMS_QUEUE_SIZE` (2)
  ring buffers — sized so a Tier 2 event's owner + BFP messages both fit
  without either being dropped.
- Message composition deliberately puts the Google Maps link **before** the
  reverse-geocoded address in both message bodies: SIM800L text-mode SMS has
  no concatenated-SMS (multipart) support, so if the ~160-char GSM-7
  single-segment limit truncates the message, only the address's tail is
  lost — the link always survives intact.
- Owner messages are plain-language (Filipino) evacuation instructions; BFP
  messages are technical (device ID, server timestamp, readings, coordinates).

---

## 7. Build & Flash (PlatformIO)

**Target:** ESP32 DevKit V1 (`espressif32` platform, `esp32dev` board,
Arduino framework). Build config lives in `platformio.ini`.

```bash
# From firmware/agapsense-firmware/
cp src/config.example.h src/config.h   # then fill in real values

pio run                 # build
pio run -t upload       # flash (uses upload_port/upload_speed from platformio.ini)
pio device monitor      # serial monitor at 115200 baud
```

- `upload_port` defaults to `/dev/ttyUSB0` — change it to your OS's port
  (e.g. `COM3` on Windows, `/dev/cu.usbserial-XXXX` on macOS) in
  `platformio.ini`, or override on the command line:
  `pio run -t upload --upload-port COM3`.
- To see `[MAIN]`/`[SENSOR]`/`[CONN]`/`[GPS]`/`[GSM]` debug logs over serial,
  uncomment `-DDEBUG_MODE=1` in `platformio.ini`'s `build_flags` and reflash.
  Leave it at `0` (default) for production — it disables all `Serial.printf`
  logging calls at compile time.
- Library dependencies (`OneWire`, `DallasTemperature`, `TinyGPSPlus`,
  `WiFiManager`, `ArduinoJson`) are pinned in `lib_deps` and fetched
  automatically by PlatformIO on first build.

### First Boot Checklist

1. Flash the firmware, then power the board — the boot blink sequence
   (Yellow → Red → Blue → buzzer) confirms all indicators are wired.
2. Connect to the `AgapSense-Setup` open Wi-Fi AP with a phone/laptop; the
   captive portal lets you select the site's Wi-Fi network and enter its
   password.
3. Once connected, the blue LED goes solid (ONLINE) and the device fetches
   its remote config (thresholds + SMS numbers) from Supabase.
4. Allow ~150 s for the MQ-7's first full heat/measure cycle before expecting
   alert evaluation — `sensor_ready` gates it.
5. Watch the admin Devices page (or serial monitor with `DEBUG_MODE=1`) to
   confirm telemetry is arriving every 30 s.

---

## 8. Troubleshooting

| Symptom | Likely Cause |
|---|---|
| Blue LED never goes solid | Wi-Fi credentials wrong/expired, or Supabase host unreachable (check `SUPABASE_URL` and firewall) |
| CO readings pinned at 0 or implausible | MQ-7 not calibrated (`MQ7_R0_OHMS`) in clean air, or ADC wiring on GPIO 34 |
| Temperature always last-known / never updates | DS18B20 missing 4.7 kΩ pull-up, or wrong `DS18B20_PIN` |
| GPS `valid` always false | No sky view / cold-start fix can take minutes outdoors; check `GPS_RX_PIN`/`GPS_TX_PIN` wiring |
| SMS never sent, `gsmIsRegistered()` false | SIM800L needs a dedicated ~2 A-capable 4.0 V supply with a large (1000 µF+) cap — brownouts during transmit are the most common failure |
| Alerts never fire despite high readings | Check `sensor_ready` (150 s warm-up) and confirm 3 consecutive readings are required (`ALERT_DEBOUNCE_COUNT`) |
| TLS handshake failures on all HTTPS calls | Supabase's certificate chain changed — update `SUPABASE_ROOT_CA` in `config.h` |

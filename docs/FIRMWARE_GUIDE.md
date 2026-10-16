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
├── platformio.ini          PlatformIO envs (see 7), board, libraries, build flags
├── host_tests/             Logic tests that run on a PC with g++ (see its README)
└── src/
    ├── config.example.h    Template — copy to config.h and fill in secrets; firmware version history
    ├── main.cpp            setup()/loop(), FreeRTOS task creation
    ├── sensors.h/.cpp      MQ-7 (duty-cycle or constant-5V variant, see 4.1) + DS18B20 reads
    ├── gps.h/.cpp          NEO-6M parsing via TinyGPS++
    ├── connectivity.h/.cpp Wi-Fi, HTTPS to Supabase, alert FSM, LEDs, setup portal, OTA
    ├── identity.h/.cpp     Per-node device ID + API key in NVS (set via the setup portal)
    ├── gsm.h/.cpp          SIM800L AT commands, async SMS queue
    ├── alert_retry.h       Retry/backoff policy for the alert POST (host-tested)
    ├── sms_result_hold.h   Late-binding of SMS results to the right incident (host-tested)
    ├── diag_log.h/.cpp     Log ring buffer, only in the diag build (ENABLE_DIAG_SERVER)
    ├── diag_server.h/.cpp  /log web viewer + ArduinoOTA, only in the diag build
    ├── test_components.cpp Separate bench-test sketch (env:test_components), not linked into the firmware
    └── config_test_secrets.example.h  Template for the bench sketch's secrets
```

`config.h` is **not** committed (see `.gitignore`) because it holds the Supabase
anon key and CA certificate (the per-device ID and API key are *not* in it; see 5.1). Copy the example before building:

```bash
cd firmware/agapsense-firmware/src
cp config.example.h config.h
```

Then edit `config.h`:
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — from your Supabase project.
- `WIFI_AP_PASSWORD` — password of the setup portal (WPA2, at least 8 characters). Change
  the default; the portal receives each node's API key.
- `OWNER_SMS_NUMBER_DEFAULT` / `BFP_SMS_NUMBER_DEFAULT` — fallback numbers used
  only until `fetchRemoteConfig()` pulls the real ones from the DB.
- There is **no** `DEVICE_ID` / `DEVICE_API_KEY` in `config.h` any more. Each node's ID
  and API key (from the device row in the admin Devices page) are entered once in the setup
  portal and stored in the node's flash (NVS). See 5.1.
- `SUPABASE_ROOT_CA` — the example bundles the **GTS Root R4** cert (Google
  Trust Services, cross-signed by GlobalSign, valid until 2028-01-28), which
  is the root of the chain Supabase currently serves
  (`supabase.co` → `WE1` → `GTS Root R4`). Paste **only that one certificate**
  (not the leaf or the `WE1` intermediate — those rotate). If TLS handshakes
  start failing, re-extract it (see below).

---

## 3. Firmware Architecture (FreeRTOS)

`main.cpp` creates five pinned FreeRTOS tasks for the real work. The Arduino
`loop()` only watches Wi-Fi: after 30 s disconnected it opens the setup portal
again (180 s timeout, then a restart). Each task is watchdog-registered
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
   task self-registers instead). The diag build (`ENABLE_DIAG_SERVER`) also
   starts the `/log` web server first.

---

## 4. Sensor Logic

### 4.1 MQ-7 (CO)

There are two builds of the MQ-7 code, chosen by the PlatformIO environment (see 7):

| Build | Env | Heater | Reads | `sensor_ready` after |
|---|---|---|---|---|
| **Constant 5V** (`MQ7_CONTINUOUS_5V`) | `esp32dev_mq7_5v` (v2.2.0) | Sensor on a fixed 5 V rail; `MQ7_HEATER_PIN` is not wired to it | Every 5 s, always "measuring", converted with Vc = 5 V | 60 s warm-up |
| **Duty cycle** (default) | `esp32dev` | PWM through a transistor, 60 s at 5 V / 90 s at 1.4 V | Only during the 90 s measuring phase | First full cycle, ~150 s |

According to `platformio.ini`, every deployed node so far is wired for the **constant-5V** build;
the duty-cycle build is kept as the default/fallback. Flash the build that matches the wiring:
the conversion formula assumes the matching supply voltage, so the wrong build gives wrong ppm.
The rest of this section describes the duty-cycle build.

#### Duty-cycle build: heat/measure cycle

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
complete** heat+measure cycle (~150 s after boot; 60 s in the constant-5V build). The alert FSM in
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
  `AgapSense-Setup`, protected with `WIFI_AP_PASSWORD`) for up to 180 s so the installer can
  connect a phone and enter the site's Wi-Fi credentials.

**Device identity.** The portal also has two fields, *Device ID* (e.g. `AGS-001`; letters,
digits, `.`, `_`, `-`, up to 39 chars) and *Device API key* (`sk_...` from the admin Devices
page, up to 64 chars). Both are validated and stored in NVS (`identity.cpp`), so one firmware
image, including an OTA image, runs on every node, and an update never touches them.
- **Identity already stored:** normal boot. The fields appear pre-filled if the portal opens
  (e.g. Wi-Fi lost), so they can be corrected.
- **Identity missing** (new node, or erased flash): the portal is forced open even if Wi-Fi
  credentials are saved. After the fields are saved the node waits for Wi-Fi (up to 30 s) and
  reboots. If nobody provisions it within `IDENTITY_PORTAL_TIMEOUT_S` (10 min) it runs offline:
  LEDs and buzzer still work, nothing is posted, and the blue LED stays off. Power-cycle to retry.
- **Re-provisioning** a node: `pio run -t erase` (clears Wi-Fi and identity) and start over.
- Identity is only editable at boot. The reconnect portal that `loop()` opens after 30 s without
  Wi-Fi has no identity fields, so a running node's identity can never change under its tasks.

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
| **TIER 1** | Exactly one sensor over threshold | Yellow LED | `trigger-alert` POST (tier=1) only — backend notifies **admins** (push + their linked Telegram), **no SMS** |
| **TIER 2** | Both sensors over threshold simultaneously | Red LED + buzzer | `trigger-alert` POST (tier=2) + owner SMS + BFP SMS — backend sends the station Telegram, linked Telegram chats and push |

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

Telemetry is posted unconditionally every 30 s (not gated on MQ-7 phase). The
payload carries `mq7_phase`, `battery_mv` and `rssi`, but `ingest-reading` does
not store them; it keeps CO, temperature, coordinates, `gps_valid`,
`on_battery`, `sensor_ready` and the reported firmware version.

---

## 6. GSM / SMS Fallback (SIM800L)

SMS is a second, **parallel** channel for Tier 2 alerts: the two SMS are queued as
soon as the node enters Tier 2, whether or not Wi-Fi is up. It is not a fallback
that waits for Wi-Fi to fail. Telegram and push are sent server-side by
`trigger-alert`, never from firmware. An SMS with no number configured (e.g. the
admin cleared the BFP contact) is skipped.

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

**Target:** ESP32 DevKit V1 (`espressif32 @ ~6.9.0` platform, `esp32dev` board,
Arduino framework). Build config lives in `platformio.ini`, which defines several
environments:

| Env | What it builds | `FIRMWARE_VERSION` from |
|---|---|---|
| `esp32dev` | Production firmware, duty-cycle MQ-7 | `config.h` |
| `esp32dev_mq7_5v` | Production firmware, constant-5V MQ-7 (current hardware) | `platformio.ini` (`2.2.0`) |
| `esp32dev_mq7_5v_diag` | As above plus an unauthenticated `/log` web viewer and ArduinoOTA. Bench debugging only | `platformio.ini` (`2.2.0-diag`) |
| `*_ota` variants | Same build, flashed over Wi-Fi with `espota` (`--upload-port <device-ip>`) | as their base env |
| `test_components` (+ `_ota`) | Separate bench-test sketch; needs `src/config_test_secrets.h` | — |

There is no `default_envs`, so **always pass `-e`**: a bare `pio run` builds every
environment, and `test_components` fails without its secrets file.

```bash
# From firmware/agapsense-firmware/
cp src/config.example.h src/config.h   # then fill in real values

pio run -e esp32dev_mq7_5v                # build
pio run -e esp32dev_mq7_5v -t upload      # flash over USB
pio device monitor                        # serial monitor at 115200 baud
```

- `upload_port` is set to `COM4` in `platformio.ini` — change it to your port
  (e.g. `COM3` on Windows, `/dev/ttyUSB0` on Linux, `/dev/cu.usbserial-XXXX` on macOS)
  or override on the command line: `--upload-port COM3`.
- To see `[MAIN]`/`[SENSOR]`/`[CONN]`/`[GPS]`/`[GSM]` debug logs over serial,
  uncomment `-DDEBUG_MODE=1` in `platformio.ini`'s `build_flags` and reflash.
  Leave it at `0` (default) for production — it disables all logging calls at compile time.
  Logs go to the USB serial port (115200 baud). For logs without a cable, use the
  `esp32dev_mq7_5v_diag` build and open `http://<device-ip>/log`; switch back to a
  production build when done.
- Library dependencies (`OneWire`, `DallasTemperature`, `TinyGPSPlus`,
  `WiFiManager`, `ArduinoJson`) are pinned in `lib_deps` and fetched
  automatically by PlatformIO on first build.

> Before installing a node or pushing an OTA update, run the full test list in
> [`HARDWARE_BENCH_TEST.md`](HARDWARE_BENCH_TEST.md).

### First Boot Checklist

1. Flash the firmware, then power the board — the boot blink sequence
   (Yellow → Red → Blue → buzzer) confirms all indicators are wired.
2. Connect to the `AgapSense-Setup` Wi-Fi AP (password = `WIFI_AP_PASSWORD`) with a
   phone/laptop; the captive portal lets you select the site's Wi-Fi network and
   enter its password, plus the node's **Device ID** and **Device API key**
   (copy them from the admin Devices page). The node reboots once after saving.
3. Once connected, the blue LED goes solid (ONLINE) and the device fetches
   its remote config (thresholds + SMS numbers) from Supabase.
4. Allow the MQ-7 warm-up (60 s on the constant-5V build, ~150 s on the duty-cycle build)
   before expecting alert evaluation — `sensor_ready` gates it.
5. Watch the admin Devices page (or serial monitor with `DEBUG_MODE=1`) to
   confirm telemetry is arriving every 30 s.

---

## 8. OTA Firmware Updates (over Wi-Fi)

Nodes can update themselves without a USB cable. The download uses HTTPS (not plain
HTTP) and is validated against the same `SUPABASE_ROOT_CA` as every other request, so
the `.bin` must be served from the Supabase domain.

### 8.1 How it works

1. At boot and then every `CONFIG_FETCH_INTERVAL_MS` (10 min), the node calls
   `get-device-config`, which returns `firmware_version`, `firmware_url` and
   `firmware_md5` for that device.
2. If `firmware_version` and `firmware_url` are set and the version **differs** from the
   compiled-in `FIRMWARE_VERSION`, the node downloads the image. This only starts while
   the alert tier is `CLEAR`.
3. The image is streamed into the inactive app slot with `Update.h`. If a sensor reading
   crosses an alert threshold mid-download, the OTA is aborted so the alert FSM can run.
   The download is also aborted if the stream stalls for `HTTP_TIMEOUT_MS`.
4. `Update.end()` verifies the MD5 (when provided), then the node reboots into the new image.
5. The next telemetry POST carries `firmware_version`, so the admin Devices page shows
   what the node is really running rather than what was requested.

OTA is Wi-Fi only; it is never attempted over the SIM800L.

### 8.2 Releasing an update

1. **Bump the version** where your env takes it from (see the table in 7): `src/config.h`
   for `esp32dev`, the `-D FIRMWARE_VERSION` build flag in `platformio.ini` for the
   `esp32dev_mq7_5v*` envs. The node updates only when this differs from the target
   version, so every release needs a new string.
2. **Build the env that matches the nodes' wiring:** `pio run -e <env>`. The file to publish is
   `.pio/build/<env>/firmware.bin` (not `bootloader.bin` or `partitions.bin`).
3. **Checksum:** `md5sum .pio/build/<env>/firmware.bin` (32 hex characters).
4. **Upload** `firmware.bin` to a Supabase Storage bucket and copy its public (or signed)
   `https://<project-ref>.supabase.co/storage/v1/...` URL.
5. **Publish in the admin Devices page:**
   - Add a firmware release (version, URL, MD5). This feeds the fleet-wide "latest" record.
   - Set the target on **one test device** first (edit device -> firmware version, URL, MD5).
   - Once that device reports the new version, use the push-to-all action to roll it out
     to every active device. Nodes pick it up on their next config sync (within 10 minutes).

To opt a device out of OTA, leave its `firmware_version` and `firmware_url` empty.

### 8.2a Automated build and upload (GitHub Actions)

`.github/workflows/firmware-release.yml` performs steps 1-4 above. Push a tag such as
`firmware-v2.2.1`, or run the workflow manually and enter `2.2.1`. It:

1. builds **one** env: `esp32dev_mq7_5v` (the constant-5V wiring of every deployed node) for a
   tag, or the env you pick on a manual run (`esp32dev_mq7_5v` or `esp32dev`);
2. runs the host tests;
3. generates `config.h` from `config.example.h` with the tag's version, and also writes that
   version into the env's `-D FIRMWARE_VERSION` flag in its own checkout of `platformio.ini`
   (the 5V envs set the version there, which overrides `config.h`);
4. builds with `pio run -e <env>` and fails if the image does not contain the version string;
5. uploads `agapsense-<version>-<env>.bin` to Supabase Storage, checks that the public URL
   serves identical bytes, and prints the version, env, URL and MD5 in the run summary.

It never overwrites an existing object and never rolls anything out; you still add the release
and push it from the admin Devices page. Only target nodes whose wiring matches the env shown
in the summary.

The committed `platformio.ini` is not changed by a release; bump its version by hand if you
also build locally.

One-time setup:
- Create a **public** Storage bucket named `firmware` (or set the repo variable `FIRMWARE_BUCKET`).
- Add repository secrets: `FIRMWARE_SUPABASE_URL`, `FIRMWARE_SUPABASE_ANON_KEY`,
  `FIRMWARE_SUPABASE_SERVICE_ROLE_KEY` (upload only; never compiled in). No per-device
  secrets are needed: the image is identical for every node.

> **Device identity is per node, not in the image** (see 8.6), so one release can be pushed to any
> number of nodes. Nodes flashed with firmware older than this change still have identity compiled in
> and must be re-flashed once over USB (then provisioned in the portal) before they can take a shared image.

### 8.3 Rules and cautions

- **First flash is always by USB.** OTA only works on firmware that already contains it.
- **Always set the MD5.** HTTPS proves the bytes came from Supabase, not that they are the
  build you intended; with an empty MD5 the check is skipped.
- **Keep an OTA-capable partition scheme.** The default scheme has two app slots; a
  "no OTA" scheme makes `Update.begin()` fail.
- **A bad image cannot be fixed remotely** if it boots but never reaches Wi-Fi. Always
  test on one device before a fleet push.
- **Keep Wi-Fi credentials and `config.h` secrets compatible** between versions; OTA
  replaces the app image only, so saved Wi-Fi credentials in NVS survive.
- **Not covered by the host tests.** The OTA path compiles in the simulation but is never
  executed there; verify it on hardware.

### 8.4 If an update does not apply

Enable `-DDEBUG_MODE=1` and watch the serial monitor for `OTA:` lines:

| Log line | Meaning |
|---|---|
| `OTA: fetch failed (code=... len=...)` | URL wrong or not public, or the response has no `Content-Length` |
| `OTA: Update.begin failed` | Image too large for the slot, or no OTA partition |
| `OTA: setMD5 rejected` | `firmware_md5` is not valid hex |
| `OTA: aborting - sensor reading crossed alert threshold` | Expected; retried on a later config sync |
| `OTA: stream stalled` | Network dropped mid-download |
| `OTA: Update.end failed` | MD5 mismatch or corrupt image |

### 8.5 The rest of the OTA feature (backend and admin UI)

Firmware is only one half of OTA. The full chain is:

| Piece | Where | Role |
|---|---|---|
| `devices.firmware_version`, `firmware_url`, `firmware_md5` | migration `20261023000000_add_device_firmware_fields.sql` | The **target** build for one device. Empty `firmware_version`/`firmware_url` = opted out. |
| `devices.firmware_version_reported` | migration `20261024000000_add_device_firmware_reported_version.sql` | What the node says it actually runs. Written only by `ingest-reading` from the telemetry field `firmware_version`. |
| `firmware_releases` table | migration `20261025000000_firmware_releases.sql` | Admin-only log of published builds (version, url, md5, notes). The newest row is "latest". It never talks to devices directly. |
| `get-device-config` edge function | `supabase/functions/get-device-config/index.ts` | Authenticates the node by `X-Device-Key`, then returns thresholds, contacts and the three firmware target fields. This is the only channel through which a node learns about an update. |
| Admin Devices page | `src/pages/admin/Devices.tsx` | Publish a release, set a per-device target (edit form), see "Running: x" vs target, and an "outdated devices" indicator comparing reported versions with the latest release. The fleet push button is enabled (see 8.6). |
| Release workflow | `.github/workflows/firmware-release.yml` | Builds and uploads `firmware.bin` (see 8.2a). |

Not provided (by design or not yet built):
- **No Storage bucket migration.** The bucket must be created by hand and be public (or use signed URLs).
- **No rollback.** There is a single target per device. To roll back, publish the older build under a *different* version string and target it; the node compares strings, not order.
- **No image signing.** MD5 detects corruption or a wrong file, not tampering. Anyone who can write the `devices` row or the Storage object controls what a node runs. Both are admin-only today; keep them so.
- **No staged or percentage rollout** and no automatic halt if devices stop reporting after an update.
- **No GSM path.** Updates are Wi-Fi only.

### 8.6 Device identity (was a blocker for fleet OTA; now resolved in code)

**What it was.** `DEVICE_ID` and `DEVICE_API_KEY` used to be compile-time constants, and the backend
identifies a node by its API key, so an OTA image would have made every node report as one device.
Fleet push was disabled because of it.

**What changed.** Identity now lives in each node's NVS (see 5.1 and `identity.h`):
- the 9 former compile-time uses (request headers, payloads, config URL, BFP SMS text) read
  `deviceId()` / `deviceApiKey()` at runtime;
- every outbound POST/GET is skipped (and reported as failed so the existing retry logic applies)
  while the node has no valid identity, instead of sending an empty key;
- the setup portal is now password-protected, because it receives the key;
- the release workflow no longer needs device secrets, and the admin "push to fleet" button is
  enabled again (`FLEET_PUSH_ENABLED = true` in `Devices.tsx`).

**Migration for existing nodes.** They run firmware with identity compiled in, which has no portal
fields. Flash each once over USB with the new build, then enter its ID and API key in the portal.
After that, all later updates can go over the air.

**Known limits.**
- Stored in plain NVS: anyone with physical access can read the key from flash. That was equally true
  of the compiled-in key; ESP32 flash encryption is the mitigation if it matters.
- The portal password is a shared default until you change `WIFI_AP_PASSWORD` in `config.h`.
- **Not tested on hardware.** The host tests cover the validators (24 checks) and the whole
  connectivity/GSM logic with a stubbed identity; the WiFiManager portal flow (forced portal,
  non-blocking `process()`, save-then-reboot) and the NVS read/write are compiled only on the board.
  Bench-test a fresh node, a node with saved Wi-Fi but no identity, and an OTA update that keeps its
  identity before rolling out. Tracked as OQ-26.

---

## 9. Troubleshooting

| Symptom | Likely Cause |
|---|---|
| Blue LED never goes solid | Wi-Fi credentials wrong/expired, or Supabase host unreachable (check `SUPABASE_URL` and firewall) |
| CO readings pinned at 0 or implausible | MQ-7 not calibrated (`MQ7_R0_OHMS`) in clean air, or ADC wiring on GPIO 34 |
| Temperature always last-known / never updates | DS18B20 missing 4.7 kΩ pull-up, or wrong `DS18B20_PIN` |
| GPS `valid` always false | No sky view / cold-start fix can take minutes outdoors; check `GPS_RX_PIN`/`GPS_TX_PIN` wiring |
| SMS never sent, `gsmIsRegistered()` false | SIM800L needs a dedicated ~2 A-capable 4.0 V supply with a large (1000 µF+) cap — brownouts during transmit are the most common failure |
| Alerts never fire despite high readings | Check `sensor_ready` (150 s warm-up) and confirm 3 consecutive readings are required (`ALERT_DEBOUNCE_COUNT`) |
| TLS handshake failures on all HTTPS calls | Supabase's certificate chain changed, or the cert block in `config.h` is truncated/contains extra certs — re-extract the root (see below) and update `SUPABASE_ROOT_CA` |

### Re-extracting the CA certificate

Replace `<ref>` with your project ref (the part before `.supabase.co`).

```powershell
# Windows PowerShell (openssl ships with Git for Windows)
"" | & "C:\Program Files\Git\usr\bin\openssl.exe" s_client -connect <ref>.supabase.co:443 -showcerts
```

```bash
# macOS / Linux
openssl s_client -connect <ref>.supabase.co:443 -showcerts </dev/null
```

The output lists the chain as certificates 0, 1, 2. Copy the **last**
`-----BEGIN CERTIFICATE-----` … `-----END CERTIFICATE-----` block (the root) into
`SUPABASE_ROOT_CA`. Don't include openssl's `s:`/`i:`/`v:` label lines.

# AgapSense Firmware - Hardware Bench Test Checklist

Run this on a real ESP32 node **before** installing it or pushing an OTA update to more than one device.
The host tests (`firmware/agapsense-firmware/host_tests/run.sh`) prove the alert/retry/SMS *logic*; they do not
prove the compiled firmware, Wi-Fi/TLS, the setup portal, NVS, the sensors, the SIM800L or OTA. Those are what
this list covers. Related: `docs/FIRMWARE_GUIDE.md` (sections 5.1, 7, 8) and OQ-10 / OQ-26 in
`docs/open-questions-and-decisions.md`.

Tick each box, write the result in the notes column or below, and keep the filled-in copy with the release.

| | |
|---|---|
| Tester / date | |
| Build env (`esp32dev_mq7_5v` for constant-5V MQ-7 wiring, `esp32dev` for heater PWM) | |
| Firmware version (`FIRMWARE_VERSION`) | |
| Git commit | |
| Board / wiring revision | |
| Supabase project | |

> **Safety first.** Tier 2 sends **real SMS** to the device's BFP number and a Telegram/push alert to the
> responders. Before testing alerts, set the device's `bfp_contact` and the resident's contact number to **your own
> phones**, use a test Telegram chat, and tell the real station you are testing. Never use a real flame; trigger
> alerts by lowering thresholds (section 6) and warming the probe.

## 0. Prerequisites

- [ ] `config.h` created from `config.example.h`; Supabase URL, anon key and CA cert filled in; `WIFI_AP_PASSWORD` changed from the default.
- [ ] `pio run -e <env>` succeeds on a machine with internet (note any warnings): ______. Always pass `-e`: a bare `pio run` also builds `test_components`, which needs its own secrets file.
- [ ] Build with `-DDEBUG_MODE=1` also succeeds, and a serial monitor (115200) is attached for the logs quoted below.
- [ ] A test device row exists in the admin Devices page (copy its **ID/label** and **API key**).
- [ ] The device's `is_active` is true; a test resident is approved and linked to it.
- [ ] Phone with Wi-Fi, a second phone able to receive SMS, a 2.4 GHz Wi-Fi network you can switch off.
- [ ] SIM has credit and a registered network; antenna connected; SIM800L on its own 4.0 V supply with the 1000 uF capacitor.
- [ ] USB cable and a clean flash: `pio run -e <env> -t erase` then `pio run -e <env> -t upload`.

## 1. Power-up and wiring

| # | Check | Expected | Pass | Notes |
|---|---|---|---|---|
| 1.1 | Power on | Boot blink: yellow, red, blue, then a short buzzer beep, all off | [ ] | |
| 1.2 | Serial log (debug build) | Banner with the right `FIRMWARE_VERSION`; five tasks start (MQ7, DS18B20, GPS, Connectivity, GSM); no reboot loop / WDT reset for 5 minutes | [ ] | |
| 1.3 | Brown-out | Trigger GSM activity (section 7) and watch for resets | [ ] | |
| 1.4 | Pin map | Compare `config.h` pins with the physical wiring. **GPS: `GPS_RX_PIN`=17 must go to the module's TX** | [ ] | |

## 2. Device identity and setup portal (OQ-26)

These three are the tests the identity change needs before any fleet push.

### 2A. Fresh node (erased flash)

1. [ ] After `pio run -t erase` + upload, the log shows `No device identity stored - opening setup portal`.
2. [ ] The AP `AgapSense-Setup` appears and **requires** the `WIFI_AP_PASSWORD` (not open).
3. [ ] Join it; the captive portal opens; the page has **Device ID** and **Device API key** fields next to the Wi-Fi form.
4. [ ] Enter the site Wi-Fi + valid ID + key, Save. The log shows the identity saved, then `Identity saved - rebooting to apply`.
5. [ ] After the reboot there is **no portal**; the blue LED goes solid; the log shows the config fetch succeeding.
6. [ ] Admin Devices page: the device shows online and `last_seen` updates within ~30 s (first telemetry).
7. [ ] Power-cycle: it reconnects without the portal. (Identity persisted.)

### 2B. Saved Wi-Fi, no identity

1. [ ] Provision Wi-Fi only (or flash firmware that has Wi-Fi saved) so Wi-Fi credentials exist but identity does not (e.g. erase just NVS namespace `agapsense`, or use a node from 2A with identity cleared).
2. [ ] Boot: the portal is **forced open even though Wi-Fi is saved**.
3. [ ] Save only the identity fields; the node waits for Wi-Fi, then reboots, and comes up ONLINE.
4. [ ] Do not provision it: after `IDENTITY_PORTAL_TIMEOUT_S` (10 min) it runs offline: blue LED off, **nothing posted** (no rows in the admin page), but the yellow/red LEDs and buzzer still respond to sensor thresholds (section 6).

### 2C. Validation and recovery

- [ ] Invalid ID (space, `&`, quote, > 39 chars) is rejected: not stored, portal stays/returns, no reboot.
- [ ] Invalid key (< 8 chars, spaces) is rejected the same way.
- [ ] Wrong but well-formed API key: node boots, telemetry/config requests return 401 in the log, blue LED blinks (DEGRADED); correcting it requires `pio run -t erase` and re-provisioning, and works.
- [ ] Wi-Fi password changed on the router: after 30 s offline `loop()` opens the reconnect portal (`AgapSense-Setup`, password required, **no identity fields**) and the node recovers after re-entering Wi-Fi. Identity is unchanged afterwards.

## 3. Connectivity and device state

| # | Check | Expected | Pass | Notes |
|---|---|---|---|---|
| 3.1 | Online | Blue LED solid; telemetry every 30 s (`TELEMETRY_INTERVAL_MS`) visible in the admin page | [ ] | |
| 3.2 | Wi-Fi off | Blue LED off within seconds; node keeps sampling sensors; reconnects within ~60 s of Wi-Fi returning | [ ] | |
| 3.3 | Internet down, Wi-Fi up | Blue LED **blinks** (DEGRADED); recovers when internet returns | [ ] | |
| 3.4 | Remote config | Change the threshold / contact in the admin page; the node applies it on the next fetch (<= 10 min); log shows `Config loaded: CO>=... Temp>=...` | [ ] | |
| 3.5 | TLS | Requests succeed with the pinned CA; (optional) point at a host with a different cert and confirm it is refused | [ ] | |
| 3.6 | Long run | 24 h on mains: no watchdog resets, memory stable, telemetry gaps < 2 min | [ ] | |

## 4. Sensors

| # | Check | Expected | Pass | Notes |
|---|---|---|---|---|
| 4.1 | DS18B20 | Reads room temperature (+/- 1 C) every 5 s; unplug it: last value is kept, an error is logged, no false alert | [ ] | |
| 4.2 | MQ-7 reads | **Constant-5V build:** a CO reading every 5 s from boot; `mq7_phase` always `measuring`. **Duty-cycle build:** heater full power 60 s (no ADC), then 90 s measuring; `mq7_phase` alternates `heating`/`measuring`. Check the build matches the wiring (FIRMWARE_GUIDE §4.1) | [ ] | |
| 4.3 | Warm-up | `sensor_ready` is false for 60 s (constant-5V) or ~150 s (duty-cycle) after boot and **no alert can fire** (indicators off, "warm-up" log) | [ ] | |
| 4.4 | MQ-7 calibration | In clean air after warm-up (several cycles on the duty-cycle build) measure Rs; set `MQ7_R0_OHMS = Rs`; re-flash; clean-air reading is a plausible low ppm. R0 used: ______ | [ ] | |
| 4.5 | GPS | Outdoors / at a window: valid fix within a few minutes; telemetry `gps_valid` true; coordinates match the real location. Indoors: `gps_valid` false, last-known coordinates kept | [ ] | |
| 4.6 | Battery | Run from the battery path: `battery_mv` in the serial log is plausible (the backend does not store it) and `on_battery` flips below `ON_BATTERY_THRESHOLD_MV`; the dashboards show "On battery" | [ ] | |

## 5. Dashboard consistency

- [ ] Admin pages show the device online, live readings, the on-battery badge when on battery, and running firmware version = `FIRMWARE_VERSION`. (RSSI and battery voltage are sent but not stored, so they appear only in the serial log.)
- [ ] Resident Dashboard / Device Information show the same readings; the status changes to *Reconnecting* after 2 min unplugged and *Offline* after 15 min.

## 6. Alert logic (use lowered thresholds)

Set the device's CO and temperature thresholds just above the current readings in the admin page (e.g. temp = room + 3 C; CO low), wait for the config fetch (or reboot), and wait out the MQ-7 warm-up (test 4.3).

| # | Check | Expected | Pass | Notes |
|---|---|---|---|---|
| 6.1 | Tier 1 (one sensor) | Warm only the DS18B20 above its threshold: after 3 consecutive readings (`ALERT_DEBOUNCE_COUNT`) the **yellow** LED lights, a Tier 1 alert appears in the admin page, push and linked Telegram reach **admins only** (no station chat, no responders, no SMS) | [ ] | |
| 6.2 | Debounce | A single spike (1-2 readings) does **not** trigger | [ ] | |
| 6.3 | Tier 2 (both) | Exceed both thresholds: **red** LED + **buzzer**, Tier 2 alert, **SMS to the owner and the BFP numbers**, station Telegram, linked Telegram chats and push to admins, responders and the resident | [ ] | |
| 6.4 | SMS content | Owner SMS is the Filipino evacuation text with a Maps link; BFP SMS has device ID, time, readings, Maps link, address. The Maps link survives intact | [ ] | |
| 6.5 | SMS status | After sending, the admin alert shows `sms_sent_owner` / `sms_sent_bfp` true (confirm-sms-status) | [ ] | |
| 6.6 | SMS debounce | Staying in Tier 2 does not resend SMS inside 5 min (`SMS_DEBOUNCE_MS`) | [ ] | |
| 6.7 | Escalation | Tier 1 -> Tier 2 needs 3 more consecutive readings | [ ] | |
| 6.8 | Resolution | Back below thresholds: after 2 consecutive safe readings (`ALERT_RESOLUTION_COUNT`) indicators go off and the node returns to CLEAR; the incident does not auto-close if a responder has acknowledged it (D6.1) | [ ] | |
| 6.9 | Offline alarm | Pull Wi-Fi during a Tier 2: LEDs + buzzer still work, SMS still goes out over GSM, the alert POST is retried and lands when Wi-Fi returns (no duplicate incident) | [ ] | |
| 6.10 | Reboot mid-alert | Power-cycle during Tier 2: after warm-up it re-detects and alerts again; no phantom resolved state | [ ] | |

## 7. GSM / SMS (SIM800L)

- [ ] `gsmInit` registers on the network (log: `SIM800L registered`); `AT+CSQ` signal is acceptable.
- [ ] SMS to a Philippine number in `+639...` format is delivered within ~30 s.
- [ ] With the SIM removed or no credit: the send fails gracefully, the result is reported as failure, no reboot or WDT reset.
- [ ] Two SMS back to back (owner + BFP) both go out; the queue never drops one.
- [ ] No SIM800L brown-out resets during transmission (scope the 4.0 V rail if resets occur).

## 8. OTA update (only after sections 2, 3 and 6 pass)

Use a **test device and a throwaway build**; keep a USB cable to recover it.

| # | Check | Expected | Pass | Notes |
|---|---|---|---|---|
| 8.1 | Build A -> B | Flash build A over USB. Build B from the same env with a visible change and a new `FIRMWARE_VERSION` (in `config.h` for `esp32dev`, in `platformio.ini` for `esp32dev_mq7_5v`) | [ ] | |
| 8.2 | Release | Upload B to Storage (the release workflow currently builds the wrong env, see FIRMWARE_GUIDE §8.2a), add the release, set the target on **this one device** with the correct MD5 | [ ] | |
| 8.3 | Update | Within 10 min the log shows `OTA: new firmware <B> available`, download, flash, reboot | [ ] | |
| 8.4 | Version | Admin page shows "Running: <B>" after the next telemetry | [ ] | |
| 8.5 | Identity kept | After the update the node needs **no portal** and keeps the same ID/key (`last_seen` continues under the same device) | [ ] | |
| 8.6 | Wi-Fi kept | Saved Wi-Fi survives; blue LED solid again | [ ] | |
| 8.7 | Bad MD5 | Set a wrong MD5: the update is rejected (`Update.end failed`) and the node keeps running A | [ ] | |
| 8.8 | Bad URL | Broken or non-public URL: `OTA: fetch failed`, node keeps running A, retries next cycle | [ ] | |
| 8.9 | Alert gate | While in Tier 1/Tier 2 (or when a threshold is crossed mid-download) the OTA does not start / aborts | [ ] | |
| 8.10 | Interrupted | Cut Wi-Fi mid-download: aborted cleanly, still on A, no brick | [ ] | |
| 8.11 | Two nodes | With **two provisioned nodes**, push the release to both: each updates, keeps its **own** ID/key, and reports under its own device row. (This is the test that proves fleet OTA.) | [ ] | |
| 8.12 | Legacy node | A node still on pre-identity firmware: flash over USB, provision in the portal, then confirm a later OTA works | [ ] | |

## 9. Sign-off

| Gate | Result |
|---|---|
| Sections 1-4 pass | [ ] |
| Section 2 (identity) passes on at least 2 nodes | [ ] |
| Section 6 (alerts) passes incl. real SMS | [ ] |
| Section 8.11 (two-node OTA) passes before enabling fleet push | [ ] |
| 24 h soak (3.6) without resets | [ ] |

Failures found (ID, symptom, log excerpt, firmware commit): ______

Approved for installation by: ______ Date: ______

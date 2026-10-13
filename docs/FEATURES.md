# AgapSense — Features & Functions Reference

This document describes what the code in this repository does today. Where behaviour is incomplete, undeployed or unverified it says so.
For the full evidence-based baseline see [`system-specification.md`](system-specification.md) (draft, not owner-approved).

---

## 🏗️ Core Features

### 1. Role-Based Access Control (RBAC)
Three roles (`profiles.role`): `admin`, `bfp_responder`, `resident`. Route protection in the SPA (`AuthGuard.tsx`) is a UI convenience; authority lives in PostgreSQL RLS, grants, RPCs and Edge Functions.
- **Admin**: manages users, devices, thresholds, security settings and logs; approves registrations; can manually close incidents.
- **BFP Responder**: sees all devices, readings, incidents and the live map; handles incidents (acknowledge → responding → resolved / false alarm) through `transition_incident()`; edits own profile and station information.
- **Resident**: sees only the device linked to their account; edits that device's thresholds (via RPC) and their own contact number.

> **Known caveat:** `get_auth_role()` in the repository does not check `profiles.status`, so backend denial of *pending/rejected* accounts is not guaranteed by RLS alone (spec KI-09). The UI blocks them, and profile reads and Edge Functions check status explicitly.

### 2. Two-Tier Alert System
Detection uses an MQ-7 CO sensor and a DS18B20 temperature sensor. The firmware evaluates readings only while `sensor_ready` is true and only from valid MQ-7 measuring-phase data.

- **Debounce:** 3 consecutive over-threshold readings are needed to enter an alert or escalate Tier 1 → Tier 2; 2 consecutive safe readings clear it.
- **Tier 1 (Warning)** — exactly one sensor at/over its threshold: yellow LED, Telegram warning to the station chat, Web Push to admins and responders. **No SMS.**
- **Tier 2 (Fire Alert)** — both sensors at/over threshold: red LED + buzzer, Telegram alert, Web Push (also to the linked resident), and the ESP32 sends **two SMS** through the SIM800L — a plain-language evacuation message to the resident (owner) number and a technical message (device, time, GPS, address, link) to the device's BFP number.
- **Backend authority:** `trigger-alert` recomputes the tier from the stored per-device thresholds; the tier sent by the firmware is ignored. A post that is below both thresholds is rejected (`below_threshold`).
- **One open incident per device.** `raise_alert()` upserts atomically; the tier can only increase, and repeated or late posts return the same incident. Notifications are claimed in a ledger (`claim_notification`) so a retry does not re-send the same (incident, tier, channel, recipient).
- **SMS debounce:** a 5-minute timer in the firmware limits repeated SMS. It does not affect Telegram, Push, LEDs, buzzer or database logging.
- **Navigation link:** Telegram and SMS messages contain `https://maps.google.com/?q=<lat>,<lng>`.
- **Auto-resolution:** when a `sensor_ready` reading arrives with both values strictly below threshold, `ingest-reading` closes the device's open incident. *The owner has not yet ratified this policy (spec KI-13).* An admin can close an incident manually from the System Overview page; responders use `transition_incident()`.

### 3. Incident Lifecycle
`active → acknowledged → responding → resolved | false_alarm`. A closed incident is immutable. All transitions go through the `transition_incident()` RPC (client helper `src/lib/incidents.ts`). Delivery status of Telegram / SMS (owner, BFP) is recorded per incident.

### 4. Location, Mapping and Addresses
- **GPS:** NEO-6M, parsed continuously. A fix is "live" only if valid and younger than 5 s; otherwise the last good fix is republished with `gps_valid = false`. Before the first fix the cached value is `0,0`.
- **Reverse geocoding:** OpenStreetMap Nominatim, run in `trigger-alert`. Messages use a tiered address (street → barangay → municipality), falling back to `display_name`, and always include raw coordinates (labelled "estimated — last known" when `gps_valid` is false). Results are cached in memory (4-decimal grid).
- **Interactive map** (`react-leaflet` + OSM tiles): pins are coloured green (online / normal), red (fire alert), amber (fault / pre-alert) and grey (offline). Each device is labelled live / last-known / registered / unavailable (`src/lib/location.ts`); devices with no usable coordinates are not drawn.
- **Address-drift detection:** if a reading is more than 100 m from the device's registered location, a prompt (`address_discrepancies`) is raised to the resident. Approving it overwrites the device's registered address and coordinates.

### 5. Communication and Provisioning
- **Wi-Fi path:** HTTPS (pinned root CA) to Supabase Edge Functions for telemetry (every 30 s), alerts, config and SMS-status reports.
- **GSM path:** SIM800L is used for **SMS only** (2G). There is no data-over-GSM fallback; whether one is wanted is an open owner question (spec OQ-02).
- **Captive portal:** with no saved credentials the ESP32 opens an **open** AP named `AgapSense-Setup` (WiFiManager); the user selects a network and enters the password, credentials are stored in NVS. The page is served by the ESP32, separate from the web app. The portal is relaunched after 30 s disconnected.
- **Local indicators:** yellow LED = Tier 1, red LED + buzzer = Tier 2, blue LED = solid when online, blinking (500 ms) when Wi-Fi is up but the backend is unreachable (degraded), off when offline.
- **Power:** mains with backup battery; the device reports `on_battery` (battery ADC < 4000 mV). Admin pages show a "Battery" badge; the resident home page shows a Power card (Mains / Battery).
- **Firmware reliability:** alert POST retry with backoff, late-binding of SMS outcome to the correct incident, 30 s hardware watchdog, and OTA update when the backend's target firmware version differs (`FIRMWARE_VERSION` in `config.h`).
- **No local buffering:** readings generated while offline are not queued and are lost.

### 6. Dashboards and Real-Time Monitoring
- **Realtime:** the SPA uses Supabase Realtime (`postgres_changes`) for readings, alerts and device updates.
- **Connectivity badge** (`src/lib/deviceStatus.ts`): *Online* (< 2 min since last contact), *Reconnecting* (2–15 min, "Last seen X min ago"), *Offline* (> 15 min or never). The status is re-evaluated on a client-side tick.
- **Sensor initialisation:** while `sensor_ready` is false the resident home page shows "Initializing sensors..." in place of values. `sensor_ready` becomes true after the first complete MQ-7 cycle (60 s heating + 90 s measuring ≈ 150 s after power-on).
- **Admin:** dashboard, map, devices, users, System Overview (fleet status, rename, power toggle, manual resolve), system log with export, security settings.
- **Responder:** dashboard (state per device, unresolved incidents, map, audible alarm for unacknowledged fire), alert logs, settings (profile, Telegram link, station information).
- **Resident:** mandatory first-login setup (mobile number), home (status, readings, last 24 readings, alerts, address prompts), alert settings (thresholds, Web Push, Telegram link), device info, system log, account.
- **Support requests:** users file in-app requests (`support_requests`), which admins review in an inbox.
- **Known defects:** some displayed metrics are placeholders (resident "System Uptime", responder "connectivity %", map "Signal / Latency"); see spec KI-01/02.

### 7. Registration & Admin Approval Workflow
- Public sign-up (`register`) is available for `resident` and `bfp_responder` only; the account starts as `pending` and a `registration_requests` row is created.
- Pending/rejected users can log in but the UI shows a Pending/Rejected screen instead of the app.
- Admins approve/reject in Users (optionally assigning a device) or create a pre-approved account directly (`create-user`).
- Residents link a device with its device code (`link-device`); one resident per device.

---

## ⚡ Edge Functions Reference

Located in `supabase/functions/`. Functions called by the ESP32 authenticate with the `X-Device-Key` header (matched to `devices.api_key`, device must be active) and use the service-role client, scoping writes to that device.

| Function | Caller | Action |
|---|---|---|
| **`ingest-reading`** | Device | Stores a reading (`co_ppm`, `temp_celsius`, coordinates, `gps_valid`, `on_battery`, `sensor_ready`), updates `last_seen_at` / `local_ip` / reported firmware version, auto-resolves the open incident when readings are below thresholds, and detects address drift. |
| **`trigger-alert`** | Device | Validates key, recomputes tier from stored thresholds, reverse-geocodes, raises/updates the incident (`raise_alert`), sends Telegram (station chat) and Web Push through the notification ledger, and returns `owner_contact` / `bfp_contact` and the `alert_event_id` for SMS. |
| **`get-device-config`** | Device | Returns thresholds, `owner_number`, `bfp_number` and firmware target, so settings change without re-flashing. Fetched at boot and every 10 minutes. |
| **`confirm-sms-status`** | Device | Reports the real SIM800L `+CMGS` outcome per SMS to `alert_events.sms_sent_owner` / `sms_sent_bfp`. |
| **`login`** | Frontend | Checks `check_login_lockout`, forwards credentials to GoTrue, records every attempt. Lockout within 15 min: 3 failures → 10 s, 5 → 30 s, 7 → 900 s; an admin can unlock early. |
| **`register`** | Public | Creates the auth user, a `pending` profile and a registration request. |
| **`manage-registration`** | Admin | Approves or rejects a pending registration. |
| **`create-user`** | Admin | Creates a pre-approved user directly. |
| **`assign-device`** | Admin | Assigns / unassigns a device to a resident. |
| **`link-device`** | Resident | Links the caller to a device by device code. |
| **`telegram-webhook`** | Telegram | Links a user's Telegram chat ID to their profile (`/start <token>`). *No code yet sends alerts to per-user chats; alerts go to the shared station chat only.* |
| **`register-push`** / **`send-push-notification`** | Frontend / backend | Web Push (VAPID) subscription storage and delivery. |
| **`admin-support-request`** | Frontend | Inserts an in-app support request. |

---

## 🔒 Security & Hardware Integration

### IoT Device Authentication
- Devices use a per-device `api_key` (generated server-side at registration, e.g. `sk_…`; regenerable by an admin through an RPC) in the `X-Device-Key` header. Requests without a valid, active key are rejected.
- The key is stored in plaintext in `devices.api_key` and exposed only to admins (via `devices_safe`).

### Row Level Security (RLS)
- Residents can read `sensor_readings` and `alert_events` only for their own `device_id`.
- Only approved admins can read other users' profiles.
- Direct client INSERT into `sensor_readings` / `alert_events` is revoked; only Edge Functions (service role) write them.
- See the caveat under RBAC regarding pending accounts.

### Self-Promotion Protection
A trigger on `profiles` reverts non-admin attempts to change `role`, `status` or `device_id`. It does not currently cover `is_active`, `setup_complete` or `telegram_chat_id` (spec KI-10).

### Session Security
- Per-role idle timeout (`timeout_admin`, `timeout_bfp`, `timeout_resident` in `settings`; UI defaults 15 / 15 / 60 min) signs the user out and redirects to `/session-expired`.

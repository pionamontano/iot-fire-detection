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

Backend denial does not depend on the UI: `get_auth_role()` returns NULL unless the profile is `approved` and `is_active`, so RLS gives pending, rejected and deactivated accounts nothing (`20261031000000`, `20261030000000`).

### 2. Two-Tier Alert System
Detection uses an MQ-7 CO sensor and a DS18B20 temperature sensor. The firmware evaluates readings only while `sensor_ready` is true and only from valid MQ-7 measuring-phase data.

- **Debounce:** 3 consecutive over-threshold readings are needed to enter an alert or escalate Tier 1 → Tier 2; 2 consecutive safe readings clear it.
- **Tier 1 (Warning)** — exactly one sensor at/over its threshold: yellow LED, Web Push and personal Telegram to **admins and the device's resident** (owner decision OQ-06); the shared station Telegram chat is the fire station's and gets Tier 2 only. **No SMS.** BFP responders are not notified of Tier 1 and their pages list Tier 2 only (`src/lib/dispatch.ts`).
- **Tier 2 (Fire Alert)** — both sensors at/over threshold: red LED + buzzer, Telegram alert, Web Push (also to the linked resident), and the ESP32 sends **two SMS** through the SIM800L — a plain-language evacuation message to the resident (owner) number and a technical message (device, time, GPS, address, link) to the device's BFP number.
- **Backend authority:** `trigger-alert` recomputes the tier from the stored per-device thresholds; the tier sent by the firmware is ignored. A post that is below both thresholds is rejected (`below_threshold`).
- **One open incident per device.** `raise_alert()` upserts atomically; the tier can only increase, and repeated or late posts return the same incident. Notifications are claimed in a ledger (`claim_notification`) so a retry does not re-send the same (incident, tier, channel, recipient).
- **SMS debounce:** a 5-minute timer in the firmware limits repeated SMS. It does not affect Telegram, Push, LEDs, buzzer or database logging.
- **Navigation link:** Telegram and SMS messages contain `https://maps.google.com/?q=<lat>,<lng>`.
- **Auto-resolution (owner decision D6.1):** after two consecutive `sensor_ready` readings with both values strictly below threshold, `ingest-reading` closes the device's open incidents that are still `active`. An incident a responder has acknowledged or marked responding is left for the responder to close. An admin can close an incident manually from the Device Status page; responders use `transition_incident()`. The device's resident can close an open **Tier 1** warning themselves ("Mark as resolved" on the dashboard, "Resolve" in Alert History) through `resident_resolve_warning()` (`resolution_source='resident'`); Tier 2 stays with responders and admins.

### 3. Incident Lifecycle
`active → acknowledged → responding → resolved | false_alarm`. A closed incident is immutable. All transitions go through the `transition_incident()` RPC (client helper `src/lib/incidents.ts`). Delivery status of Telegram / SMS (owner, BFP) is recorded per incident.

### 4. Location, Mapping and Addresses
- **GPS:** NEO-6M, parsed continuously. A fix is "live" only if valid and younger than 5 s; otherwise the last good fix is republished with `gps_valid = false`. Before the first fix the cached value is `0,0`.
- **Reverse geocoding:** OpenStreetMap Nominatim, run in `trigger-alert`. Messages use a tiered address (street → barangay → municipality), falling back to `display_name`, and always include raw coordinates (labelled "estimated — last known" when `gps_valid` is false). Results are cached in memory (4-decimal grid).
- **Interactive map** (`react-leaflet` + OSM tiles): pins use the shared status colours from `src/lib/deviceStatus.ts`: red (fire, Tier 2), amber (warning, Tier 1), green (online), blue (reconnecting), grey (offline) and near-black (disabled by an admin). Each device is labelled live / last-known / registered / unavailable (`src/lib/location.ts`); devices with no usable coordinates are not drawn.
- **Install address and pin:** set by the resident linked to the device (first-login setup or Device Information, `update_own_device_location()`), not at registration. `devices.location_verified` records whether an admin has confirmed it; a database trigger resets it whenever a non-admin changes the address or pin, and only an admin can set it (Devices page → Edit device; the *Pin unverified* filter and a banner on that page list the pending ones). Pins that existed before this change were marked confirmed.
- **Registered-pin fallback in alerts:** when the device sends no usable GPS, the Tier 2 Telegram message includes the registered pin and a navigation link, labelled *confirmed by admin* or *UNVERIFIED — set by resident*. With no address set, messages say "Location not set".
- **Address-drift detection:** if a reading is more than 100 m from the device's registered location, a prompt (`address_discrepancies`) is raised to the resident. Approving it overwrites the device's registered address and coordinates.

### 5. Communication and Provisioning
- **Wi-Fi path:** HTTPS (pinned root CA) to Supabase Edge Functions for telemetry (every 30 s), alerts, config and SMS-status reports.
- **GSM path:** SIM800L is used for **SMS only** (2G), as the backup when the internet is gone: the Tier 2 owner and BFP SMS are sent only if the device could not deliver the alert online (owner decision OQ-02, firmware 2.4.0). There is no data-over-GSM fallback; whether one is wanted is still an open owner question (OQ-02).
- **Captive portal:** with no saved credentials, or no stored device identity, the ESP32 opens a WPA2-protected AP named `AgapSense-Setup` (WiFiManager, password `WIFI_AP_PASSWORD` in `config.h`); the user selects a network and enters its password, plus the Device ID and API key on a new unit. Everything is stored in NVS. The page is served by the ESP32, separate from the web app. The portal is relaunched after 30 s disconnected and the device restarts if it times out (180 s).
- **Local indicators:** yellow LED + 3 short beeps every 45 s = Tier 1, red LED + continuous buzzer = Tier 2, blue LED = solid when online, blinking (500 ms) when Wi-Fi is up but the backend is unreachable (degraded), off when offline.
- **Power:** mains with backup battery; the device reports `on_battery` (battery ADC < 4000 mV). Admin pages show an on-battery badge; the resident Dashboard shows Power (Mains / On battery) under Device Health.
- **Firmware reliability:** alert POST retry with backoff, late-binding of SMS outcome to the correct incident, 30 s hardware watchdog, and OTA update when the backend's target firmware version differs (`FIRMWARE_VERSION` in `config.h`).
- **No local buffering:** readings generated while offline are not queued and are lost.

### 6. Dashboards and Real-Time Monitoring
- **Realtime:** the SPA uses Supabase Realtime (`postgres_changes`) for readings, alerts and device updates.
- **Connectivity badge** (`src/lib/deviceStatus.ts`): *Online* (< 2 min since last contact), *Reconnecting* (2–15 min, "Last seen X min ago"), *Offline* (> 15 min or never). The status is re-evaluated on a client-side tick.
- **Sensor initialisation:** while `sensor_ready` is false the resident Dashboard shows "Warming up" in place of the CO value. `sensor_ready` becomes true after the first complete MQ-7 cycle (60 s heating + 90 s measuring ≈ 150 s after power-on).
- **Admin:** dashboard, map, devices (management table, registration, firmware releases), users, Device Status (fleet status, manual resolve), system log with export, security settings.
- **Responder (Tier 2 only):** dashboard (open fire incidents oldest first with address, readings, the linked resident's name and tap-to-call number (`get_incident_resident_contact()`, open Tier 2 incidents only), incident actions and directions to the live GPS / last-known / registered pin, device map without Tier 1 warnings, devices reporting, audible alarm for unacknowledged fire), alert logs (fire incidents with status chips, time to acknowledge, detail view, CSV export), settings (profile, Telegram link, browser push, station information; station hotline accepts PH mobile or landline). The header bell counts Tier 2 only.
- **Resident:** mandatory first-login setup (mobile number, then install address and pin if a device is linked), Dashboard (status, readings, last 24 readings, recent alerts, emergency contacts, address prompts, device-link form when none is linked), Alert History, Alert Settings (thresholds, SMS number, Web Push, Telegram link), Device Information, Account (name, support requests).
- **Support requests:** users file in-app requests (`support_requests`) from Account (residents) or Settings (responders); admins review them at `/admin/support` and their reply is shown under the requester's My Requests.

### 7. Registration & Admin Approval Workflow
- Public sign-up (`register`) is available for `resident` and `bfp_responder` only; the account starts as `pending` and a `registration_requests` row is created.
- Pending/rejected users can log in but the UI shows a Pending/Rejected screen instead of the app.
- Admins approve/reject in Users (optionally assigning a device) or create a pre-approved account directly (`create-user`).
- Residents link a device with its device code (`link-device`); one resident per device.
- **Devices page** (`/admin/devices`): a table of every device (code and name, linked resident, install address with pin status, connectivity status, firmware running vs latest release, registration date) with search and filters (pin unverified, no pin yet, firmware outdated, no resident linked, disabled). Clicking a row opens Edit device (name, thresholds, BFP contact, install location and confirmation, OTA target, API key regeneration, and enable/disable). Disabling asks for the device code to be typed back, because the backend then ignores the device's readings and fire alerts; a disabled device shows as **Disabled** (its own status, not Offline) everywhere. Re-enabling changes only `is_active`, so the device shows its real status until it reports. The BFP contact must be a PH mobile number (saved as `09XXXXXXXXX`) or blank; blank means the device sends no BFP SMS. The device picks up a change, including clearing it, from its next `trigger-alert` reply or config fetch (within 10 minutes). Firmware releases are published from the same page. Device Status (`/admin/status`) stays the monitoring view (status, map, manual resolve) and links to Edit device; `?edit=<device id>` and `?register=1` open those windows directly.
- **Device registration** (Devices page → Register Device): the admin enters only an optional name. `register_device()` generates the next device code (`AGS-NNN`) and the API key and returns both once, for the Wi-Fi setup portal; thresholds start at the column defaults (60 °C, 200 ppm CO). The address and pin are left empty for the resident.

---

## ⚡ Edge Functions Reference

Located in `supabase/functions/`. Functions called by the ESP32 authenticate with the `X-Device-Key` header (matched to `devices.api_key`, device must be active) and use the service-role client, scoping writes to that device.

| Function | Caller | Action |
|---|---|---|
| **`ingest-reading`** | Device | Stores a reading (`co_ppm`, `temp_celsius`, coordinates, `gps_valid`, `on_battery`, `sensor_ready`), updates `last_seen_at` / `local_ip` / reported firmware version, auto-resolves the open incident when readings are below thresholds, and detects address drift. |
| **`trigger-alert`** | Device | Validates key, recomputes tier from stored thresholds, reverse-geocodes, raises/updates the incident (`raise_alert`), sends Telegram (station chat on Tier 2 only; linked personal chats) and Web Push through the notification ledger, and returns `owner_contact` / `bfp_contact` and the `alert_event_id` for SMS. |
| **`get-device-config`** | Device | Returns thresholds, `owner_number`, `bfp_number` and firmware target, so settings change without re-flashing. Fetched at boot and every 10 minutes. |
| **`confirm-sms-status`** | Device | Reports the real SIM800L `+CMGS` outcome per SMS to `alert_events.sms_sent_owner` / `sms_sent_bfp`. |
| **`login`** | Frontend | Lower-cases the e-mail, checks `check_login_lockout`, forwards credentials to GoTrue, records every attempt. Lockout within 15 min: 3 failures → 10 s, 5 → 30 s, 7 → 900 s; an admin can unlock early. |
| **`register`** | Public | Creates the auth user, a `pending` profile and a registration request. |
| **`manage-registration`** | Admin | Approves or rejects a pending registration. |
| **`create-user`** | Admin | Creates a pre-approved user directly. |
| **`assign-device`** | Admin | Assigns / unassigns a device to a resident. |
| **`manage-user`** | Admin | Edits a user (name, contact, address, role, login email, temporary password), deactivates / reactivates accounts (no hard delete), and lists login emails + last sign-in. |
| **`link-device`** | Resident | Links the caller to a device by device code. |
| **`telegram-webhook`** | Telegram | Links a user's Telegram chat ID to their profile (`/start <token>`). `trigger-alert` then sends that user the alerts their role receives (admins: Tier 1 and 2; responders and the device's resident: Tier 2). |
| **`register-push`** / **`send-push-notification`** | Frontend / backend | Web Push (VAPID) subscription storage and delivery. |
| **`admin-support-request`** | Frontend | Inserts an in-app support request and notifies every approved, active admin (browser push that opens `/admin/support?request=<id>`, plus their linked Telegram chat; the link is added to Telegram only when the `APP_URL` secret is set). |
| **`resolve-support-request`** | Admin | Resolves or reopens a support request; on resolve, messages the requester (linked Telegram chat + browser push) with the admin's note. |

---

## 🔒 Security & Hardware Integration

### IoT Device Authentication
- Devices use a per-device `api_key` (generated server-side at registration, e.g. `sk_…`; regenerable by an admin through an RPC) in the `X-Device-Key` header. Requests without a valid, active key are rejected.
- The key is stored in plaintext in `devices.api_key` and exposed only to admins (via `devices_safe`).

### Row Level Security (RLS)
- Residents can read `sensor_readings` and `alert_events` only for their own `device_id`.
- Only approved admins can read other users' profiles.
- Direct client INSERT into `sensor_readings` / `alert_events` is revoked; only Edge Functions (service role) write them.
- Pending, rejected and deactivated accounts get no rows (see RBAC above).

### Self-Promotion Protection
A trigger on `profiles` reverts Data API attempts by anyone but an approved, active admin to change `role`, `status`, `device_id`, `telegram_chat_id` or `is_active` (`20261108000000`), so a deactivated user cannot re-activate itself with a still-valid token. `setup_complete` stays user-writable because first-run setup sets it.

### Session Security
- Per-role idle timeout (`timeout_admin`, `timeout_bfp`, `timeout_resident` in `settings`) signs the user out and redirects to `/session-expired`. Until an admin saves a value, the defaults apply: 15 min for admins and responders, 60 min for residents (`src/lib/sessionTimeouts.ts`, shared with the Settings page).

# AgapSense — Features & Functions Reference

This document provides a deep dive into the capabilities, workflows, and backend functions that power the AgapSense system.

---

## 🏗️ Core Features

### 1. Role-Based Access Control (RBAC)
The system strictly segregates capabilities into three distinct roles, secured at the database level via PostgreSQL Row Level Security (RLS):
- **Admin**: Has global access to manage all users, devices, settings, and logs. Responsible for approving new registrations and maintaining system integrity.
- **BFP Responder**: Focuses purely on incident response. Can view active alerts, responder team details, and the real-time geographical map. Cannot manipulate user accounts or system settings.
- **Resident**: End-users who monitor their own home. Can only view the telemetry data and alerts for the specific device assigned to their property.

### 2. Intelligent Alert System (Tier 1 & Tier 2)
The IoT devices trigger alerts based on carbon monoxide (CO) and temperature thresholds, executing tiered responses:
- **Tier 1 (Warning)**: Minor threshold breaches. These are logged in the system and a Telegram notification is dispatched to administrators/responders for monitoring. No SMS is sent to avoid panic.
- **Tier 2 (Fire Alert)**: Critical threshold breaches. Triggers full emergency protocols:
  - The global dashboard highlights the alert.
  - SMS is dispatched to the Resident (owner) and BFP (Responders).
  - High-priority Telegram message is sent with GPS coordinates, reverse-geocoded address, and a Google Maps link.

### 3. Interactive GIS Map
- Real-time map powered by Leaflet and OpenStreetMap.
- Displays the precise GPS coordinates of all active devices.
- Highlights active fire hotspots dynamically when a Tier 2 alert is triggered, allowing responders to visually track incidents.

### 4. Registration & Admin Approval Workflow
To prevent unauthorized access, the system utilizes an approval gateway:
- Users self-register via the public portal (providing verification details like organization or address).
- Their account is placed in a `pending` state (they can log in, but RLS blocks them from accessing any data).
- Admins review the `registration_requests` queue via the Admin Dashboard.
- Once approved, the user's role and permissions are instantly unlocked.

---

## ⚡ Edge Functions Reference

The backend logic is heavily decoupled into serverless Supabase Edge Functions (`supabase/functions/`), ensuring that sensitive operations (like sending SMS, pushing Telegram notifications, or bypassing auth) happen securely on the server, not the client.

| Function | Trigger / Use Case | Action Performed |
|---|---|---|
| **`trigger-alert`** | Called by IoT Device | Validates device API key. Checks thresholds. Reverse-geocodes GPS data. Dispatches Telegram/SMS alerts. Inserts event into `alert_events`. |
| **`ingest-reading`** | Called by IoT Device | Records routine ambient temperature and CO levels into `sensor_readings` for historical graphing without triggering an alarm. |
| **`register`** | Public Sign-up | Handles unauthenticated sign-ups. Creates the Supabase Auth user, populates the `profiles` table with `status = 'pending'`, and logs the `registration_request`. |
| **`manage-registration`**| Admin Action | Approves or rejects a pending user. If approved, updates their profile status and grants them their requested role. |
| **`create-user`** | Admin Action | Bypasses the approval workflow to directly create and provision a pre-approved user (e.g., manually adding a new responder). |
| **`assign-device`** / **`link-device`** | Admin Action | Links an IoT device's UUID to a specific resident in the `profiles` table so the resident gains RLS access to its telemetry. |
| **`get-device-config`** | Called by IoT Device | Returns the device's current `co_threshold`/`temp_threshold`/`bfp_contact` and the linked resident's `contact_number`, so an admin can retune a device from the dashboard without re-flashing it. |
| **`confirm-sms-status`** | Called by IoT Device | Reports the real SIM800L `+CMGS` delivery outcome for a Tier 2 SMS back to the originating `alert_events` row (`sms_sent_owner`/`sms_sent_bfp`), once per message. |

---

## 🔒 Security & Hardware Integration

### IoT Device Authentication
- Devices **do not** use standard username/password auth. 
- When an Admin registers a device in the dashboard, a unique, randomly generated `api_key` (e.g., `sk_123abc...`) is created.
- The hardware must pass this key in its requests to the `trigger-alert` and `ingest-reading` webhooks. Without it, the payload is rejected.

### Row Level Security (RLS)
Even if the frontend is compromised or a user tries to query the database directly, the data is safe. Postgres policies enforce that:
- Residents can `SELECT` from `sensor_readings` but only where the `device_id` matches their own profile.
- A `pending` user mathematically cannot read devices, alerts, or logs because the security definer function (`get_auth_role()`) evaluates them as having no role until approved.

### Self-Promotion Protection
Database triggers actively watch the `profiles` table. If a malicious user attempts a direct API call to change their `role` from `resident` to `admin`, or their `status` from `pending` to `approved`, the PostgreSQL trigger intercepts the update and forces it to revert to its original value. Only service role keys (Edge Functions) bypass this.

# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **`login` Edge Function:** Implemented a new server-side login gatekeeper. This enforces login attempt limit rate locking logic via `check_login_lockout` before allowing connection to GoTrue, properly preventing brute-force attacks and ensuring lockout tiers escalate correctly.
- **`telegram-webhook` Edge Function:** Added a new function to handle Telegram API webhooks, linking a user's Telegram ID to their profile by updating `telegram_chat_id` based on the provided `/start <id>` payload.
- **TelnetStream Support:** Added `TelnetStream` integration to the ESP32 firmware for remote, local network debugging on port 23 when `DEBUG_MODE=1` is enabled.
- **`local_ip` Column:** Added `local_ip` to the `devices` table to store the local network IP address of the node for easier debugging and direct access.
- **`telegram_chat_id` Column:** Added `telegram_chat_id` to the `profiles` table to support the new Telegram webhook integration.
- **Database Migrations:** Consolidated and sequenced DB schema migrations for better onboarding.

### Changed
- **Documentation Overhaul:** Moved `FEATURES.md`, `FIRMWARE_GUIDE.md`, and `MIGRATION_GUIDE.md` into the `docs/` directory. Updated `README.md` to point to the new location and reflect the latest architecture and capabilities.
- **Layout Imports:** Cleaned up layout component imports in `App.tsx` (previously documented incorrectly as a single `Layout.tsx` file).
- **Firmware Logging:** Converted `Serial.printf` calls in the firmware to `TelnetStream.printf` to support simultaneous serial and network debugging.

### Fixed
- **Login Lockout Bypass:** Addressed a critical security vulnerability where the client could skip the lockout check, and lockout tiers were failing to escalate.
- **Admin Unlock Check:** Fixed an issue where the admin check in DB functions would silently fail due to incorrect `NULL` comparison.
- **Base Table Exfiltration:** Dropped non-admin SELECT policies from the base `devices` table to prevent API key masking bypasses.
- **Threshold Constraints:** Added `CHECK` constraints to `devices.co_threshold` and `temp_threshold` to prevent nonsensical values.
- **`devices_safe` Visibility Regression:** Fixed view to ensure devices are visible to users independently of base table grants.
- **Pending/Rejected Profile Read:** Fixed profile read logic to allow users to read their own profiles while pending or rejected, preventing indefinite authentication hangs.
- **Idle Timeout Race Condition:** Corrected the navigation sequence in `useIdleTimeout.ts` to properly redirect to `/session-expired` instead of `/login`.

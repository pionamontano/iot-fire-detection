-- =============================================================
-- Finding from live database testing (LIVE_DATABASE_VERIFICATION.md
-- #20): devices.co_threshold/temp_threshold had no DB-level CHECK
-- constraint. Confirmed live: inserting a device with
-- co_threshold: -500, temp_threshold: -999 was accepted as-is.
--
-- update_own_device_alert_settings (the resident RPC path) already
-- enforces 0-100 C / 0-1000 ppm as defense in depth, but that RPC is
-- the only write path bounded this way - a direct admin write to
-- the devices table (Devices.tsx, or any future direct-write
-- feature) had no DB-level backstop against a nonsensical or
-- inverted threshold that could suppress a real fire/CO alert.
--
-- Fix: add the same bounds as table-level CHECK constraints, so
-- every write path is bounded consistently regardless of how it
-- reaches the table.
-- =============================================================

alter table public.devices
  add constraint devices_co_threshold_range
    check (co_threshold >= 0 and co_threshold <= 1000);

alter table public.devices
  add constraint devices_temp_threshold_range
    check (temp_threshold >= 0 and temp_threshold <= 100);

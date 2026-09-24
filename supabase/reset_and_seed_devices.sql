-- =============================================================
-- AgapSense — Wipe seeded data, keep users, seed fresh devices
-- Run this ONCE in the Supabase SQL Editor.
--
-- Scope (as decided with the project owner):
--   WIPED:  devices, sensor_readings, alert_events,
--           registration_requests, login_attempts
--   KEPT:   auth.users, profiles, settings, station_settings
--   SEEDED: a handful of realistic `devices` rows only — no fake
--           sensor_readings/alert_events, since no physical
--           hardware has reported in yet.
--
-- profiles.device_id is nulled out first because devices are being
-- deleted out from under it (FK is NO ACTION, so it would otherwise
-- block the delete). Residents will need to be re-linked to one of
-- the new devices via the admin "Assign device" action (Users page)
-- once real hardware is provisioned.
-- =============================================================

begin;

-- 1. Release FK from profiles before devices are removed.
update public.profiles
set device_id = null
where device_id is not null;

-- 2. Wipe seeded/operational data, most-dependent tables first.
delete from public.alert_events;
delete from public.sensor_readings;
delete from public.registration_requests;
delete from public.login_attempts;
delete from public.devices;

-- 3. Seed a few fresh, unlinked devices.
-- api_key is intentionally omitted — the column has a server-side
-- default (pgcrypto CSPRNG) that generates it on insert.
insert into public.devices
  (device_code, label, location_desc, latitude, longitude, co_threshold, temp_threshold, bfp_contact, is_active)
values
  ('AGS-001', 'Unit 1 — Barangay Hall',      'Barangay Holy Spirit Hall, Commonwealth Ave, Quezon City',        14.6994, 121.0800, 200, 60.0, '+63 2 8555 1234', true),
  ('AGS-002', 'Unit 2 — Public Market',      'Holy Spirit Public Market, Quezon City',                          14.6971, 121.0765, 200, 60.0, '+63 2 8555 1234', true),
  ('AGS-003', 'Unit 3 — Elementary School',  'Holy Spirit Elementary School, Quezon City',                      14.7015, 121.0822, 200, 60.0, '+63 2 8555 1234', true),
  ('AGS-004', 'Unit 4 — Health Center',      'Barangay Holy Spirit Health Center, Quezon City',                 14.6958, 121.0791, 200, 60.0, '+63 2 8555 1234', true),
  ('AGS-005', 'Unit 5 — Residential Block A','Residential Block A, Commonwealth Ave, Quezon City',              14.7002, 121.0748, 200, 60.0, '+63 2 8555 1234', true);

commit;

-- STAGING ONLY. Baseline = every migration before 20261019 (the schema the repo describes). Run on the NEW project, once.
-- GUARD: this file may only run on a brand-new, empty project. It aborts on a database that already has the app's tables.
do $g$ begin
  if to_regclass('public.profiles') is not null or to_regclass('public.devices') is not null then
    raise exception 'REFUSING TO RUN: public.profiles/devices already exist. This file is for a fresh staging project only.';
  end if;
end $g$;
create schema if not exists _staging_marker;
comment on schema _staging_marker is 'Marks this database as the throwaway staging project; created by staging_setup.sql';

-- ===== 20260717000000_init.sql =====
-- =============================================================
-- AgapSense — Full Database Schema
-- Run this ONCE in the Supabase SQL Editor on a fresh project.
-- =============================================================

-- =====================
-- 1. TABLES
-- =====================

-- Devices table
CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_code TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    location_desc TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    co_threshold INTEGER NOT NULL DEFAULT 200,
    temp_threshold FLOAT NOT NULL DEFAULT 60.0,
    bfp_contact TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    last_seen_at TIMESTAMPTZ
);

-- Profiles table (extends auth.users)
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'bfp_responder', 'resident')),
    contact_number TEXT,
    device_id UUID REFERENCES devices(id),
    address TEXT,
    status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'pending', 'rejected')),
    setup_complete BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Sensor readings table
CREATE TABLE sensor_readings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES devices(id),
    co_ppm FLOAT NOT NULL,
    temp_celsius FLOAT NOT NULL,
    latitude FLOAT,
    longitude FLOAT,
    gps_valid BOOLEAN NOT NULL DEFAULT FALSE,
    on_battery BOOLEAN NOT NULL DEFAULT FALSE,
    sensor_ready BOOLEAN NOT NULL DEFAULT TRUE,
    recorded_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sensor_readings_device_recorded_at
    ON sensor_readings (device_id, recorded_at DESC);

-- Alert events table
CREATE TABLE alert_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES devices(id),
    alert_tier INTEGER NOT NULL CHECK (alert_tier IN (1, 2)),
    co_ppm FLOAT NOT NULL,
    temp_celsius FLOAT NOT NULL,
    latitude FLOAT,
    longitude FLOAT,
    gps_valid BOOLEAN NOT NULL DEFAULT FALSE,
    address_resolved TEXT,
    telegram_sent BOOLEAN NOT NULL DEFAULT FALSE,
    sms_sent_owner BOOLEAN NOT NULL DEFAULT FALSE,
    sms_sent_bfp BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    triggered_at TIMESTAMPTZ DEFAULT now()
);

-- Login attempts table
CREATE TABLE login_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    ip_address TEXT,
    success BOOLEAN NOT NULL,
    attempted_at TIMESTAMPTZ DEFAULT now()
);

-- Settings table
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Station settings table (Singleton)
CREATE TABLE station_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    team_name TEXT NOT NULL,
    commander_name TEXT NOT NULL,
    contact_number TEXT NOT NULL,
    address TEXT NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    alert_radius_km FLOAT NOT NULL DEFAULT 5.0,
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE station_settings
    ADD CONSTRAINT station_settings_id_check CHECK (id = 1);

-- Registration requests table
CREATE TABLE registration_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    requested_role TEXT NOT NULL CHECK (requested_role IN ('resident', 'bfp_responder')),
    device_code TEXT,
    organization TEXT,
    position TEXT,
    verification_info TEXT,
    admin_notes TEXT,
    reviewed_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    reviewed_at TIMESTAMPTZ
);


-- =====================
-- 2. VIEWS
-- =====================

-- devices_safe: Exposes devices without the raw api_key
CREATE VIEW devices_safe AS
SELECT
    id, device_code, label, location_desc,
    NULL::text as api_key,
    co_threshold, temp_threshold, bfp_contact,
    is_active, created_at, last_seen_at
FROM devices;


-- =====================
-- 3. FUNCTIONS & TRIGGERS
-- =====================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Device API Key Generation ──
CREATE OR REPLACE FUNCTION generate_device_api_key()
RETURNS TEXT AS $$
BEGIN
  RETURN encode(gen_random_bytes(24), 'base64');
END;
$$ LANGUAGE plpgsql VOLATILE;

-- Auto-generate API key for new devices
CREATE OR REPLACE FUNCTION set_device_api_key()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.api_key IS NULL THEN
    NEW.api_key := generate_device_api_key();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_device_api_key
  BEFORE INSERT ON devices
  FOR EACH ROW EXECUTE FUNCTION set_device_api_key();

-- ── RPC: Regenerate API Key (Admin Only) ──
CREATE OR REPLACE FUNCTION regenerate_device_api_key(p_device_id UUID)
RETURNS TEXT AS $$
DECLARE
  new_key TEXT;
  v_role TEXT;
BEGIN
  -- Verify caller is admin
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role != 'admin' THEN
    RAISE EXCEPTION 'Unauthorized: Only admins can regenerate API keys';
  END IF;

  new_key := generate_device_api_key();

  UPDATE devices SET api_key = new_key WHERE id = p_device_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Device not found';
  END IF;

  RETURN new_key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── Get User Role (Helper for RLS) ──
CREATE OR REPLACE FUNCTION get_auth_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE;

-- ── Get Dashboard Stats (RPC) ──
CREATE OR REPLACE FUNCTION get_dashboard_stats()
RETURNS JSON AS $$
DECLARE
  total_devices INT;
  active_alerts INT;
  resolved_alerts INT;
  total_users INT;
BEGIN
  SELECT count(*) INTO total_devices FROM devices;
  SELECT count(*) INTO active_alerts FROM alert_events WHERE resolved_at IS NULL;
  SELECT count(*) INTO resolved_alerts FROM alert_events WHERE resolved_at IS NOT NULL;
  SELECT count(*) INTO total_users FROM profiles;

  RETURN json_build_object(
    'total_devices', total_devices,
    'active_alerts', active_alerts,
    'resolved_alerts', resolved_alerts,
    'total_users', total_users
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Handle New User Registration (Trigger) ──
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  -- For resident/bfp_responder, initial creation happens normally,
  -- but admin can create users directly. We rely on the app to insert
  -- into profiles manually after auth sign up, or we can use this trigger
  -- for fallback/default profile creation if needed.
  --
  -- In this project, the frontend explicitly calls profile creation
  -- so this trigger is kept minimal to avoid race conditions.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Protect Critical Profile Fields (Trigger) ──
CREATE OR REPLACE FUNCTION protect_profile_fields()
RETURNS trigger AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- Let superuser/service_role bypass
  IF current_setting('role') = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();

  -- If not an admin, prevent changing own role, status, or device assignment
  IF v_role != 'admin' THEN
    NEW.role = OLD.role;
    NEW.status = OLD.status;
    NEW.device_id = OLD.device_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER protect_profile_fields_trigger
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION protect_profile_fields();


-- =====================
-- 4. ROW LEVEL SECURITY
-- =====================

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensor_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE station_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_requests ENABLE ROW LEVEL SECURITY;

-- ── Devices ──
CREATE POLICY "Admin full access on devices"
  ON devices FOR ALL USING (get_auth_role() = 'admin');
CREATE POLICY "BFP Responder can read devices"
  ON devices FOR SELECT USING (get_auth_role() = 'bfp_responder');
CREATE POLICY "Resident can read own device"
  ON devices FOR SELECT USING (
    get_auth_role() = 'resident'
    AND id = (SELECT device_id FROM profiles WHERE profiles.id = auth.uid())
  );

-- ── Profiles ──
CREATE POLICY "Authenticated users can read profiles"
  ON profiles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "Admin delete access on profiles"
  ON profiles FOR DELETE USING (get_auth_role() = 'admin');
CREATE POLICY "Admin insert access on profiles"
  ON profiles FOR INSERT WITH CHECK (get_auth_role() = 'admin');

-- ── Sensor Readings ──
CREATE POLICY "Admin can read all sensor readings"
  ON sensor_readings FOR SELECT USING (get_auth_role() = 'admin');
CREATE POLICY "BFP Responder can read all sensor readings"
  ON sensor_readings FOR SELECT USING (get_auth_role() = 'bfp_responder');
CREATE POLICY "Resident can read own device sensor readings"
  ON sensor_readings FOR SELECT USING (
    device_id = (SELECT device_id FROM profiles WHERE id = auth.uid())
  );
CREATE POLICY "Allow devices to insert readings"
  ON sensor_readings FOR INSERT WITH CHECK (true);

-- ── Alert Events ──
CREATE POLICY "Admin full access on alert events"
  ON alert_events FOR ALL USING (get_auth_role() = 'admin');
CREATE POLICY "BFP Responder can read all alert events"
  ON alert_events FOR SELECT USING (get_auth_role() = 'bfp_responder');
CREATE POLICY "Resident can read own device alert events"
  ON alert_events FOR SELECT USING (
    device_id = (SELECT device_id FROM profiles WHERE id = auth.uid())
  );
CREATE POLICY "Allow system to insert alerts"
  ON alert_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow system to update alerts"
  ON alert_events FOR UPDATE USING (
    get_auth_role() IN ('admin', 'bfp_responder')
  );

-- ── Login Attempts ──
CREATE POLICY "Admin can read login attempts"
  ON login_attempts FOR SELECT USING (get_auth_role() = 'admin');
CREATE POLICY "Anyone can insert login attempts"
  ON login_attempts FOR INSERT WITH CHECK (true);

-- ── Settings ──
CREATE POLICY "Admin full access on settings"
  ON settings FOR ALL USING (get_auth_role() = 'admin');
CREATE POLICY "Authenticated users can read settings"
  ON settings FOR SELECT USING (auth.role() = 'authenticated');

-- ── Station Settings ──
CREATE POLICY "Admin full access on station settings"
  ON station_settings FOR ALL USING (get_auth_role() = 'admin');
CREATE POLICY "BFP Responder full access on station settings"
  ON station_settings FOR ALL USING (get_auth_role() = 'bfp_responder');
CREATE POLICY "Residents can read station settings"
  ON station_settings FOR SELECT USING (get_auth_role() = 'resident');

-- ── Registration Requests ──
CREATE POLICY "Admin full access on registration requests"
  ON registration_requests FOR ALL USING (get_auth_role() = 'admin');
CREATE POLICY "Users can create registration requests"
  ON registration_requests FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can read own requests"
  ON registration_requests FOR SELECT USING (user_id = auth.uid());


-- =====================
-- 5. INITIAL DATA
-- =====================

INSERT INTO station_settings (
    id, team_name, commander_name, contact_number, address, latitude, longitude, alert_radius_km
) VALUES (
    1,
    'Central Fire Station',
    'F/INSP Juan Dela Cruz',
    '+639000000000',
    'City Hall Compound',
    14.5995,
    120.9842,
    5.0
) ON CONFLICT (id) DO NOTHING;

-- Initial Admin Setup (Password: Admin@123)
-- (Run this block manually in Supabase SQL editor after creating the Auth user,
-- replacing the UUID with the generated Auth UID)
/*
INSERT INTO profiles (id, full_name, role, status, setup_complete)
VALUES ('YOUR_AUTH_UID_HERE', 'System Administrator', 'admin', 'approved', true);
*/

-- ===== 20260917010000_lock_down_device_write_access.sql =====
-- =============================================================
-- CRIT-03 fix: sensor_readings / alert_events INSERT was
-- application-layer-only (x-device-key checked by the Edge
-- Functions), while the DB-level RLS policy was WITH CHECK (true)
-- and the anon/authenticated Postgres roles held a blanket INSERT
-- grant on both tables. That meant anyone holding the public anon
-- key could POST directly to PostgREST and forge sensor readings
-- or alert events for any device_id, completely bypassing the
-- device-key check.
--
-- Fix: revoke the INSERT grant from anon/authenticated so only the
-- service-role key (used exclusively by ingest-reading and
-- trigger-alert, which already perform the real x-device-key check)
-- can write to these tables. service_role bypasses RLS entirely via
-- its BYPASSRLS attribute, so this doesn't affect the Edge Functions.
-- The old "WITH CHECK (true)" policies are replaced with explicit
-- deny policies so the intent is documented in the policy itself,
-- not just in a grant that's easy to overlook later.
-- =============================================================

revoke insert on public.sensor_readings from anon, authenticated;
revoke insert on public.alert_events    from anon, authenticated;

drop policy if exists "Allow devices to insert readings" on public.sensor_readings;
create policy "Direct client inserts are blocked - use ingest-reading"
  on public.sensor_readings
  for insert
  to anon, authenticated
  with check (false);

drop policy if exists "Allow system to insert alerts" on public.alert_events;
create policy "Direct client inserts are blocked - use trigger-alert"
  on public.alert_events
  for insert
  to anon, authenticated
  with check (false);

-- ===== 20260917020000_mask_device_api_key.sql =====
-- =============================================================
-- HIGH-01 fix: RLS is row-level, not column-level. The existing
-- "BFP Responder can read devices" and "Resident can read own
-- device" SELECT policies correctly scope which ROWS are visible,
-- but every visible row is returned in full — including the
-- plaintext api_key column, which is the sole authentication
-- secret for IoT ingestion/alert endpoints. Any responder can read
-- every device's api_key; a resident can read their own device's.
--
-- Postgres column-level GRANTs can't fix this because admin,
-- bfp_responder and resident are all just app-level values in
-- profiles.role - at the Postgres connection level they're all the
-- same "authenticated" role, so a column grant can't distinguish
-- between them.
--
-- Fix: a security_invoker view that runs with the caller's own
-- privileges (so the base table's row-level RLS policies still
-- apply unchanged) and additionally masks api_key to NULL unless
-- the caller's app role is 'admin'. Non-admin frontend reads
-- (Responder/Resident pages) should query devices_safe instead of
-- devices. Admin-only pages (Devices.tsx, Dashboard.tsx, Alerts.tsx,
-- InteractiveMap.tsx, Logs.tsx, Users.tsx) keep reading the base
-- devices table directly, and device creation/writes still go
-- through the base table (this view is not writable).
-- =============================================================

create or replace view public.devices_safe
with (security_invoker = on) as
select
  id,
  device_code,
  label,
  location_desc,
  case when public.get_auth_role() = 'admin' then api_key else null end as api_key,
  co_threshold,
  temp_threshold,
  bfp_contact,
  is_active,
  created_at,
  last_seen_at
from public.devices;

grant select on public.devices_safe to authenticated;

-- ===== 20260917030000_require_approval_for_profile_settings_reads.sql =====
-- =============================================================
-- HIGH-03 fix: profiles, settings, and station_settings all had a
-- SELECT policy scoped to `auth.role() = 'authenticated'` rather
-- than going through get_auth_role(). Unlike every other
-- authenticated-tier policy in this schema, that check doesn't
-- require profiles.status = 'approved' - so a pending or rejected
-- account (who can still log in, just can't navigate the app past
-- AuthGuard) could read every user's full profile row (name, phone,
-- address, device link), system settings, and station contact info
-- directly via the REST API.
--
-- Fix: swap the bare auth.role() check for get_auth_role() IS NOT
-- NULL, matching the pattern already used on devices/sensor_readings
-- /alert_events. get_auth_role() returns NULL for any non-approved
-- user regardless of role, and the actual role value for any
-- approved admin/bfp_responder/resident - so this only removes
-- access for pending/rejected accounts, no one else.
-- =============================================================

drop policy if exists "Authenticated users can read profiles" on public.profiles;
create policy "Approved users can read profiles"
  on public.profiles
  for select
  using (get_auth_role() is not null);

drop policy if exists "Anyone authenticated can read settings" on public.settings;
create policy "Approved users can read settings"
  on public.settings
  for select
  using (get_auth_role() is not null);

drop policy if exists "Station settings are viewable by everyone." on public.station_settings;
create policy "Approved users can view station settings"
  on public.station_settings
  for select
  using (get_auth_role() is not null);

-- ===== 20260917040000_prevent_duplicate_device_assignment.sql =====
-- =============================================================
-- MED-01 fix: profiles.device_id had no uniqueness constraint, and
-- assign-device (the admin path) performed no collision check -
-- unlike link-device (the resident self-service path), which
-- already rejects assigning an already-claimed device. An admin
-- could legally assign the same device to two resident accounts,
-- which would then make trigger-alert's owner-contact lookup
-- (.eq('device_id', ...).eq('role','resident').maybeSingle()) error
-- on that device's alerts, since maybeSingle() requires 0 or 1 rows.
--
-- assign-device now performs the same collision check link-device
-- already has (see the accompanying Edge Function change). This
-- index is the DB-level backstop in case some other future write
-- path forgets the same check.
-- =============================================================

create unique index if not exists profiles_device_id_resident_unique
  on public.profiles (device_id)
  where role = 'resident' and device_id is not null;

-- ===== 20260917050000_secure_device_api_key_generation.sql =====
-- =============================================================
-- MED-02 fix: devices.api_key was generated in the admin's browser
-- with 'sk_' + Math.random().toString(36) (Devices.tsx) - not a
-- CSPRNG, and this is the sole authentication secret for IoT
-- ingestion/alert endpoints.
--
-- Fix: generate it in Postgres via pgcrypto's gen_random_bytes()
-- instead, as a column default. Devices.tsx no longer needs to (and
-- should not) set api_key on insert - see the accompanying frontend
-- change.
-- =============================================================

create extension if not exists pgcrypto;

alter table public.devices
  alter column api_key set default ('sk_' || encode(gen_random_bytes(24), 'hex'));

-- ===== 20260917060000_login_lockout_check_function.sql =====
-- =============================================================
-- MED-03 fix: Login.tsx's lockout (3 failures -> 10s, 5 -> 30s, 7 ->
-- "locked") was React state only - it reset on every page refresh
-- and never persisted anywhere. login_attempts existed with RLS
-- ready for it but nothing in the app ever wrote to it.
--
-- Fix: a SECURITY DEFINER function the client can call to check
-- whether an email is currently rate-limited, based on real rows in
-- login_attempts, without needing SELECT access to the table itself
-- (which stays admin-only - this function only ever returns a
-- boolean and a wait time, never raw attempt history, so it can't be
-- used to enumerate whether an email has an account).
--
-- The client still inserts each attempt's outcome directly via the
-- existing "Allow inserting login attempts" policy (WITH CHECK true)
-- - see the accompanying Login.tsx change. This is a same-origin
-- advisory lockout (Supabase Auth's own sign-in itself isn't gated
-- by it, only this app's UI is) backed by real rather than
-- in-memory data, and a real audit trail for the admin Logs page.
-- =============================================================

create or replace function public.check_login_lockout(p_email text)
returns table(locked boolean, retry_after_seconds int)
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_failures int;
  lockout_seconds int := 0;
begin
  select count(*) into recent_failures
  from login_attempts
  where email = p_email
    and success = false
    and attempted_at > now() - interval '15 minutes';

  if recent_failures >= 7 then
    lockout_seconds := 900;
  elsif recent_failures >= 5 then
    lockout_seconds := 30;
  elsif recent_failures >= 3 then
    lockout_seconds := 10;
  end if;

  return query select (lockout_seconds > 0), lockout_seconds;
end;
$$;

grant execute on function public.check_login_lockout(text) to anon, authenticated;

-- ===== 20260917070000_add_device_install_coordinates.sql =====
-- =============================================================
-- LOW-02 fix: the Device TypeScript interface and the admin device
-- creation form (Devices.tsx) both already have latitude/longitude
-- fields, but the devices table never had matching columns - the
-- form silently dropped them before insert. InteractiveMap.tsx
-- compensated by fabricating a fake position for every device from
-- a hash of its id, since d.latitude/d.longitude were always
-- undefined from a real query. That made the admin map show
-- plausible-looking but entirely fictional device locations.
--
-- Adds the real columns (nullable - a device may not have a known
-- install location yet) so the form's values actually persist and
-- the map can show real positions instead of fabricated ones.
-- =============================================================

alter table public.devices
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

-- Keep devices_safe (added in 20260917020000_mask_device_api_key.sql)
-- in sync with the base table's columns now that these two exist.
create or replace view public.devices_safe
with (security_invoker = on) as
select
  id,
  device_code,
  label,
  location_desc,
  case when public.get_auth_role() = 'admin' then api_key else null end as api_key,
  co_threshold,
  temp_threshold,
  bfp_contact,
  is_active,
  created_at,
  last_seen_at,
  latitude,
  longitude
from public.devices;

-- ===== 20260917080000_resident_alert_threshold_rpc.sql =====
-- =============================================================
-- NEW-01 fix: ResidentAlertSettings.tsx lets a resident tune their
-- own device's temp_threshold/co_threshold, but there is no RLS
-- UPDATE policy granting residents any write access to devices at
-- all (only "Admin full access on devices" covers UPDATE) - the
-- save call was already broken by RLS.
--
-- A bare UPDATE policy scoped to "your own device" isn't safe here:
-- Postgres RLS is row-level, not column-level, so it can't stop a
-- resident's UPDATE from also touching device_code, api_key,
-- is_active, or bfp_contact (the fire station's own contact number,
-- used by gsmSendBfpSms() for real Tier 2 dispatch - see the
-- accompanying frontend fix, which stops this page from touching
-- that column at all).
--
-- Fix: a narrow SECURITY DEFINER function that only ever touches
-- temp_threshold/co_threshold, derives the target device from the
-- caller's own profile (never a client-supplied device id), and
-- enforces the same bounds the UI's sliders already promise
-- (0-100 C, 0-1000 ppm) as defense in depth.
-- =============================================================

create or replace function public.update_own_device_alert_settings(
  p_temp_threshold double precision,
  p_co_threshold integer
)
returns public.devices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device_id uuid;
  v_result public.devices;
begin
  select device_id into v_device_id
  from profiles
  where id = auth.uid() and role = 'resident' and status = 'approved';

  if v_device_id is null then
    raise exception 'No device linked to an approved resident account';
  end if;

  if p_temp_threshold is null or p_temp_threshold < 0 or p_temp_threshold > 100 then
    raise exception 'temp_threshold must be between 0 and 100';
  end if;

  if p_co_threshold is null or p_co_threshold < 0 or p_co_threshold > 1000 then
    raise exception 'co_threshold must be between 0 and 1000';
  end if;

  update devices
  set temp_threshold = p_temp_threshold,
      co_threshold = p_co_threshold
  where id = v_device_id
  returning * into v_result;

  return v_result;
end;
$$;

grant execute on function public.update_own_device_alert_settings(double precision, integer) to authenticated;

-- ===== 20260924000000_device_api_key_regeneration_rpc.sql =====
-- =============================================================
-- SW-2.6.3 gap: devices.api_key is only ever set once, via the
-- column's own DEFAULT ('sk_' || encode(gen_random_bytes(24), 'hex'),
-- added in 20260917050000) at INSERT time. There is no way to
-- generate a fresh key for an already-registered device - the admin
-- UI can only set other columns via plain UPDATE.
--
-- A plain client-side UPDATE can't regenerate this safely: the same
-- reasoning as 20260917050000 applies (a real key needs a CSPRNG,
-- which must run in Postgres via pgcrypto, not the browser). This is
-- a narrow SECURITY DEFINER function that only ever touches api_key,
-- checks admin role explicitly (defense in depth alongside the
-- existing "Admin full access on devices" RLS policy), and returns
-- the new key so the admin UI can show/copy it once.
-- =============================================================

create or replace function public.regenerate_device_api_key(p_device_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_key text;
begin
  if public.get_auth_role() <> 'admin' then
    raise exception 'Only an admin can regenerate a device API key';
  end if;

  v_new_key := 'sk_' || encode(gen_random_bytes(24), 'hex');

  update devices
  set api_key = v_new_key
  where id = p_device_id;

  if not found then
    raise exception 'Device not found';
  end if;

  return v_new_key;
end;
$$;

grant execute on function public.regenerate_device_api_key(uuid) to authenticated;

-- ===== 20260924010000_admin_login_unlock.sql =====
-- =============================================================
-- SW-2.6.2 gap: the spec's progressive lockout ("7 failures -> locked
-- account message requiring Administrator intervention") implies an
-- admin can manually clear a lockout. check_login_lockout()
-- (20260917060000) is purely time-window based (recent failures in
-- the last 15 minutes) with no way to end it early - it just expires
-- on its own.
--
-- Fix: a small overrides table an admin unlock writes a fresh
-- timestamp into, and check_login_lockout() only counts failures
-- after that timestamp (in addition to the normal 15-minute window).
-- This resets the lockout immediately without deleting login_attempts
-- rows, which stay intact as the audit trail the earlier migration's
-- comment describes.
-- =============================================================

create table if not exists public.login_lockout_overrides (
  email text primary key,
  unlocked_at timestamptz not null default now(),
  unlocked_by uuid references auth.users(id)
);

alter table public.login_lockout_overrides enable row level security;

create policy "Admin can manage lockout overrides"
  on public.login_lockout_overrides
  for all
  using (public.get_auth_role() = 'admin');

create or replace function public.admin_unlock_login(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.get_auth_role() <> 'admin' then
    raise exception 'Only an admin can unlock a login lockout';
  end if;

  insert into login_lockout_overrides (email, unlocked_at, unlocked_by)
  values (p_email, now(), auth.uid())
  on conflict (email) do update
    set unlocked_at = excluded.unlocked_at,
        unlocked_by = excluded.unlocked_by;
end;
$$;

grant execute on function public.admin_unlock_login(text) to authenticated;

create or replace function public.check_login_lockout(p_email text)
returns table(locked boolean, retry_after_seconds int)
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_failures int;
  lockout_seconds int := 0;
  v_window_start timestamptz;
  v_override_at timestamptz;
begin
  select unlocked_at into v_override_at
  from login_lockout_overrides
  where email = p_email;

  v_window_start := greatest(now() - interval '15 minutes', coalesce(v_override_at, now() - interval '15 minutes'));

  select count(*) into recent_failures
  from login_attempts
  where email = p_email
    and success = false
    and attempted_at > v_window_start;

  if recent_failures >= 7 then
    lockout_seconds := 900;
  elsif recent_failures >= 5 then
    lockout_seconds := 30;
  elsif recent_failures >= 3 then
    lockout_seconds := 10;
  end if;

  return query select (lockout_seconds > 0), lockout_seconds;
end;
$$;

-- ===== 20260924020000_fix_admin_check_null_bypass.sql =====
-- =============================================================
-- CRITICAL fix: admin_unlock_login and regenerate_device_api_key
-- both gated their admin-only logic with:
--
--   if public.get_auth_role() <> 'admin' then raise exception ...
--
-- get_auth_role() returns NULL for any unauthenticated, pending, or
-- rejected caller. In SQL, NULL <> 'admin' evaluates to NULL (not
-- TRUE), and PL/pgSQL's `IF NULL THEN` is treated as false - so the
-- exception never raised and both functions fell through as if the
-- caller *were* admin.
--
-- Confirmed live against production: an anonymous, unauthenticated
-- client could call admin_unlock_login for any email and
-- successfully clear that account's brute-force lockout override,
-- completely defeating check_login_lockout(). regenerate_device_api_key
-- has the identical bug, currently non-exploitable only by the
-- accident of a second, unrelated bug fixed below.
--
-- Fix: use `IS DISTINCT FROM` instead of `<>`, which treats NULL
-- correctly (NULL IS DISTINCT FROM 'admin' is TRUE, so the exception
-- now raises for any non-admin caller, NULL included).
--
-- Also fixes a second bug found alongside it while verifying the
-- above: regenerate_device_api_key declares `set search_path =
-- public`, which doesn't include the schema gen_random_bytes()
-- actually resolves in on this project - so even a genuine admin's
-- call failed with "function gen_random_bytes(integer) does not
-- exist" immediately after passing the (now-fixed) admin check.
-- devices.api_key's column DEFAULT isn't affected by this since it
-- runs with the calling session's own search_path, not a
-- function-local override.
-- =============================================================

create or replace function public.admin_unlock_login(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.get_auth_role() is distinct from 'admin' then
    raise exception 'Only an admin can unlock a login lockout';
  end if;

  insert into login_lockout_overrides (email, unlocked_at, unlocked_by)
  values (p_email, now(), auth.uid())
  on conflict (email) do update
    set unlocked_at = excluded.unlocked_at,
        unlocked_by = excluded.unlocked_by;
end;
$$;

create or replace function public.regenerate_device_api_key(p_device_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_new_key text;
begin
  if public.get_auth_role() is distinct from 'admin' then
    raise exception 'Only an admin can regenerate a device API key';
  end if;

  v_new_key := 'sk_' || encode(gen_random_bytes(24), 'hex');

  update devices
  set api_key = v_new_key
  where id = p_device_id;

  if not found then
    raise exception 'Device not found';
  end if;

  return v_new_key;
end;
$$;

-- Clean up the lockout override created by anonymous exploitation
-- during live testing (dbtest-valid@example.com is a throwaway test
-- address used to demonstrate the bug, not a real account).
delete from public.login_lockout_overrides where email = 'dbtest-valid@example.com';

-- ===== 20260924040000_restrict_devices_base_table_to_admin.sql =====
-- =============================================================
-- CRITICAL fix: devices_safe (20260917020000) masks api_key to
-- NULL for non-admin roles, but only when the caller queries the
-- devices_safe VIEW. Row Level Security is row-level, not
-- column-level: the base `devices` table still carries its own
-- SELECT policies for bfp_responder ("BFP Responder can read
-- devices") and resident ("Resident can read own device"), so any
-- resident or responder can bypass the masking entirely just by
-- querying `/rest/v1/devices` directly instead of
-- `/rest/v1/devices_safe` - the exact same rows, full plaintext
-- api_key included. A responder's policy in particular grants every
-- device, not just their own, so this exposed every device's IoT
-- ingestion/alert secret to any approved responder account.
--
-- Confirmed live: a disposable resident test account's own device
-- returned a null api_key via devices_safe, but the real key via a
-- direct query against devices.
--
-- Fix: remove the non-admin SELECT policies from the base table.
-- devices_safe is a `security_invoker` view, so it still enforces
-- the same row-level visibility (a resident's own device, a
-- responder's full list) via the base table's RLS at query time -
-- only now there is no read path into `devices` left for a
-- non-admin role to bypass through. Admin access is untouched
-- ("Admin full access on devices" already covers admin SELECT).
--
-- The one frontend caller that read the base table directly for a
-- non-admin page (ResidentAccount.tsx, device_code only - no key
-- involved) is switched to devices_safe in the same change so it
-- keeps working after this policy is dropped.
-- =============================================================

drop policy if exists "BFP Responder can read devices" on public.devices;
drop policy if exists "Resident can read own device" on public.devices;

-- ===== 20260924050000_devices_threshold_check_constraints.sql =====
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

-- ===== 20260924060000_fix_devices_safe_visibility_regression.sql =====
-- =============================================================
-- Regression fix: 20260924040000 closed the api_key masking bypass
-- by dropping the non-admin SELECT policies ("BFP Responder can
-- read devices", "Resident can read own device") from the base
-- `devices` table. That was correct for the base table, but
-- devices_safe is a `security_invoker` view - its own row
-- visibility depends entirely on the CALLING role's RLS/grants on
-- the base table. With those policies gone, a resident or responder
-- querying devices_safe now gets ZERO rows, not just a masked
-- api_key - the whole non-admin device-read path broke.
--
-- Confirmed live with disposable resident and responder test
-- accounts: devices_safe returned [] for both, immediately after
-- 20260924040000 was applied.
--
-- Fix: switch devices_safe to a non-invoker view. A non-invoker view
-- runs with the view owner's privileges against the base table
-- (bypassing the caller's own RLS/grants on `devices` entirely -
-- the same mechanism that made column masking necessary in the
-- first place), so the view now does its own row-scoping directly
-- in its WHERE clause instead of relying on the base table's RLS to
-- do it. This is the same row-scoping logic the two dropped
-- policies used to express. api_key masking (the CASE expression)
-- is unchanged. The base `devices` table still has zero non-admin
-- SELECT policies - devices_safe no longer needs the caller to have
-- any privilege on it at all to return the right rows.
-- =============================================================

create or replace view public.devices_safe
with (security_invoker = off) as
select
  id,
  device_code,
  label,
  location_desc,
  case when public.get_auth_role() = 'admin' then api_key else null end as api_key,
  co_threshold,
  temp_threshold,
  bfp_contact,
  is_active,
  created_at,
  last_seen_at,
  latitude,
  longitude
from public.devices
where
  public.get_auth_role() in ('admin', 'bfp_responder')
  or (
    public.get_auth_role() = 'resident'
    and id = (select device_id from public.profiles where profiles.id = auth.uid())
  );

grant select on public.devices_safe to authenticated;

-- ===== 20260924070000_fix_own_profile_read_for_pending_rejected.sql =====
-- =============================================================
-- Regression from 20260917030000 (HIGH-03 fix): that migration
-- correctly stopped pending/rejected users from bulk-reading every
-- profile row, by requiring get_auth_role() IS NOT NULL (i.e.
-- approved) on the profiles SELECT policy. But it removed ALL
-- self-read access for a pending/rejected account too - including
-- their own row - since get_auth_role() is NULL for them.
--
-- AuthContext.fetchProfile does `.single()` on the caller's own
-- profile right after a successful Supabase Auth sign-in. For a
-- pending/rejected account, that query now returns 0 rows (RLS
-- filters it out), `.single()` throws, and `profile` stays null
-- forever. Login.tsx's redirect effect only fires once BOTH
-- `session` and `profile` are set, so it never fires - the user is
-- stuck on an infinite "Authenticating..." spinner with no
-- feedback at all. The "Account Pending"/"Account Rejected" screens
-- in AuthGuard.tsx are unreachable via the normal login flow,
-- because nothing ever navigates the user to a route AuthGuard
-- protects.
--
-- Confirmed live with disposable pending and rejected test
-- accounts: both hang on "Authenticating..." indefinitely; the
-- browser console shows PGRST116 "Cannot coerce the result to a
-- single JSON object" from the 0-row profiles query.
--
-- Fix: let a user always read their own profile row regardless of
-- status, in addition to the existing approved-only bulk-read. This
-- doesn't reopen HIGH-03 - the added clause only ever matches the
-- caller's own id, never another user's row.
-- =============================================================

drop policy if exists "Approved users can read profiles" on public.profiles;
create policy "Approved users can read profiles"
  on public.profiles
  for select
  using (get_auth_role() is not null or id = auth.uid());

-- ===== 20260924080000_lock_down_login_attempts_and_lockout_check.sql =====
-- =============================================================
-- SW-2.6.2 fix: login lockout had no real enforcement. Login.tsx
-- now goes through the new `login` Edge Function (service role)
-- instead of calling signInWithPassword() and inserting into
-- login_attempts directly from the browser - see that function for
-- the full writeup of what was broken and confirmed live.
--
-- With the client no longer needing either of these directly, lock
-- them down the same way CRIT-03 (20260924000000, further back)
-- locked down sensor_readings/alert_events inserts once their real
-- write path moved server-side:
--
-- - login_attempts INSERT: previously WITH CHECK (true) for anyone,
--   which let a caller inject fake success rows (audit poisoning)
--   or fake failure rows against an arbitrary victim's email (a
--   trivial denial-of-service: lock someone else's account on
--   demand with a few unauthenticated POSTs). The `login` function
--   uses the service role, which bypasses this grant regardless.
-- - check_login_lockout EXECUTE: previously callable by anyone,
--   letting a caller enumerate whether an arbitrary email currently
--   has 3+ recent failures - a minor account-activity info leak.
--   Nothing in the browser calls this RPC directly anymore either;
--   the `login` function calls it via the service role, which
--   isn't affected by revoking the anon/authenticated grant.
-- =============================================================

revoke insert on public.login_attempts from anon, authenticated;

drop policy if exists "Allow inserting login attempts" on public.login_attempts;
create policy "Direct client inserts are blocked - use the login function"
  on public.login_attempts
  for insert
  to anon, authenticated
  with check (false);

revoke execute on function public.check_login_lockout(text) from anon, authenticated;

-- ===== 20260924090000_fix_login_lockout_escalation.sql =====
-- =============================================================
-- SW-2.6.2 follow-up: the `login` Edge Function (20260924080000
-- and the function itself) fixed check_login_lockout being
-- skippable, but testing that fix live exposed a second, separate
-- bug underneath: check_login_lockout's tiers were never actually
-- reachable past the first one hit, even with perfect enforcement.
--
-- The function only ever asked "are there >= N failures in the
-- last 15 minutes", with no time decay - once recent_failures hits
-- 3, EVERY check for the next up-to-15-minutes returns locked=true
-- for the SAME flat 10s, forever, because nothing ever lets a new
-- attempt through to become failure #4. Confirmed live against the
-- newly-deployed login function: 7 real POSTs to it produced only
-- 3 recorded login_attempts rows - attempts 4-7 were all refused
-- before ever reaching GoTrue, identical to the pre-fix bug, just
-- now consistently enforced instead of skippable.
--
-- Fix: track time elapsed since the most recent failure. Once the
-- current tier's cooldown has actually elapsed, let exactly one
-- more real attempt through (locked=false) instead of refusing
-- forever. If that attempt also fails, the caller's next check
-- correctly sees one more failure, escalating to the next tier
-- (3->10s, 5->30s, 7->900s) exactly as SW-2.6.2 describes. This
-- also makes retry_after_seconds a real, decaying remaining-time
-- value instead of a flat number that never changes.
-- =============================================================

create or replace function public.check_login_lockout(p_email text)
returns table(locked boolean, retry_after_seconds int)
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_failures int;
  lockout_seconds int := 0;
  v_window_start timestamptz;
  v_override_at timestamptz;
  v_last_failure_at timestamptz;
  v_elapsed_seconds numeric;
begin
  select unlocked_at into v_override_at
  from login_lockout_overrides
  where email = p_email;

  v_window_start := greatest(now() - interval '15 minutes', coalesce(v_override_at, now() - interval '15 minutes'));

  select count(*), max(attempted_at) into recent_failures, v_last_failure_at
  from login_attempts
  where email = p_email
    and success = false
    and attempted_at > v_window_start;

  if recent_failures >= 7 then
    lockout_seconds := 900;
  elsif recent_failures >= 5 then
    lockout_seconds := 30;
  elsif recent_failures >= 3 then
    lockout_seconds := 10;
  end if;

  if lockout_seconds = 0 or v_last_failure_at is null then
    return query select false, 0;
    return;
  end if;

  v_elapsed_seconds := extract(epoch from (now() - v_last_failure_at));

  if v_elapsed_seconds >= lockout_seconds then
    -- This tier's cooldown has elapsed since the last failure: let
    -- exactly one more real attempt through. If it fails too, the
    -- next check will see recent_failures+1 and escalate correctly.
    return query select false, 0;
  else
    return query select true, ceil(lockout_seconds - v_elapsed_seconds)::int;
  end if;
end;
$$;

-- ===== 20261010000000_add_telegram_chat_id.sql =====
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS telegram_chat_id text;

-- ===== 20261011000000_add_local_ip.sql =====
ALTER TABLE devices ADD COLUMN IF NOT EXISTS local_ip TEXT;

create or replace view public.devices_safe
with (security_invoker = off) as
select
  id,
  device_code,
  label,
  location_desc,
  case when public.get_auth_role() = 'admin' then api_key else null end as api_key,
  co_threshold,
  temp_threshold,
  bfp_contact,
  is_active,
  created_at,
  last_seen_at,
  latitude,
  longitude,
  local_ip
from public.devices
where
  public.get_auth_role() in ('admin', 'bfp_responder')
  or (
    public.get_auth_role() = 'resident'
    and id = (select device_id from public.profiles where profiles.id = auth.uid())
  );

grant select on public.devices_safe to authenticated;

-- ===== 20261012000000_address_discrepancy.sql =====
-- New table to track address discrepancies and allow resident confirmation
CREATE TABLE IF NOT EXISTS address_discrepancies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    resident_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    gps_derived_address TEXT NOT NULL,
    registered_address TEXT NOT NULL,
    latitude FLOAT NOT NULL,
    longitude FLOAT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

ALTER TABLE address_discrepancies ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Admin full access on address_discrepancies"
    ON address_discrepancies FOR ALL USING (get_auth_role() = 'admin');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "Resident can read own discrepancies"
    ON address_discrepancies FOR SELECT USING (
      resident_id = auth.uid()
    );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "Resident can update own discrepancies"
    ON address_discrepancies FOR UPDATE USING (
      resident_id = auth.uid()
    );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ===== 20261012000001_responder_incident_status.sql =====
-- Add incident response columns to alert_events
ALTER TABLE alert_events
ADD COLUMN incident_status TEXT NOT NULL DEFAULT 'active' CHECK (incident_status IN ('active', 'acknowledged', 'responding', 'resolved', 'false_alarm')),
ADD COLUMN acknowledged_by UUID REFERENCES profiles(id),
ADD COLUMN acknowledged_at TIMESTAMPTZ,
ADD COLUMN outcome_notes TEXT;

-- Restrict bfp_responder update policy to only allow updating these specific columns
DROP POLICY IF EXISTS "Allow system to update alerts" ON alert_events;
DROP POLICY IF EXISTS "Allow system and admin to update alerts" ON alert_events;
DROP POLICY IF EXISTS "BFP Responder can update incident status" ON alert_events;

CREATE POLICY "Allow system and admin to update alerts"
  ON alert_events FOR UPDATE USING (
    get_auth_role() IN ('admin')
  );

-- To restrict updates to specific columns in RLS without triggers, we can only easily check who is doing it.
-- For strict enforcement, we should ensure only these columns are passed, but standard RLS doesn't allow column-level checks cleanly.
-- However, we can create an RPC to update incident status instead of a direct table update to enforce this securely.

-- To fulfill the immediate security requirement, we'll keep the update policy but in a real-world scenario we'd use an RPC or REVOKE UPDATE and explicitly GRANT on columns.
CREATE POLICY "BFP Responder can update incident status"
  ON alert_events FOR UPDATE USING (
    get_auth_role() = 'bfp_responder'
  ) WITH CHECK (
    get_auth_role() = 'bfp_responder'
  );

-- Revoke general update and grant specific columns to authenticated users (this is the true way to restrict columns in postgres)
REVOKE UPDATE ON alert_events FROM authenticated;
GRANT UPDATE (incident_status, acknowledged_by, acknowledged_at, outcome_notes, resolved_at) ON alert_events TO authenticated;

-- ===== 20261012000002_push_subscriptions.sql =====
CREATE TABLE push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own subscriptions"
  ON push_subscriptions FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can view their own subscriptions"
  ON push_subscriptions FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can update their own subscriptions"
  ON push_subscriptions FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own subscriptions"
  ON push_subscriptions FOR DELETE USING (user_id = auth.uid());

-- ===== 20261013000000_fix_devices_safe_resident.sql =====
-- =============================================================
-- BUGFIX: Infinite recursion on devices_safe for residents.
--
-- The previous definition of devices_safe relied on get_auth_role(),
-- which triggered the Row Level Security (RLS) policy on the profiles
-- table. The RLS policy for profiles itself called get_auth_role(),
-- causing an infinite recursion loop when a resident queried the view,
-- ultimately resulting in 0 rows and throwing a 406 Not Acceptable.
--
-- Fix: Use a direct LEFT JOIN against public.profiles using auth.uid()
-- to eliminate the need for get_auth_role() in the WHERE clause, breaking
-- the recursion loop and correctly returning the device for the resident.
-- =============================================================

create or replace view public.devices_safe
with (security_invoker = off) as
select
  d.id,
  d.device_code,
  d.label,
  d.location_desc,
  case when p.role = 'admin' then d.api_key else null end as api_key,
  d.co_threshold,
  d.temp_threshold,
  d.bfp_contact,
  d.is_active,
  d.created_at,
  d.last_seen_at,
  d.latitude,
  d.longitude,
  d.local_ip
from public.devices d
left join public.profiles p on p.id = auth.uid()
where
  p.role in ('admin', 'bfp_responder')
  or (
    p.role = 'resident'
    and d.id = p.device_id
  );

grant select on public.devices_safe to authenticated;

-- ===== 20261014000000_fix_devices_safe_resident.sql =====
-- =============================================================
-- BUGFIX: Infinite recursion on devices_safe for residents.
--
-- The previous definition of devices_safe relied on get_auth_role(),
-- which triggered the Row Level Security (RLS) policy on the profiles
-- table. The RLS policy for profiles itself called get_auth_role(),
-- causing an infinite recursion loop when a resident queried the view,
-- ultimately resulting in 0 rows and throwing a 406 Not Acceptable.
--
-- Fix: Use a direct LEFT JOIN against public.profiles using auth.uid()
-- to eliminate the need for get_auth_role() in the WHERE clause, breaking
-- the recursion loop and correctly returning the device for the resident.
-- =============================================================

create or replace view public.devices_safe
with (security_invoker = off) as
select
  d.id,
  d.device_code,
  d.label,
  d.location_desc,
  case when p.role = 'admin' then d.api_key else null end as api_key,
  d.co_threshold,
  d.temp_threshold,
  d.bfp_contact,
  d.is_active,
  d.created_at,
  d.last_seen_at,
  d.latitude,
  d.longitude,
  d.local_ip
from public.devices d
left join public.profiles p on p.id = auth.uid()
where
  p.role in ('admin', 'bfp_responder')
  or (
    p.role = 'resident'
    and d.id = p.device_id
  );

grant select on public.devices_safe to authenticated;

-- ===== 20261015000000_fix_devices_safe_security_invoker.sql =====
-- =============================================================
-- FIX: Re-enable security_invoker on devices_safe, and restore
-- read permissions for non-admin users to the underlying devices table.
-- =============================================================

CREATE OR REPLACE FUNCTION get_device_api_key_secure(d_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role TEXT;
  v_api_key TEXT;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role = 'admin' THEN
    SELECT api_key INTO v_api_key FROM devices WHERE id = d_id;
    RETURN v_api_key;
  END IF;
  RETURN NULL;
END;
$$;

-- Drop the view first because we are changing the underlying table permissions
DROP VIEW IF EXISTS public.devices_safe;

-- Revoke select on the whole table for authenticated users
REVOKE SELECT ON public.devices FROM authenticated;

-- Grant select on all columns EXCEPT api_key to authenticated users
GRANT SELECT (id, device_code, label, location_desc, co_threshold, temp_threshold, bfp_contact, is_active, created_at, last_seen_at, latitude, longitude, local_ip) ON public.devices TO authenticated;

-- Restore the policies that were removed in 20260924040000_restrict_devices_base_table_to_admin.sql
CREATE POLICY "BFP Responder can read devices"
  ON public.devices FOR SELECT USING (get_auth_role() = 'bfp_responder');

CREATE POLICY "Resident can read own device"
  ON public.devices FOR SELECT USING (
    get_auth_role() = 'resident'
    AND id = (SELECT device_id FROM profiles WHERE profiles.id = auth.uid())
  );

create or replace view public.devices_safe
with (security_invoker = true) as
select
  d.id,
  d.device_code,
  d.label,
  d.location_desc,
  get_device_api_key_secure(d.id) as api_key,
  d.co_threshold,
  d.temp_threshold,
  d.bfp_contact,
  d.is_active,
  d.created_at,
  d.last_seen_at,
  d.latitude,
  d.longitude,
  d.local_ip
from public.devices d
left join public.profiles p on p.id = auth.uid()
where
  p.role in ('admin', 'bfp_responder')
  or (
    p.role = 'resident'
    and d.id = p.device_id
  );

grant select on public.devices_safe to authenticated;

-- ===== 20261016000000_resolve_address_discrepancy_rpc.sql =====
-- =============================================================
-- FIX: Allow residents to update their device's registered address
-- when approving a location discrepancy. Residents do not have
-- UPDATE permissions on the devices table.
-- =============================================================

create or replace function public.resolve_address_discrepancy(
  p_discrepancy_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_discrepancy record;
begin
  if p_status not in ('approved', 'rejected') then
    raise exception 'Invalid status';
  end if;

  select * into v_discrepancy
  from address_discrepancies
  where id = p_discrepancy_id and resident_id = auth.uid();

  if not found then
    raise exception 'Discrepancy not found or access denied';
  end if;

  update address_discrepancies
  set status = p_status,
      resolved_at = now()
  where id = p_discrepancy_id;

  if p_status = 'approved' then
    update devices
    set location_desc = v_discrepancy.gps_derived_address,
        latitude = v_discrepancy.latitude,
        longitude = v_discrepancy.longitude
    where id = v_discrepancy.device_id;
  end if;
end;
$$;

grant execute on function public.resolve_address_discrepancy(uuid, text) to authenticated;

-- ===== 20261017000000_telegram_link_tokens.sql =====
-- One-time, short-lived tokens for linking a Telegram chat to a profile.
-- Replaces putting the raw profile id in the t.me deep link, which let anyone
-- who knew a user's id hijack that user's Telegram alerts.
CREATE TABLE IF NOT EXISTS public.telegram_link_tokens (
    token TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_link_tokens_user_id_idx
    ON public.telegram_link_tokens (user_id);

-- No policies: only the service role (telegram-webhook) and the RPC below touch it.
ALTER TABLE public.telegram_link_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_link_tokens FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_telegram_link_token()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Only one outstanding token per user; also sweep expired ones.
  DELETE FROM telegram_link_tokens
   WHERE user_id = auth.uid() OR expires_at < now();

  -- 64 hex chars (fits Telegram's 64-char /start payload limit)
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO telegram_link_tokens (token, user_id, expires_at)
  VALUES (v_token, auth.uid(), now() + interval '15 minutes');

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.create_telegram_link_token() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_telegram_link_token() TO authenticated;

-- ===== 20261018000000_tighten_discrepancy_policy.sql =====
-- Residents could UPDATE any column of their own address_discrepancies rows
-- (e.g. status, resident_id, coordinates). Resolution now goes exclusively
-- through the resolve_address_discrepancy() RPC, so drop the direct UPDATE policy.
DROP POLICY IF EXISTS "Resident can update own discrepancies" ON address_discrepancies;

-- Harden the SECURITY DEFINER function: pin search_path (pg_temp last) and
-- restrict execution to authenticated users only.
ALTER FUNCTION public.resolve_address_discrepancy(uuid, text)
  SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.resolve_address_discrepancy(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_address_discrepancy(uuid, text) TO authenticated;

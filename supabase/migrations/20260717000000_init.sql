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

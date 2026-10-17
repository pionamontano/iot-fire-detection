import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Role = 'admin' | 'bfp_responder' | 'resident';

export type ProfileStatus = 'approved' | 'pending' | 'rejected';

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
  contact_number: string | null;
  device_id: string | null;
  address: string | null;
  status: ProfileStatus;
  setup_complete: boolean;
  is_active: boolean;
  telegram_chat_id: string | null;
  created_at: string;
}

export interface RegistrationRequest {
  id: string;
  user_id: string;
  email: string;
  requested_role: 'resident' | 'bfp_responder';
  device_code: string | null;
  organization: string | null;
  position: string | null;
  verification_info: string | null;
  admin_notes: string | null;
  reviewed_by: string | null;
  telegram_chat_id: string | null;
  created_at: string;
  reviewed_at: string | null;
  // Merged from profiles join
  full_name: string;
  contact_number: string | null;
  status: ProfileStatus;
}

export interface SupportRequest {
  id: string;
  user_id: string;
  category: string;
  message: string;
  contact_email: string | null;
  contact_phone: string | null;
  role_at_request: Role | null;
  status: 'open' | 'resolved';
  admin_notes: string | null;
  reviewed_by: string | null;
  created_at: string;
  reviewed_at: string | null;
  // Merged from profiles join
  full_name: string;
}

export interface Device {
  id: string;
  device_code: string;
  label: string;
  /** Null until the linked resident sets their address (20261102000000). */
  location_desc: string | null;
  api_key: string;
  co_threshold: number;
  temp_threshold: number;
  bfp_contact: string | null;
  is_active: boolean;
  telegram_chat_id: string | null;
  created_at: string;
  last_seen_at: string | null;
  local_ip: string | null;
  latitude: number | null;
  longitude: number | null;
  firmware_version: string | null;
  firmware_url: string | null;
  firmware_md5: string | null;
  firmware_version_reported: string | null;
  /** An admin has confirmed the install pin; reset whenever the resident changes it. */
  location_verified: boolean;
  location_verified_at: string | null;
}

export interface FirmwareRelease {
  id: string;
  version: string;
  url: string;
  md5: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface SensorReading {
  id: string;
  device_id: string;
  co_ppm: number;
  temp_celsius: number;
  latitude: number | null;
  longitude: number | null;
  gps_valid: boolean;
  on_battery: boolean;
  sensor_ready: boolean;
  recorded_at: string;
}

export interface AlertEvent {
  id: string;
  device_id: string;
  alert_tier: 1 | 2;
  co_ppm: number;
  temp_celsius: number;
  latitude: number | null;
  longitude: number | null;
  gps_valid: boolean;
  address_resolved: string | null;
  telegram_sent: boolean;
  sms_sent_owner: boolean;
  sms_sent_bfp: boolean;
  resolved_at: string | null;
  triggered_at: string;
  incident_status?: 'active' | 'acknowledged' | 'responding' | 'resolved' | 'false_alarm';
  acknowledged_by?: string | null;
  resolved_by?: string | null;
  resolution_source?: 'device' | 'responder' | 'admin' | 'legacy' | 'resident' | null;
  acknowledged_at?: string | null;
  outcome_notes?: string | null;
  devices?: Device; // For joined queries
}

export interface StationSettings {
  id: number;
  station_name: string;
  address: string;
  contact_number: string;
  email: string;
  key_personnel: {
    title: string;
    name: string;
    contact: string;
  }[];
}

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

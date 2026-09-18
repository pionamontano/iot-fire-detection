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

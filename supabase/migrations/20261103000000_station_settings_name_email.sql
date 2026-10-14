-- =============================================================
-- station_settings: add the station_name and email columns Responder Settings
-- (Station Information) reads and writes.
--
-- 20260717000000_init.sql created station_settings without them, yet the
-- page has always selected and updated station_name and email; on a database
-- built only from migrations the save failed and the fields loaded blank.
-- Databases where they were added by hand already have them, so this is a
-- no-op there (IF NOT EXISTS). Nullable: no value is invented for the
-- existing row; the page shows empty fields until a responder fills them in.
-- =============================================================

alter table public.station_settings add column if not exists station_name text;
alter table public.station_settings add column if not exists email text;

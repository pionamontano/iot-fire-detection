ALTER TABLE devices ADD COLUMN IF NOT EXISTS local_ip TEXT;

CREATE OR REPLACE VIEW devices_safe AS
SELECT
    id, device_code, label, location_desc,
    co_threshold, temp_threshold, bfp_contact,
    is_active, created_at, last_seen_at, local_ip
FROM devices;

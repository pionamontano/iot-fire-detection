-- =============================================================
-- firmware_releases: a log of firmware builds the admin has
-- published, independent of any single device. Answers "is there
-- a newer build than what the fleet is running" — previously the
-- only comparison available was per-device (devices.firmware_version,
-- the admin-set target, vs firmware_version_reported, what that one
-- device last told us it's running), which says nothing about
-- whether a device has even been pointed at the latest build yet.
--
-- The latest row (by created_at) is the fleet's current release.
-- "Push to fleet" (an admin UI action, not a DB trigger) copies its
-- version/url/md5 into every active device's firmware_version/
-- firmware_url/firmware_md5 — the columns the firmware actually
-- polls via get-device-config — so this table never talks to
-- devices directly; it's a release log the UI reads to know what
-- "latest" means and to bulk-assign it.
-- =============================================================

CREATE TABLE firmware_releases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version TEXT NOT NULL,
    url TEXT NOT NULL,
    md5 TEXT,
    notes TEXT,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE firmware_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage firmware releases"
  ON firmware_releases FOR ALL USING (get_auth_role() = 'admin');

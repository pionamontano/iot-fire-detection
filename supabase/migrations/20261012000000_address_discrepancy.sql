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

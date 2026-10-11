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

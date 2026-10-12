-- Support requests table: in-app replacement for the "Contact System Administrator"
-- modal, which previously tried to email agapsense@gmail.com via Resend.

CREATE TABLE support_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    contact_email TEXT,
    contact_phone TEXT,
    role_at_request TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    admin_notes TEXT,
    reviewed_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    reviewed_at TIMESTAMPTZ
);

ALTER TABLE support_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage support requests"
  ON support_requests FOR ALL USING (get_auth_role() = 'admin');

CREATE POLICY "Users insert own support requests"
  ON support_requests FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users view own support requests"
  ON support_requests FOR SELECT USING (user_id = auth.uid());

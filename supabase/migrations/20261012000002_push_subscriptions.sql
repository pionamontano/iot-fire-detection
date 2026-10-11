CREATE TABLE push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own subscriptions"
  ON push_subscriptions FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can view their own subscriptions"
  ON push_subscriptions FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can update their own subscriptions"
  ON push_subscriptions FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own subscriptions"
  ON push_subscriptions FOR DELETE USING (user_id = auth.uid());

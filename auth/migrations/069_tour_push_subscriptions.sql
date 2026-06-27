-- Web Push subscriptions for the iPad Tour Check-In app. Each front-desk iPad
-- (installed to Home Screen) subscribes once; we push "new tour" notifications
-- to every subscription for that location when a tour-intake row is created.
CREATE TABLE IF NOT EXISTS tour_push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tour_push_subs_location ON tour_push_subscriptions (location_id);

-- Service-role only (frontend never uses supabase-js). RLS on, no policy.
ALTER TABLE tour_push_subscriptions ENABLE ROW LEVEL SECURITY;

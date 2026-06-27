-- Per-location config for the standalone Tour Check-In app:
-- the secret URL token, an outbound webhook, and the Day One booking base link.
CREATE TABLE IF NOT EXISTS tour_location_config (
  location_id      uuid PRIMARY KEY REFERENCES locations(id),
  public_token     text NOT NULL UNIQUE,
  webhook_url      text,
  day_one_base_url text,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tour_location_config ENABLE ROW LEVEL SECURITY;

-- The ABC employee who ran the tour (captured at save; no logged-in staffer).
ALTER TABLE tour_intakes ADD COLUMN IF NOT EXISTS tour_member text;

-- Seed a token for every existing location. encode(gen_random_bytes(24),'hex')
-- gives a 48-char unguessable token; pgcrypto is already available in Supabase.
INSERT INTO tour_location_config (location_id, public_token)
SELECT id, encode(gen_random_bytes(24), 'hex')
FROM locations
ON CONFLICT (location_id) DO NOTHING;

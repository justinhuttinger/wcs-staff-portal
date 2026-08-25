-- 075_club_integrations.sql
--
-- Per-club outbound webhook URLs, editable from Admin -> Club Integrations.
--
-- These URLs currently live in clubs-config.json in the prospects---documents
-- repo, which means changing one is a commit, a push, and a Render redeploy.
-- They are operational settings a manager may need to repoint at 9pm when a GHL
-- workflow gets rebuilt, so they belong in the database.
--
-- Keyed by abc_club_number rather than locations(id) on purpose. The consumer is
-- the prospects---documents service, which knows every club by its ABC club
-- number and has no mapping to this database's location uuids. till_settings
-- (migration 071) keys the same way for the same reason. location_slug is
-- denormalized alongside it because much of the codebase resolves clubs by
-- lowercased name.
--
-- SCOPE: only integrations that have no editor today.
--   * VIP referrals already has vip_referral_config + its own admin screen.
--   * The portal's Tour Check-In screen owns tour_location_config.webhook_url.
-- Adding those here would mean two screens editing one setting, so they are
-- deliberately left out. Add a column here only when nothing else owns it.
--
-- Reader: prospects---documents services/waiver/integrations.js, which falls
-- back to clubs-config.json whenever a row or a column is empty. That fallback
-- is what makes this migration safe to apply before the reader ships, and what
-- keeps a Supabase outage from silently dropping every webhook.

CREATE TABLE IF NOT EXISTS club_integrations (
  abc_club_number                    text PRIMARY KEY,
  location_slug                      text NOT NULL,
  display_name                       text NOT NULL,

  kiosk_waiver_lead_webhook_url      text,
  kiosk_waiver_completed_webhook_url text,
  pt_intake_webhook_url              text,

  active                             boolean NOT NULL DEFAULT true,
  created_at                         timestamptz NOT NULL DEFAULT now(),
  updated_at                         timestamptz NOT NULL DEFAULT now(),
  updated_by                         uuid REFERENCES staff(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_club_integrations_slug
  ON club_integrations (location_slug);

-- Service-role only, like every other table here. The portal reads and writes it
-- through the auth API; the browser never touches it directly.
ALTER TABLE public.club_integrations ENABLE ROW LEVEL SECURITY;

-- Seed a row per club so the admin screen shows real rows rather than
-- synthesized blanks. Every URL starts NULL, which means "fall back to
-- clubs-config.json" — so applying this changes no behavior at all.
INSERT INTO club_integrations (abc_club_number, location_slug, display_name) VALUES
  ('30935', 'salem',       'Salem'),
  ('31599', 'keizer',      'Keizer'),
  ('7655',  'eugene',      'Eugene'),
  ('31601', 'milwaukie',   'Milwaukie'),
  ('31600', 'clackamas',   'Clackamas'),
  ('31598', 'springfield', 'Springfield'),
  ('32073', 'medford',     'Medford')
ON CONFLICT (abc_club_number) DO NOTHING;

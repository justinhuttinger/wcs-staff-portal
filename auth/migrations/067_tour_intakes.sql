-- 067_tour_intakes.sql
-- Live "front desk" tour queue. A Go High Level form (filled out when a
-- prospect arrives for a gym tour) fires a webhook to the auth service at
-- POST /webhooks/tour-intake, which inserts one row here with status 'ready'.
-- The mobile portal (route #tour-checkin, served at /mobile) polls
-- GET /tour-intake for the staffer's location and shows a card per prospect —
-- profile photo, name, email, phone, "Ready for a tour" badge. Staff tap a
-- card, record the tour outcome + notes, and the row flips to 'completed'.
--
-- photo_base64 holds the prospect's photo as a data URL (e.g.
-- "data:image/jpeg;base64,...") delivered inline by the GHL webhook, since GHL
-- contacts have no hosted avatar. It's nullable — the card falls back to
-- initials when absent.
--
-- raw preserves the full webhook payload verbatim so new form fields aren't
-- lost before we model them.

CREATE TABLE IF NOT EXISTS tour_intakes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at   timestamptz NOT NULL DEFAULT now(),

  -- Who is here (resolved from the GHL form/contact at webhook time)
  ghl_contact_id  text,
  contact_name    text,
  contact_email   text,
  contact_phone   text,
  photo_base64    text,                       -- data URL; null -> show initials

  -- Where (FK to our locations; resolved from the GHL location id/slug/name)
  location_id     uuid REFERENCES locations(id),

  -- Queue state
  status          text NOT NULL DEFAULT 'ready',   -- ready | completed | cancelled

  -- Our tour form (filled out by staff on the iPad)
  outcome         text,                       -- e.g. Joined / Started Trial / Booked Day One / Thinking It Over / Not Interested
  notes           text,
  completed_at    timestamptz,
  completed_by    uuid REFERENCES staff(id),

  raw             jsonb
);

-- Primary read path: a location's open queue, newest first.
CREATE INDEX IF NOT EXISTS idx_tour_intakes_location_status
  ON tour_intakes(location_id, status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_tour_intakes_received
  ON tour_intakes(received_at DESC);

-- Match the project-wide posture (035_enable_rls_all_tables): all access is
-- server-side via the Supabase service role, which bypasses RLS. Enabling RLS
-- with no policy denies the public anon/authenticated roles.
ALTER TABLE public.tour_intakes ENABLE ROW LEVEL SECURITY;

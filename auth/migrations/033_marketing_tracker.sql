-- 033_marketing_tracker.sql
-- Experimental "Marketing Tracker" tool. One row per marketing effort
-- (meta ad, social post, flyer, facebook event, email, sms, app blast,
-- ad tvs, website). Type-specific fields live in the `custom` JSONB blob so
-- new types/fields don't require schema changes. `locations` holds the gym
-- slugs an effort targets (all 7 slugs = corporate-wide / "All Locations").
-- Access is gated to the marketing role + admin at the API layer.

CREATE TABLE IF NOT EXISTS marketing_efforts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  type            text NOT NULL,
  locations       text[] NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'planned',  -- planned | approved | complete
  start_at        timestamptz NOT NULL,
  end_at          timestamptz,                       -- optional (ranges: campaigns/events)
  notes           text,
  custom          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_efforts_start
  ON marketing_efforts(start_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_efforts_type
  ON marketing_efforts(type);
CREATE INDEX IF NOT EXISTS idx_marketing_efforts_locations
  ON marketing_efforts USING gin (locations);

-- Keep updated_at fresh on every UPDATE.
CREATE OR REPLACE FUNCTION marketing_efforts_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marketing_efforts_updated_at ON marketing_efforts;
CREATE TRIGGER trg_marketing_efforts_updated_at
  BEFORE UPDATE ON marketing_efforts
  FOR EACH ROW EXECUTE FUNCTION marketing_efforts_touch_updated_at();

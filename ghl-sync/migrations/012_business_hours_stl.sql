-- 012: Business-hours Speed to Lead.
-- Adds a per-location staffed-window config and the time math to clamp a
-- speed-to-lead span down to contactable (in-window, active-day) seconds, so a
-- lead that comes in after hours and is contacted first thing next morning reads
-- as the minutes inside staffed hours, not the raw overnight gap.
--
-- The raw metric (ghl_first_contact + /reports/speed-to-lead) is untouched; this
-- only adds the business-hours variant consumed by /reports/speed-to-lead/business-audit.
-- DST correctness comes from doing all window math in Postgres via AT TIME ZONE.

-- ---------------------------------------------------------------------------
-- Per-location staffed lead-response window. One row per location so a future
-- non-Pacific club or different hours is a one-row edit, not a code change.
-- active_days uses Postgres dow: 0=Sunday .. 6=Saturday.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stl_business_hours_config (
  location_id   TEXT PRIMARY KEY REFERENCES ghl_locations(id),
  timezone      TEXT  NOT NULL DEFAULT 'America/Los_Angeles',
  window_start  TIME  NOT NULL DEFAULT '08:00',
  window_end    TIME  NOT NULL DEFAULT '20:00',
  active_days   INT[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6],
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE stl_business_hours_config ENABLE ROW LEVEL SECURITY; -- service-role only, no policy

-- Seed every known location with the confirmed default window (08:00-20:00,
-- every day, Pacific). Re-runnable: existing rows are left as-is.
INSERT INTO stl_business_hours_config (location_id)
SELECT id FROM ghl_locations
ON CONFLICT (location_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- business_seconds(start_ts, end_ts, tz, win_start, win_end, active_days)
-- Contactable seconds between two instants: the part of [start,end] that falls
-- inside the local [win_start, win_end] window on active weekdays. Walks each
-- local calendar day the span touches and sums per-day overlap.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION business_seconds(
  start_ts     TIMESTAMPTZ,
  end_ts       TIMESTAMPTZ,
  p_tz         TEXT  DEFAULT 'America/Los_Angeles',
  win_start    TIME  DEFAULT '08:00',
  win_end      TIME  DEFAULT '20:00',
  active_days  INT[] DEFAULT ARRAY[0,1,2,3,4,5,6]
) RETURNS BIGINT
LANGUAGE sql STABLE AS $$
  WITH bounds AS (
    -- normalize a reversed span so a negative gap can't produce garbage
    SELECT least(start_ts, end_ts) AS s, greatest(start_ts, end_ts) AS e
  ),
  range AS (
    SELECT (s AT TIME ZONE p_tz)::date AS sd, (e AT TIME ZONE p_tz)::date AS ed
    FROM bounds
  ),
  -- Walk integer day offsets so `d` is unambiguously a DATE. This matters:
  -- generate_series over date bounds resolves to the timestamptz overload, which
  -- would make `(d + win_*) AT TIME ZONE p_tz` convert FROM the zone (timestamp)
  -- instead of TO it (timestamptz), inverting the whole calculation.
  days AS (
    SELECT (range.sd + gs)::date AS d
    FROM range, generate_series(0, (range.ed - range.sd)) AS gs
  )
  SELECT COALESCE(SUM(
    GREATEST(0, EXTRACT(EPOCH FROM (
      least(b.e, ((d + win_end)   AT TIME ZONE p_tz))
      - greatest(b.s, ((d + win_start) AT TIME ZONE p_tz))
    )))
  ), 0)::bigint
  FROM days, bounds b
  WHERE EXTRACT(DOW FROM d)::int = ANY(active_days);
$$;

-- ---------------------------------------------------------------------------
-- speed_to_lead_business(p_location_ids, p_start, p_end, p_limit)
-- Per-opportunity raw + business seconds for the report route. No New-Lead / DND
-- filtering here -- that stays in the JS route (same rules as the raw audit).
-- raw_seconds / business_seconds are NULL when first contact hasn't happened yet.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION speed_to_lead_business(
  p_location_ids TEXT[]      DEFAULT NULL,
  p_start        TIMESTAMPTZ DEFAULT NULL,
  p_end          TIMESTAMPTZ DEFAULT NULL,
  p_limit        INT         DEFAULT 5000
) RETURNS TABLE (
  opportunity_id          TEXT,
  contact_id              TEXT,
  location_id             TEXT,
  opportunity_created_at  TIMESTAMPTZ,
  first_human_contact_at  TIMESTAMPTZ,
  first_contact_kind      TEXT,
  raw_seconds             BIGINT,
  business_seconds        BIGINT
)
LANGUAGE sql STABLE AS $$
  SELECT
    fc.opportunity_id,
    fc.contact_id,
    fc.location_id,
    fc.opportunity_created_at,
    fc.first_human_contact_at,
    fc.first_contact_kind,
    CASE WHEN fc.first_human_contact_at IS NULL THEN NULL
         ELSE EXTRACT(EPOCH FROM (fc.first_human_contact_at - fc.opportunity_created_at))::bigint
    END AS raw_seconds,
    CASE WHEN fc.first_human_contact_at IS NULL THEN NULL
         ELSE business_seconds(
           fc.opportunity_created_at,
           fc.first_human_contact_at,
           COALESCE(cfg.timezone, 'America/Los_Angeles'),
           COALESCE(cfg.window_start, '08:00'),
           COALESCE(cfg.window_end, '20:00'),
           COALESCE(cfg.active_days, ARRAY[0,1,2,3,4,5,6])
         )
    END AS business_seconds
  FROM ghl_first_contact fc
  LEFT JOIN stl_business_hours_config cfg ON cfg.location_id = fc.location_id
  WHERE (p_location_ids IS NULL OR fc.location_id = ANY(p_location_ids))
    AND (p_start IS NULL OR fc.opportunity_created_at >= p_start)
    AND (p_end   IS NULL OR fc.opportunity_created_at <= p_end)
  ORDER BY fc.opportunity_created_at DESC
  LIMIT p_limit;
$$;

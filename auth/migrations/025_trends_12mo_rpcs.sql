-- 025_trends_12mo_rpcs.sql
-- RPCs powering the 12-Month Trends Excel export.
--
-- Three functions:
--   members_active_on(date, clubs, skip)         -- historical active-roster reconstruction (row-grain)
--   members_active_on_rollup(date, clubs, skip)  -- same logic, returns bucketed counts (small payload)
--   trends_12mo_member_flows(start, end, ...)    -- monthly add/drop counts
--   revenue_summary_monthly(start, end, locs)    -- monthly revenue rollups
--
-- Historical-snapshot caveat: membership_type, gender, club, etc. on abc_members
-- are the CURRENT values, not the values on p_date. Birth_date is immutable so
-- age_at_date is fully historical; the active-on flag is reconstructed. Most
-- other demographic fields drift but rarely (gender ~never; membership_type via
-- upgrades/downgrades occasionally). The UI surfaces this in the export footer.

-- ---------------------------------------------------------------------------
-- members_active_on(p_date, p_club_numbers, p_skip_types)
-- A row counts as "active on p_date" when:
--   sign_date <= p_date
-- AND ( is_active = true
--    OR (member_status IN ('Cancelled','Expired','Return For Collection')
--        AND member_status_date > p_date) )
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION members_active_on(
  p_date         date,
  p_club_numbers text[] DEFAULT NULL,
  p_skip_types   text[] DEFAULT NULL
)
RETURNS TABLE (
  member_id        text,
  club_number      text,
  agreement_number text,
  membership_type  text,
  gender           text,
  birth_date       date,
  age_at_date      int
)
LANGUAGE sql STABLE
AS $$
  SELECT
    m.member_id,
    m.club_number,
    m.agreement_number,
    m.membership_type,
    m.gender,
    m.birth_date,
    CASE
      WHEN m.birth_date IS NULL THEN NULL
      ELSE EXTRACT(year FROM age(p_date, m.birth_date))::int
    END AS age_at_date
  FROM abc_members m
  WHERE m.sign_date IS NOT NULL
    AND m.sign_date <= p_date
    AND (
      m.is_active = true
      OR (
        m.member_status IN ('Cancelled', 'Expired', 'Return For Collection')
        AND m.member_status_date IS NOT NULL
        AND m.member_status_date > p_date
      )
    )
    AND (
      p_club_numbers IS NULL
      OR cardinality(p_club_numbers) = 0
      OR m.club_number = ANY(p_club_numbers)
    )
    AND (
      p_skip_types IS NULL
      OR cardinality(p_skip_types) = 0
      OR LOWER(COALESCE(m.membership_type, '')) <> ALL(
           SELECT LOWER(s) FROM unnest(p_skip_types) AS s
         )
    );
$$;

GRANT EXECUTE ON FUNCTION members_active_on(date, text[], text[])
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- members_active_on_rollup(p_date, ...) — bucketed counts, single round-trip.
-- bucket ∈ { 'total', 'by_age', 'by_gender', 'by_membership_type', 'by_club' }
-- Age buckets: <18, 18-24, 25-34, 35-44, 45-54, 55-64, 65+, Unknown
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION members_active_on_rollup(
  p_date         date,
  p_club_numbers text[] DEFAULT NULL,
  p_skip_types   text[] DEFAULT NULL
)
RETURNS TABLE (
  bucket          text,
  key1            text,
  member_count    int,
  agreement_count int
)
LANGUAGE sql STABLE
AS $$
  WITH active AS (
    SELECT * FROM members_active_on(p_date, p_club_numbers, p_skip_types)
  ),
  age_bucketed AS (
    SELECT
      a.*,
      CASE
        WHEN a.age_at_date IS NULL THEN 'Unknown'
        WHEN a.age_at_date < 18 THEN '<18'
        WHEN a.age_at_date < 25 THEN '18-24'
        WHEN a.age_at_date < 35 THEN '25-34'
        WHEN a.age_at_date < 45 THEN '35-44'
        WHEN a.age_at_date < 55 THEN '45-54'
        WHEN a.age_at_date < 65 THEN '55-64'
        ELSE '65+'
      END AS age_bucket
    FROM active a
  )
  SELECT 'total'::text, NULL::text,
         COUNT(*)::int,
         COUNT(DISTINCT agreement_number)::int
  FROM age_bucketed
  UNION ALL
  SELECT 'by_age'::text, age_bucket,
         COUNT(*)::int,
         COUNT(DISTINCT agreement_number)::int
  FROM age_bucketed
  GROUP BY age_bucket
  UNION ALL
  SELECT 'by_gender'::text,
         COALESCE(NULLIF(gender, ''), 'Unknown'),
         COUNT(*)::int,
         COUNT(DISTINCT agreement_number)::int
  FROM age_bucketed
  GROUP BY 2
  UNION ALL
  SELECT 'by_membership_type'::text,
         COALESCE(NULLIF(membership_type, ''), 'Unknown'),
         COUNT(*)::int,
         COUNT(DISTINCT agreement_number)::int
  FROM age_bucketed
  GROUP BY 2
  UNION ALL
  SELECT 'by_club'::text,
         club_number,
         COUNT(*)::int,
         COUNT(DISTINCT agreement_number)::int
  FROM age_bucketed
  GROUP BY club_number;
$$;

GRANT EXECUTE ON FUNCTION members_active_on_rollup(date, text[], text[])
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- trends_12mo_member_flows(p_start_month, p_end_month, ...) — adds & drops by
-- month, single round-trip. Returns bucket ∈ { 'added', 'dropped' }, month is
-- YYYY-MM-01.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trends_12mo_member_flows(
  p_start_month  date,
  p_end_month    date,
  p_club_numbers text[] DEFAULT NULL,
  p_skip_types   text[] DEFAULT NULL
)
RETURNS TABLE (
  month            date,
  bucket           text,
  member_count     bigint,
  agreement_count  bigint
)
LANGUAGE sql STABLE
AS $$
  WITH skip_check AS (
    SELECT
      m.*,
      (
        p_skip_types IS NULL OR cardinality(p_skip_types) = 0
        OR LOWER(COALESCE(m.membership_type, '')) <> ALL(
             SELECT LOWER(s) FROM unnest(p_skip_types) AS s
           )
      ) AS keep_row
    FROM abc_members m
    WHERE (p_club_numbers IS NULL OR cardinality(p_club_numbers) = 0
           OR m.club_number = ANY(p_club_numbers))
  )
  SELECT
    date_trunc('month', sign_date)::date AS month,
    'added'::text AS bucket,
    COUNT(*)::bigint AS member_count,
    COUNT(DISTINCT agreement_number)::bigint AS agreement_count
  FROM skip_check
  WHERE keep_row
    AND sign_date IS NOT NULL
    AND sign_date >= p_start_month
    AND sign_date <  (p_end_month + interval '1 month')
  GROUP BY 1
  UNION ALL
  SELECT
    date_trunc('month', member_status_date)::date,
    'dropped'::text,
    COUNT(*)::bigint,
    COUNT(DISTINCT agreement_number)::bigint
  FROM skip_check
  WHERE keep_row
    AND member_status IN ('Cancelled', 'Expired', 'Return For Collection')
    AND member_status_date IS NOT NULL
    AND member_status_date >= p_start_month
    AND member_status_date <  (p_end_month + interval '1 month')
  GROUP BY 1;
$$;

GRANT EXECUTE ON FUNCTION trends_12mo_member_flows(date, date, text[], text[])
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- revenue_summary_monthly(p_start_month, p_end_month, p_location_filter)
-- Mirrors revenue_summary() but returns monthly grain instead of daily.
-- bucket ∈ { 'total', 'by_profit_center', 'by_club' }
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION revenue_summary_monthly(
  p_start_month     date,
  p_end_month       date,
  p_location_filter text[] DEFAULT NULL
)
RETURNS TABLE (
  bucket          text,
  key1            text,
  month           date,
  total_amount    numeric
)
LANGUAGE sql STABLE
AS $$
  WITH filtered AS (
    SELECT *
    FROM abc_revenue_transactions
    WHERE payment_date >= p_start_month
      AND payment_date <  (p_end_month + interval '1 month')
      AND (p_location_filter IS NULL
           OR cardinality(p_location_filter) = 0
           OR location_slug = ANY(p_location_filter))
  )
  SELECT 'total'::text, NULL::text,
         date_trunc('month', payment_date)::date,
         COALESCE(SUM(payment_amount), 0)
  FROM filtered
  GROUP BY date_trunc('month', payment_date)
  UNION ALL
  SELECT 'by_profit_center'::text, profit_center,
         date_trunc('month', payment_date)::date,
         SUM(payment_amount)
  FROM filtered
  GROUP BY profit_center, date_trunc('month', payment_date)
  UNION ALL
  SELECT 'by_club'::text, location_slug,
         date_trunc('month', payment_date)::date,
         SUM(payment_amount)
  FROM filtered
  GROUP BY location_slug, date_trunc('month', payment_date);
$$;

GRANT EXECUTE ON FUNCTION revenue_summary_monthly(date, date, text[])
  TO authenticated, service_role;

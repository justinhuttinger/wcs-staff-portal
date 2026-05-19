-- 026_trends_12mo_per_club.sql
-- Add per-club breakdown to trends_12mo_member_flows. Return signature
-- changes (adds club_number column), so we DROP+CREATE rather than
-- CREATE OR REPLACE. Safe because the 025 RPCs aren't called by any
-- deployed code yet (PR #181 introduces the only callers).

DROP FUNCTION IF EXISTS trends_12mo_member_flows(date, date, text[], text[]);

CREATE FUNCTION trends_12mo_member_flows(
  p_start_month  date,
  p_end_month    date,
  p_club_numbers text[] DEFAULT NULL,
  p_skip_types   text[] DEFAULT NULL
)
RETURNS TABLE (
  month            date,
  club_number      text,
  bucket           text,     -- 'added' | 'dropped'
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
    club_number,
    'added'::text AS bucket,
    COUNT(*)::bigint AS member_count,
    COUNT(DISTINCT agreement_number)::bigint AS agreement_count
  FROM skip_check
  WHERE keep_row
    AND sign_date IS NOT NULL
    AND sign_date >= p_start_month
    AND sign_date <  (p_end_month + interval '1 month')
  GROUP BY 1, 2
  UNION ALL
  SELECT
    date_trunc('month', member_status_date)::date,
    club_number,
    'dropped'::text,
    COUNT(*)::bigint,
    COUNT(DISTINCT agreement_number)::bigint
  FROM skip_check
  WHERE keep_row
    AND member_status IN ('Cancelled', 'Expired', 'Return For Collection')
    AND member_status_date IS NOT NULL
    AND member_status_date >= p_start_month
    AND member_status_date <  (p_end_month + interval '1 month')
  GROUP BY 1, 2;
$$;

GRANT EXECUTE ON FUNCTION trends_12mo_member_flows(date, date, text[], text[])
  TO authenticated, service_role;

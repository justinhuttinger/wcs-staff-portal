-- 028_members_avg_age_stddev.sql
-- Add stddev_age column to members_avg_age_on(). Return signature changes,
-- so DROP + CREATE.

DROP FUNCTION IF EXISTS members_avg_age_on(date, text[], text[]);

CREATE FUNCTION members_avg_age_on(
  p_date         date,
  p_club_numbers text[] DEFAULT NULL,
  p_skip_types   text[] DEFAULT NULL
)
RETURNS TABLE (
  club_number   text,
  avg_age       numeric,
  stddev_age    numeric,
  member_count  int
)
LANGUAGE sql STABLE
AS $$
  WITH active AS (
    SELECT * FROM members_active_on(p_date, p_club_numbers, p_skip_types)
    WHERE age_at_date IS NOT NULL
  )
  SELECT NULL::text AS club_number,
         ROUND(AVG(age_at_date)::numeric, 2) AS avg_age,
         ROUND(STDDEV_POP(age_at_date)::numeric, 2) AS stddev_age,
         COUNT(*)::int AS member_count
  FROM active
  UNION ALL
  SELECT club_number,
         ROUND(AVG(age_at_date)::numeric, 2),
         ROUND(STDDEV_POP(age_at_date)::numeric, 2),
         COUNT(*)::int
  FROM active
  GROUP BY club_number;
$$;

GRANT EXECUTE ON FUNCTION members_avg_age_on(date, text[], text[])
  TO authenticated, service_role;

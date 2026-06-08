-- 032: Membership Audit RPCs over abc_members (current = member_status ILIKE 'active').
-- Monthly-equivalent dues normalize payment frequency. A membership_type is a
-- "paying plan" when >= 50% of its active members pay (>0). A "leak" is an active
-- member on a paying plan whose monthly-equivalent dues are below 50% of that
-- type's median paying dues ($0 always qualifies). Both thresholds are inline
-- literals (50 for pct_paying, 0.5 for the median fraction).

CREATE OR REPLACE FUNCTION membership_audit_summary(p_club_numbers text[] DEFAULT NULL)
RETURNS TABLE (
  membership_type     text,
  members             bigint,
  paying              bigint,
  non_dues            bigint,
  median_monthly_dues numeric,
  avg_monthly_dues    numeric,
  total_monthly_dues  numeric,
  avg_tenure_months   numeric,
  tenure_sum_months   numeric,
  tenure_count        bigint,
  tenure_sum_paying   numeric,
  tenure_count_paying bigint,
  pct_paying          numeric,
  is_insurance        boolean,
  is_paying_plan      boolean,
  leaks               bigint
)
LANGUAGE sql STABLE AS $$
  WITH active AS (
    SELECT
      m.membership_type,
      CASE lower(coalesce(m.payment_frequency, ''))
        WHEN 'monthly'   THEN m.next_due_amount
        WHEN 'bi-weekly' THEN m.next_due_amount * 26.0 / 12.0
        WHEN 'annually'  THEN m.next_due_amount / 12.0
        ELSE m.next_due_amount
      END AS mdue,
      (m.membership_type ILIKE 'A2%' OR m.membership_type ILIKE '%active and fit%') AS is_ins,
      CASE WHEN m.begin_date IS NULL THEN NULL
           ELSE (CURRENT_DATE - m.begin_date) / 30.44 END AS tenure_m
    FROM abc_members m
    WHERE m.member_status ILIKE 'active'
      AND (p_club_numbers IS NULL
           OR array_length(p_club_numbers, 1) IS NULL
           OR m.club_number = ANY (p_club_numbers))
  ),
  typ AS (
    SELECT
      a.membership_type,
      count(*)                                                              AS members,
      count(*) FILTER (WHERE coalesce(a.mdue, 0) > 0)                       AS paying,
      count(*) FILTER (WHERE coalesce(a.mdue, 0) = 0)                       AS non_dues,
      (percentile_cont(0.5) WITHIN GROUP (ORDER BY a.mdue)
        FILTER (WHERE a.mdue > 0))::numeric                                AS median_due,
      avg(a.mdue) FILTER (WHERE a.mdue > 0)                                 AS avg_due,
      sum(a.mdue) FILTER (WHERE a.mdue > 0)                                 AS total_due,
      avg(a.tenure_m)                                                       AS avg_ten,
      sum(a.tenure_m)                                                       AS ten_sum,
      count(a.tenure_m)                                                     AS ten_cnt,
      sum(a.tenure_m) FILTER (WHERE a.mdue > 0)                             AS ten_sum_pay,
      count(a.tenure_m) FILTER (WHERE a.mdue > 0)                           AS ten_cnt_pay,
      bool_or(a.is_ins)                                                     AS is_ins
    FROM active a
    GROUP BY a.membership_type
  )
  SELECT
    t.membership_type,
    t.members,
    t.paying,
    t.non_dues,
    round(t.median_due, 2),
    round(t.avg_due, 2),
    round(t.total_due, 2),
    round(t.avg_ten, 1),
    round(t.ten_sum, 1),
    t.ten_cnt,
    round(t.ten_sum_pay, 1),
    t.ten_cnt_pay,
    round(100.0 * t.paying / nullif(t.members, 0), 1) AS pct_paying,
    t.is_ins,
    (100.0 * t.paying / nullif(t.members, 0)) >= 50   AS is_paying_plan,
    CASE WHEN (100.0 * t.paying / nullif(t.members, 0)) >= 50
         THEN (SELECT count(*) FROM active a
                WHERE a.membership_type = t.membership_type
                  AND coalesce(a.mdue, 0) < 0.5 * t.median_due)
         ELSE 0 END AS leaks
  FROM typ t
  ORDER BY t.members DESC;
$$;

CREATE OR REPLACE FUNCTION membership_audit_anomalies(p_club_numbers text[] DEFAULT NULL)
RETURNS TABLE (
  member_id         text,
  agreement_number  text,
  first_name        text,
  last_name         text,
  club_number       text,
  membership_type   text,
  next_due_amount   numeric,
  monthly_dues      numeric,
  type_median_dues  numeric,
  pct_of_typical    numeric,
  begin_date        date,
  tenure_months     numeric
)
LANGUAGE sql STABLE AS $$
  WITH active AS (
    SELECT m.*,
      CASE lower(coalesce(m.payment_frequency, ''))
        WHEN 'monthly'   THEN m.next_due_amount
        WHEN 'bi-weekly' THEN m.next_due_amount * 26.0 / 12.0
        WHEN 'annually'  THEN m.next_due_amount / 12.0
        ELSE m.next_due_amount
      END AS mdue
    FROM abc_members m
    WHERE m.member_status ILIKE 'active'
      AND (p_club_numbers IS NULL
           OR array_length(p_club_numbers, 1) IS NULL
           OR m.club_number = ANY (p_club_numbers))
  ),
  typ AS (
    SELECT
      a.membership_type,
      count(*)                                       AS members,
      count(*) FILTER (WHERE coalesce(a.mdue,0) > 0) AS paying,
      (percentile_cont(0.5) WITHIN GROUP (ORDER BY a.mdue)
        FILTER (WHERE a.mdue > 0))::numeric          AS median_due
    FROM active a
    GROUP BY a.membership_type
  )
  SELECT
    a.member_id,
    a.agreement_number,
    a.first_name,
    a.last_name,
    a.club_number,
    a.membership_type,
    a.next_due_amount,
    round(a.mdue, 2)                                    AS monthly_dues,
    round(t.median_due, 2)                              AS type_median_dues,
    round(coalesce(a.mdue, 0) / nullif(t.median_due, 0), 3) AS pct_of_typical,
    a.begin_date,
    CASE WHEN a.begin_date IS NULL THEN NULL
         ELSE round((CURRENT_DATE - a.begin_date) / 30.44, 1) END AS tenure_months
  FROM active a
  JOIN typ t ON t.membership_type = a.membership_type
  WHERE (100.0 * t.paying / nullif(t.members, 0)) >= 50
    AND coalesce(a.mdue, 0) < 0.5 * t.median_due
  ORDER BY pct_of_typical ASC NULLS FIRST
  LIMIT 1000;
$$;

-- 114: Make membership_price_detail() finish for all clubs.
--
-- Migration 113 built the "others covered on this agreement" list with a
-- CROSS JOIN LATERAL that re-scanned the active CTE once per agreement. A CTE
-- has no indexes, so that is O(n^2): ~18.3k agreements x 21.1k active rows.
-- One club (3.2k rows) returned fine; all clubs hit the statement timeout, so
-- the all-clubs Excel and Google Sheets exports failed outright.
--
-- Same output, computed as a single grouped aggregate joined to the
-- representative rows — one hash/merge join instead of a nested loop. All
-- clubs now plan as a Merge Join and run in ~0.5s.
--
-- Also adds payment_frequency to the agreement key so the detail row count
-- matches sum(memberships) from membership_price_breakdown exactly (18,320).
-- Without it the two disagreed by one agreement that carries two frequencies
-- at the same amount.

CREATE OR REPLACE FUNCTION membership_price_detail(p_club_numbers text[] DEFAULT NULL)
RETURNS TABLE (
  member_id            text,
  agreement_number     text,
  first_name           text,
  last_name            text,
  email                text,
  club_number          text,
  membership_type      text,
  payment_frequency    text,
  charged_amount       numeric,
  monthly_price        numeric,
  begin_date           date,
  tenure_months        numeric,
  is_past_due          boolean,
  sales_person_name    text,
  people_on_agreement  bigint,
  other_members        text
)
LANGUAGE sql STABLE AS $$
  WITH active AS (
    SELECT
      m.*,
      coalesce(m.payment_frequency, '') AS freq,
      round(coalesce(m.next_due_amount, 0), 2) AS amt,
      round(CASE lower(coalesce(m.payment_frequency, ''))
        WHEN 'monthly'   THEN coalesce(m.next_due_amount, 0)
        WHEN 'bi-weekly' THEN coalesce(m.next_due_amount, 0) * 26.0 / 12.0
        WHEN 'annually'  THEN coalesce(m.next_due_amount, 0) / 12.0
        ELSE coalesce(m.next_due_amount, 0)
      END, 2) AS mdue
    FROM abc_members m
    WHERE m.member_status ILIKE 'active'
      AND (p_club_numbers IS NULL
           OR array_length(p_club_numbers, 1) IS NULL
           OR m.club_number = ANY (p_club_numbers))
  ),
  -- Everyone on each agreement, ordered oldest first. Same ORDER BY as `rep`
  -- below, so names[1] is the representative and array_position finds it.
  grp AS (
    SELECT
      a.club_number, a.agreement_number, a.membership_type, a.freq, a.amt,
      count(*) AS people_cnt,
      array_agg(a.member_id
        ORDER BY a.birth_date NULLS LAST, a.last_name, a.first_name, a.member_id) AS ids,
      array_agg(trim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, ''))
        ORDER BY a.birth_date NULLS LAST, a.last_name, a.first_name, a.member_id) AS names
    FROM active a
    GROUP BY 1, 2, 3, 4, 5
  ),
  -- One representative per agreement: oldest person on it stands in for the
  -- primary, since abc_members carries no primary flag.
  rep AS (
    SELECT DISTINCT ON (a.club_number, a.agreement_number, a.membership_type, a.freq, a.amt) a.*
    FROM active a
    ORDER BY a.club_number, a.agreement_number, a.membership_type, a.freq, a.amt,
             a.birth_date NULLS LAST, a.last_name, a.first_name, a.member_id
  )
  SELECT
    r.member_id,
    r.agreement_number,
    r.first_name,
    r.last_name,
    r.email,
    r.club_number,
    r.membership_type,
    r.freq,
    r.amt,
    r.mdue,
    r.begin_date,
    CASE WHEN r.begin_date IS NULL THEN NULL
         ELSE round((CURRENT_DATE - r.begin_date) / 30.44, 1) END,
    r.is_past_due,
    r.sales_person_name,
    g.people_cnt,
    -- Everyone else covered by this agreement, so a family stays auditable from
    -- the single row that carries its dues. Drop the representative by position
    -- rather than by name — two people on one agreement can share a name.
    nullif(array_to_string(g.names[1:p.pos - 1] || g.names[p.pos + 1:], ', '), '')
  FROM rep r
  JOIN grp g
    ON  g.club_number      = r.club_number
    AND g.agreement_number = r.agreement_number
    AND g.membership_type  = r.membership_type
    AND g.freq             = r.freq
    AND g.amt              = r.amt
  CROSS JOIN LATERAL (SELECT array_position(g.ids, r.member_id) AS pos) p
  ORDER BY r.club_number, 10 DESC, r.last_name, r.first_name;
$$;

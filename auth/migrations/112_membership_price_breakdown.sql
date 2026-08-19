-- 112: Price Breakdown for the Membership Audit report.
--
-- Two RPCs over abc_members (current = member_status ILIKE 'active'), sharing
-- the same monthly-equivalent normalization as migration 032 so the numbers
-- reconcile with the rest of the Membership Audit:
--   Monthly ×1, Bi-Weekly ×26/12, Annually ÷12, unknown/null frequency → raw.
--
--   membership_price_breakdown  grouped counts per club × type × frequency ×
--                               price. ~700 rows across all 7 clubs, so the
--                               client pivots it into whatever view it needs
--                               (price × club matrix, type filter, either
--                               price basis) from a single fetch.
--   membership_price_detail     one row per active member, for the Excel
--                               export of the same population.

CREATE OR REPLACE FUNCTION membership_price_breakdown(p_club_numbers text[] DEFAULT NULL)
RETURNS TABLE (
  club_number       text,
  membership_type   text,
  payment_frequency text,
  charged_amount    numeric,
  monthly_price     numeric,
  members           bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    m.club_number,
    m.membership_type,
    coalesce(m.payment_frequency, '')                       AS payment_frequency,
    round(coalesce(m.next_due_amount, 0), 2)                AS charged_amount,
    round(CASE lower(coalesce(m.payment_frequency, ''))
      WHEN 'monthly'   THEN coalesce(m.next_due_amount, 0)
      WHEN 'bi-weekly' THEN coalesce(m.next_due_amount, 0) * 26.0 / 12.0
      WHEN 'annually'  THEN coalesce(m.next_due_amount, 0) / 12.0
      ELSE coalesce(m.next_due_amount, 0)
    END, 2)                                                 AS monthly_price,
    count(*)                                                AS members
  FROM abc_members m
  WHERE m.member_status ILIKE 'active'
    AND (p_club_numbers IS NULL
         OR array_length(p_club_numbers, 1) IS NULL
         OR m.club_number = ANY (p_club_numbers))
  GROUP BY 1, 2, 3, 4, 5
  ORDER BY 6 DESC;   -- ordinal: output-param names are ambiguous in a sql-language body
$$;

CREATE OR REPLACE FUNCTION membership_price_detail(p_club_numbers text[] DEFAULT NULL)
RETURNS TABLE (
  member_id         text,
  agreement_number  text,
  first_name        text,
  last_name         text,
  email             text,
  club_number       text,
  membership_type   text,
  payment_frequency text,
  charged_amount    numeric,
  monthly_price     numeric,
  begin_date        date,
  tenure_months     numeric,
  is_past_due       boolean,
  sales_person_name text
)
LANGUAGE sql STABLE AS $$
  SELECT
    m.member_id,
    m.agreement_number,
    m.first_name,
    m.last_name,
    m.email,
    m.club_number,
    m.membership_type,
    coalesce(m.payment_frequency, ''),
    round(coalesce(m.next_due_amount, 0), 2),
    round(CASE lower(coalesce(m.payment_frequency, ''))
      WHEN 'monthly'   THEN coalesce(m.next_due_amount, 0)
      WHEN 'bi-weekly' THEN coalesce(m.next_due_amount, 0) * 26.0 / 12.0
      WHEN 'annually'  THEN coalesce(m.next_due_amount, 0) / 12.0
      ELSE coalesce(m.next_due_amount, 0)
    END, 2),
    m.begin_date,
    CASE WHEN m.begin_date IS NULL THEN NULL
         ELSE round((CURRENT_DATE - m.begin_date) / 30.44, 1) END,
    m.is_past_due,
    m.sales_person_name
  FROM abc_members m
  WHERE m.member_status ILIKE 'active'
    AND (p_club_numbers IS NULL
         OR array_length(p_club_numbers, 1) IS NULL
         OR m.club_number = ANY (p_club_numbers))
  ORDER BY m.club_number, 10 DESC, m.last_name, m.first_name;
$$;

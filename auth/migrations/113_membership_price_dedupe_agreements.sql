-- 113: Count agreements, not bodies, in the Membership Audit price breakdown.
--
-- Migration 112 counted one row per active member. abc_members carries one row
-- per PERSON, and every person on a FAMILY / COUPLE agreement carries that
-- agreement's full next_due_amount — so a $150 family of four read as four
-- members paying $150 ($600/mo). Across all clubs that inflated monthly dues
-- from ~$605k to ~$949k (36% over).
--
-- abc_members has no primary-member flag (every column on a family's rows is
-- identical except name, birth date, and member_id), so "primary member" is
-- derived rather than read:
--
--   * A membership is one distinct agreement_number WITHIN a club. Agreement
--     numbers are only unique per club — e.g. agreement 03057 exists at
--     Springfield, Keizer AND Clackamas as three unrelated people — so the key
--     is (club_number, agreement_number), never agreement_number alone.
--   * Rows collapse only when they also agree on membership_type and amount,
--     which is the family/couple signature. That leaves the ~63 same-club
--     agreement-number collisions between unrelated members counted separately
--     (they differ on both type and amount) instead of silently merging them.
--     It errs toward over-counting, never under.
--   * The representative row ("primary") is the OLDEST person on the agreement
--     — minors on a family plan are never the account holder. Ties break on
--     last name, first name, then member_id so the pick is deterministic.
--
-- Both functions now report `memberships` (what pays) alongside `people` (who
-- is covered), so the head count isn't lost — it just stops being multiplied
-- into the revenue.
--
-- Return types change, so the 112 signatures are dropped first (CREATE OR
-- REPLACE cannot change a function's OUT columns).

DROP FUNCTION IF EXISTS membership_price_breakdown(text[]);
DROP FUNCTION IF EXISTS membership_price_detail(text[]);

CREATE OR REPLACE FUNCTION membership_price_breakdown(p_club_numbers text[] DEFAULT NULL)
RETURNS TABLE (
  club_number       text,
  membership_type   text,
  payment_frequency text,
  charged_amount    numeric,
  monthly_price     numeric,
  memberships       bigint,
  people            bigint
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
    -- One membership = one agreement at this club. A family of four sharing
    -- agreement 99936 is 1 membership and 4 people.
    count(DISTINCT m.agreement_number)                      AS memberships,
    count(*)                                                AS people
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
  -- One representative per agreement: oldest person on it stands in for the
  -- primary, since abc_members carries no primary flag.
  rep AS (
    SELECT DISTINCT ON (a.club_number, a.agreement_number, a.membership_type, a.amt) a.*
    FROM active a
    ORDER BY a.club_number, a.agreement_number, a.membership_type, a.amt,
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
    coalesce(r.payment_frequency, ''),
    r.amt,
    r.mdue,
    r.begin_date,
    CASE WHEN r.begin_date IS NULL THEN NULL
         ELSE round((CURRENT_DATE - r.begin_date) / 30.44, 1) END,
    r.is_past_due,
    r.sales_person_name,
    g.people_cnt,
    -- Everyone else covered by this agreement, so a family stays auditable from
    -- the single row that carries its dues.
    g.other_names
  FROM rep r
  CROSS JOIN LATERAL (
    SELECT
      count(*) AS people_cnt,
      nullif(string_agg(
        trim(coalesce(o.first_name, '') || ' ' || coalesce(o.last_name, '')),
        ', ' ORDER BY o.birth_date NULLS LAST, o.last_name, o.first_name
      ) FILTER (WHERE o.member_id <> r.member_id), '') AS other_names
    FROM active o
    WHERE o.club_number      = r.club_number
      AND o.agreement_number = r.agreement_number
      AND o.membership_type  = r.membership_type
      AND o.amt              = r.amt
  ) g
  ORDER BY r.club_number, 10 DESC, r.last_name, r.first_name;
$$;

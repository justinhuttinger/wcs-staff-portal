-- 020_abc_revenue_membership_type.sql
-- Adds by_membership_type bucket to revenue_summary RPC.

CREATE OR REPLACE FUNCTION revenue_summary(
  p_start_date   date,
  p_end_date     date,
  p_location_filter text[] DEFAULT NULL
)
RETURNS TABLE (
  bucket          text,
  key1            text,
  key2            text,
  total_amount    numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH filtered AS (
    SELECT *
    FROM abc_revenue_transactions
    WHERE payment_date BETWEEN p_start_date AND p_end_date
      AND (p_location_filter IS NULL
           OR cardinality(p_location_filter) = 0
           OR location_slug = ANY(p_location_filter))
  )
  SELECT 'total'::text AS bucket, NULL::text AS key1, NULL::text AS key2,
         COALESCE(SUM(payment_amount), 0) AS total_amount
  FROM filtered
  UNION ALL
  SELECT 'by_club'::text, location_slug, NULL::text,
         SUM(payment_amount)
  FROM filtered
  GROUP BY location_slug
  UNION ALL
  SELECT 'by_profit_center'::text, profit_center, NULL::text,
         SUM(payment_amount)
  FROM filtered
  GROUP BY profit_center
  UNION ALL
  SELECT 'by_day'::text, payment_date::text, NULL::text,
         SUM(payment_amount)
  FROM filtered
  GROUP BY payment_date
  UNION ALL
  SELECT 'by_membership_type'::text,
         COALESCE(NULLIF(membership_type_code, ''), '(none)'),
         NULL::text,
         SUM(payment_amount)
  FROM filtered
  GROUP BY COALESCE(NULLIF(membership_type_code, ''), '(none)');
$$;

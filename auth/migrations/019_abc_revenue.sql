-- 019_abc_revenue.sql
-- ABC "Revenue by Profit Center" ingest tables and aggregation RPC.
-- Spec: docs/superpowers/specs/2026-05-13-revenue-reporting-design.md
-- Ingested via SendGrid Inbound Parse (daily) + admin upload (backfill).

-- -------------------------------------------------------------------------
-- abc_revenue_imports — one row per ingest attempt (webhook OR admin upload).
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS abc_revenue_imports (
  id              bigserial PRIMARY KEY,
  source          text        NOT NULL CHECK (source IN ('sendgrid_webhook', 'admin_upload')),
  uploaded_by     uuid        REFERENCES auth.users(id),
  period_start    date        NOT NULL,
  period_end      date        NOT NULL,
  reported_total  numeric(14,2),
  computed_total  numeric(14,2),
  row_count       int,
  filename        text,
  email_subject   text,
  status          text        NOT NULL CHECK (status IN ('success','partial','failed')),
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_abc_revenue_imports_created
  ON abc_revenue_imports (created_at DESC);

-- -------------------------------------------------------------------------
-- abc_revenue_transactions — transaction grain (one row per CSV line).
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS abc_revenue_transactions (
  id                    bigserial PRIMARY KEY,
  payment_date          date          NOT NULL,
  club_number           text          NOT NULL,
  location_slug         text          NOT NULL,
  member_number         text,
  agreement_number      text,
  member_first_name     text,
  member_last_name      text,
  billing_type          text,
  membership_type_code  text,
  profit_center         text          NOT NULL,
  catalog_item          text,
  payment_code_desc     text,
  payment_type          text,
  collected_method      text,
  receipt_number        text,
  gl_code               text,
  payment_amount        numeric(12,2) NOT NULL,
  total_amount          numeric(12,2),
  tax_amount            numeric(12,2),
  source_file_id        bigint        NOT NULL REFERENCES abc_revenue_imports(id) ON DELETE CASCADE,
  source_row_index      int           NOT NULL,
  imported_at           timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (source_file_id, source_row_index)
);

CREATE INDEX IF NOT EXISTS idx_abc_revenue_tx_date
  ON abc_revenue_transactions (payment_date);
CREATE INDEX IF NOT EXISTS idx_abc_revenue_tx_loc_date
  ON abc_revenue_transactions (location_slug, payment_date);
CREATE INDEX IF NOT EXISTS idx_abc_revenue_tx_pc_date
  ON abc_revenue_transactions (profit_center, payment_date);
CREATE INDEX IF NOT EXISTS idx_abc_revenue_tx_loc_pc_date
  ON abc_revenue_transactions (location_slug, profit_center, payment_date);

-- -------------------------------------------------------------------------
-- revenue_summary(start_date, end_date, location_filter) — single-call
-- rollup used by /reports/revenue/summary. NULL/empty location_filter means
-- all WCS clubs.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION revenue_summary(
  p_start_date   date,
  p_end_date     date,
  p_location_filter text[] DEFAULT NULL
)
RETURNS TABLE (
  bucket          text,    -- 'total' | 'by_club' | 'by_profit_center' | 'by_day'
  key1            text,    -- slug for by_club, profit_center for by_profit_center, date for by_day
  key2            text,    -- reserved for future use
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
  GROUP BY payment_date;
$$;

-- PostgREST auto-exposes these at /rpc/<name>.
GRANT EXECUTE ON FUNCTION revenue_summary(date, date, text[]) TO authenticated, service_role;

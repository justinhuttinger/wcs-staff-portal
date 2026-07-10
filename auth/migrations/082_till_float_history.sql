-- 082_till_float_history.sql
-- Effective-dated till floats. Until now till_settings held ONE standard_float
-- per club, applied to every day when reconciling — so editing a club's float
-- silently rewrote the expected variance of every past day. This table records
-- the float as of an effective date; reconciliation for a business date uses the
-- most recent float with effective_date <= that date, so changing the float only
-- affects that day forward and historical variances stay put.
--
-- till_settings.standard_float is kept in sync with the CURRENT (latest) float
-- as a convenience/fallback; this table is the source of truth for history.

CREATE TABLE IF NOT EXISTS till_float_history (
  club_number    text NOT NULL,
  effective_date date NOT NULL,
  standard_float numeric(12,2) NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  PRIMARY KEY (club_number, effective_date)
);

-- Seed from the current single float so all PAST dates keep the value they were
-- reconciled with. A far-past effective date makes this the baseline for every
-- existing till record.
INSERT INTO till_float_history (club_number, effective_date, standard_float)
SELECT club_number, DATE '2000-01-01', standard_float FROM till_settings
ON CONFLICT (club_number, effective_date) DO NOTHING;

ALTER TABLE till_float_history ENABLE ROW LEVEL SECURITY;

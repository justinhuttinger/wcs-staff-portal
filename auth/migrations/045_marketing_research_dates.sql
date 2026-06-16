-- 045_marketing_research_dates.sql
-- Structured start/end dates for research opportunities so multi-day events
-- (e.g. "Aug 12-14") carry a real date range, not just free text. event_date
-- stays as the human-readable label.

ALTER TABLE marketing_research ADD COLUMN IF NOT EXISTS event_start date;
ALTER TABLE marketing_research ADD COLUMN IF NOT EXISTS event_end   date;

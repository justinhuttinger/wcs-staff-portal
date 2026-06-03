-- Speed to Lead: track when an opportunity last changed stage, so the report
-- can tell genuine "New Lead" entrants (currently at New Lead, or moved since
-- creation) from opps created directly at a later stage (created == last change,
-- not at New Lead). Populated by the opportunity sync transform.
ALTER TABLE ghl_opportunities_v2 ADD COLUMN IF NOT EXISTS last_stage_change_at TIMESTAMPTZ;

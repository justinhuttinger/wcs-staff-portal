-- 017_ghl_contacts_attribution.sql
-- Adds attribution columns to ghl_contacts_v2 so we can compute our own
-- per-FB-ad ROAS and cost-per-membership (Meta's reporting has been unreliable).
-- The full attribution object is captured as JSONB; we lift adId out via a
-- generated column + GIN index so the FB ROAS report join stays fast even
-- across 100k+ contacts.

ALTER TABLE ghl_contacts_v2
  ADD COLUMN IF NOT EXISTS attribution_source       JSONB,
  ADD COLUMN IF NOT EXISTS last_attribution_source  JSONB;

-- Functional index on first-touch adId — this is the cleanest FB join key
-- (only populated when the lead came from a Facebook ad with proper ID tagging
-- or a Facebook Lead Ad).
CREATE INDEX IF NOT EXISTS idx_ghl_contacts_attr_adid
  ON ghl_contacts_v2 ((attribution_source->>'adId'))
  WHERE attribution_source->>'adId' IS NOT NULL;

-- Secondary index for ad-set / campaign rollups
CREATE INDEX IF NOT EXISTS idx_ghl_contacts_attr_adgroupid
  ON ghl_contacts_v2 ((attribution_source->>'adGroupId'))
  WHERE attribution_source->>'adGroupId' IS NOT NULL;

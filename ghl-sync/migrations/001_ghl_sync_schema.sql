-- GHL Sync Schema
-- Run in WCS Supabase project (existing project ID: ybopxxydsuwlbwxiuzve)

-- LOCATIONS lookup
CREATE TABLE IF NOT EXISTS ghl_locations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- PIPELINES
CREATE TABLE IF NOT EXISTS ghl_pipelines (
  id            TEXT PRIMARY KEY,
  location_id   TEXT NOT NULL REFERENCES ghl_locations(id),
  name          TEXT NOT NULL,
  synced_at     TIMESTAMPTZ DEFAULT now()
);

-- PIPELINE STAGES
CREATE TABLE IF NOT EXISTS ghl_pipeline_stages (
  id            TEXT PRIMARY KEY,
  pipeline_id   TEXT NOT NULL REFERENCES ghl_pipelines(id),
  name          TEXT NOT NULL,
  position      INTEGER,
  synced_at     TIMESTAMPTZ DEFAULT now()
);

-- CUSTOM FIELD DEFINITIONS
CREATE TABLE IF NOT EXISTS ghl_custom_field_defs (
  id            TEXT PRIMARY KEY,
  location_id   TEXT NOT NULL REFERENCES ghl_locations(id),
  name          TEXT NOT NULL,
  field_key     TEXT,
  data_type     TEXT,
  synced_at     TIMESTAMPTZ DEFAULT now()
);

-- CONTACTS (new table — does NOT replace existing ghl_contacts yet)
CREATE TABLE IF NOT EXISTS ghl_contacts_v2 (
  id                  TEXT PRIMARY KEY,
  location_id         TEXT NOT NULL REFERENCES ghl_locations(id),
  first_name          TEXT,
  last_name           TEXT,
  full_name           TEXT,
  email               TEXT,
  phone               TEXT,
  date_of_birth       DATE,
  address             JSONB,
  tags                TEXT[],
  source              TEXT,
  assigned_user_id    TEXT,
  assigned_user_name  TEXT,
  dnd                 BOOLEAN DEFAULT false,
  type                TEXT,
  custom_fields       JSONB,
  created_at_ghl      TIMESTAMPTZ,
  updated_at_ghl      TIMESTAMPTZ,
  synced_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ghl_contacts_v2_location ON ghl_contacts_v2(location_id);
CREATE INDEX IF NOT EXISTS idx_ghl_contacts_v2_email ON ghl_contacts_v2(email);
CREATE INDEX IF NOT EXISTS idx_ghl_contacts_v2_updated ON ghl_contacts_v2(updated_at_ghl);
CREATE INDEX IF NOT EXISTS idx_ghl_contacts_v2_tags ON ghl_contacts_v2 USING GIN(tags);

-- OPPORTUNITIES (new table — does NOT replace existing ghl_opportunities yet)
CREATE TABLE IF NOT EXISTS ghl_opportunities_v2 (
  id                  TEXT PRIMARY KEY,
  location_id         TEXT NOT NULL REFERENCES ghl_locations(id),
  contact_id          TEXT REFERENCES ghl_contacts_v2(id),
  pipeline_id         TEXT REFERENCES ghl_pipelines(id),
  stage_id            TEXT REFERENCES ghl_pipeline_stages(id),
  pipeline_name       TEXT,
  stage_name          TEXT,
  name                TEXT,
  status              TEXT,
  monetary_value      NUMERIC(12,2),
  assigned_user_id    TEXT,
  assigned_user_name  TEXT,
  source              TEXT,
  custom_fields       JSONB,
  lost_reason         TEXT,
  created_at_ghl      TIMESTAMPTZ,
  updated_at_ghl      TIMESTAMPTZ,
  closed_at           TIMESTAMPTZ,
  synced_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ghl_opps_v2_location ON ghl_opportunities_v2(location_id);
CREATE INDEX IF NOT EXISTS idx_ghl_opps_v2_pipeline ON ghl_opportunities_v2(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_ghl_opps_v2_stage ON ghl_opportunities_v2(stage_id);
CREATE INDEX IF NOT EXISTS idx_ghl_opps_v2_status ON ghl_opportunities_v2(status);
CREATE INDEX IF NOT EXISTS idx_ghl_opps_v2_updated ON ghl_opportunities_v2(updated_at_ghl);
CREATE INDEX IF NOT EXISTS idx_ghl_opps_v2_contact ON ghl_opportunities_v2(contact_id);

-- SYNC LOG
CREATE TABLE IF NOT EXISTS ghl_sync_log (
  id              BIGSERIAL PRIMARY KEY,
  sync_type       TEXT NOT NULL,
  entity          TEXT NOT NULL,
  location_id     TEXT,
  records_fetched INTEGER DEFAULT 0,
  records_upserted INTEGER DEFAULT 0,
  errors          JSONB,
  started_at      TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ,
  duration_ms     INTEGER
);

-- SYNC STATE (for delta sync tracking)
CREATE TABLE IF NOT EXISTS ghl_sync_state (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO ghl_sync_state (key, value)
VALUES ('last_delta_sync', NULL)
ON CONFLICT DO NOTHING;

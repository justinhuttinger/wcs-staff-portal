-- Speed to Lead: first human outbound contact per Membership-pipeline opportunity.
CREATE TABLE IF NOT EXISTS ghl_first_contact (
  opportunity_id          TEXT PRIMARY KEY REFERENCES ghl_opportunities_v2(id),
  contact_id              TEXT,
  location_id             TEXT NOT NULL,
  opportunity_created_at  TIMESTAMPTZ,
  first_human_contact_at  TIMESTAMPTZ,
  first_contact_kind      TEXT,            -- 'sms' | 'call'
  checked_at              TIMESTAMPTZ DEFAULT now(),
  resolved                BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_first_contact_location ON ghl_first_contact(location_id);
CREATE INDEX IF NOT EXISTS idx_first_contact_oppcreated ON ghl_first_contact(opportunity_created_at);
CREATE INDEX IF NOT EXISTS idx_first_contact_unresolved ON ghl_first_contact(resolved) WHERE resolved = false;

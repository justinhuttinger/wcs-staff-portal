-- 017_ghl_custom_field_cache.sql
-- Persistent cache of GHL custom field metadata per location, keyed by the
-- GHL-generated fieldKey (e.g. `contact.cancel_reason`). Used by the
-- ghlCustomFields service to resolve fieldKey -> field id without hitting
-- GHL on every webhook event. TTL is enforced in code via refreshed_at.

CREATE TABLE IF NOT EXISTS ghl_custom_field_cache (
  location_id  TEXT NOT NULL,
  field_key    TEXT NOT NULL,
  field_id     TEXT NOT NULL,
  name         TEXT,
  data_type    TEXT,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_ghl_custom_field_cache_location ON ghl_custom_field_cache(location_id);

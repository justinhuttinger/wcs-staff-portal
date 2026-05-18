-- 022_contact_deletion_archive.sql
-- Safety net for the cross-location contact cleanup process.
--
-- When the same person appears as a lead in one GHL location and a
-- (sale-tagged + ABC-confirmed) member in another location, the lead-side
-- contact gets deleted from GHL via the API. Before the API call fires,
-- we snapshot the full contact into `deleted_contacts_archive`. Every
-- successful (or failed) deletion is logged to `contact_deletion_log`
-- with the GHL API response so we have an audit trail.
--
-- These tables are write-rarely / read-rarely (only touched on a delete,
-- or during a manual recovery). No reports query them.

CREATE TABLE IF NOT EXISTS deleted_contacts_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The GHL contact ID that was deleted. Not unique on its own because
  -- the same ID could theoretically be re-created in GHL after deletion;
  -- we keep history rather than enforce uniqueness here.
  ghl_contact_id TEXT NOT NULL,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  location_slug TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  first_name TEXT,
  last_name TEXT,
  tags TEXT[],
  custom_fields JSONB,
  -- Full row from ghl_contacts_v2 at time of delete. Preserves anything
  -- not modeled above (assigned_user_id, source, dnd, address, etc.).
  contact_snapshot JSONB NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Who/what triggered the archive. e.g.
  --   'backlog_cleanup_script' — one-off cleanup of pre-existing duplicates
  --   'ghl_sync_auto'           — ongoing detection in ghl-sync delta
  --   'manual'                  — staff-driven via portal admin
  archived_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deleted_contacts_archive_email ON deleted_contacts_archive(email);
CREATE INDEX IF NOT EXISTS idx_deleted_contacts_archive_ghl_id ON deleted_contacts_archive(ghl_contact_id);
CREATE INDEX IF NOT EXISTS idx_deleted_contacts_archive_archived_at ON deleted_contacts_archive(archived_at DESC);


CREATE TABLE IF NOT EXISTS contact_deletion_log (
  id BIGSERIAL PRIMARY KEY,
  ghl_contact_id TEXT NOT NULL,
  -- Where the contact lived (the location being deleted FROM).
  lead_location_slug TEXT NOT NULL,
  -- The matched location where the person actually signed up. Recorded
  -- so we can answer "why did we delete this contact?" later.
  member_location_slug TEXT NOT NULL,
  email TEXT,
  -- Mirrors deleted_contacts_archive.archived_by values.
  triggered_by TEXT NOT NULL,
  archive_id UUID REFERENCES deleted_contacts_archive(id) ON DELETE SET NULL,
  -- Raw GHL API response details for debugging. status is the HTTP code
  -- returned by DELETE /contacts/{id}; response holds the body (often
  -- {"succeded": true} on success, or an error payload).
  ghl_api_status INT,
  ghl_api_response JSONB,
  -- Populated only when the API call failed (e.g., 404, 429, network).
  -- Successful deletions leave this NULL.
  error_message TEXT,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_deletion_log_contact_id ON contact_deletion_log(ghl_contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_deletion_log_deleted_at ON contact_deletion_log(deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_deletion_log_email ON contact_deletion_log(email);

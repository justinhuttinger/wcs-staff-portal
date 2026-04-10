-- Location Permissions: per-staff sign-in and reporting access per location
-- Adds granular permissions to existing staff_locations junction table
-- Default: both true (backwards compatible with existing data)

ALTER TABLE staff_locations
  ADD COLUMN IF NOT EXISTS can_sign_in BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_view_reports BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN staff_locations.can_sign_in IS 'Whether staff can sign into the portal at this location';
COMMENT ON COLUMN staff_locations.can_view_reports IS 'Whether staff can view reporting data for this location';

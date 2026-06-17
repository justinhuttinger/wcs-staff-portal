-- 046_staff_active.sql
--
-- Adds an active/inactive flag to portal staff (login) accounts.
--
-- Until now the only way to remove portal access was a hard DELETE. This adds
-- a reversible "deactivate" state: an inactive staff member stays on file (so
-- their history/assignments survive) but is blocked from signing in. The login
-- block itself is enforced on the Supabase auth user (banned), not here — this
-- column is the queryable flag the admin UI filters and badges on.
--
-- Defaults to true so every existing account stays active.
--
-- This migration is idempotent.

BEGIN;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN staff.is_active IS 'Portal login enabled. false = deactivated (Supabase auth user is banned, cannot sign in). Reversible.';

COMMIT;

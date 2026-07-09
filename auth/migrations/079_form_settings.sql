-- Form Builder: per-form settings blob (completion message, allow-resubmit toggle).
-- Stored as a single jsonb column so new settings never need a schema change.
alter table forms add column if not exists settings jsonb not null default '{}'::jsonb;

-- 209: Club-wide GHL External Tracking.
-- Each club is its own GHL sub-account with its own External Tracking snippet.
-- Set once per club in Admin -> Club Integrations; every quiz and form at that
-- club loads it (a quiz can still override it per club in quiz_clubs).
alter table club_integrations add column if not exists ghl_tracking_src text;
alter table club_integrations add column if not exists ghl_tracking_id text;

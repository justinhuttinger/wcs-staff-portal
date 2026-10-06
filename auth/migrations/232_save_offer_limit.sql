-- 232: WCS Save, limit how often one member can take a save offer.
--
-- A member who took offer_limit_count offers (save_requests outcome 'saved')
-- in the last offer_limit_days days sees no offers and goes straight to
-- cancelling. Default: 1 every 90 days. Edited in Admin -> Save Offers ->
-- Settings. The wcs-save Worker uses the same defaults until this is applied.
alter table save_settings
  add column if not exists offer_limit_count int not null default 1
    check (offer_limit_count between 0 and 10),
  add column if not exists offer_limit_days int not null default 90
    check (offer_limit_days between 0 and 730);

-- The Worker counts a member's recent saves on every reason step.
create index if not exists save_requests_member_saved_idx
  on save_requests (member_id, completed_at)
  where outcome = 'saved';

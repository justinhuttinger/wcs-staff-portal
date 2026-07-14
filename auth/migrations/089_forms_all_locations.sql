-- Forms "All Locations" option.
--
-- A form with location_id = NULL belongs to every club at once (one link, one
-- combined Google Sheet). Relax the NOT NULL constraint so admins can create
-- these. Existing rows keep their location_id; nothing is backfilled.
alter table forms alter column location_id drop not null;

-- facility_locations becomes club_features, and Group X joins it.
--
-- 177 shipped a table that answers "does this club have a pool". The same
-- question is now being asked of Group X -- it runs everywhere today, but that
-- should be a configured fact rather than an assumption baked into the code.
-- Two tables answering one question, keyed differently, is how they drift, so
-- there is one.
--
-- Renamed rather than added alongside: facility_locations was created hours ago
-- with nothing but its seed in it and one consumer. Renaming now costs a
-- migration; renaming once clubs are configured costs a data move.
--
-- Group X is seeded ENABLED for every club, which is exactly what the code did
-- implicitly before this. Nobody loses a board.

alter table if exists facility_locations rename to club_features;
alter table if exists club_features rename column facility to feature;

insert into club_features (club_number, feature, enabled)
select c.club_number, 'groupx', true
from (values ('30935'), ('31599'), ('7655'), ('31598'), ('31600'), ('31601'), ('32073')) as c(club_number)
on conflict (club_number, feature) do nothing;

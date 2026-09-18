-- Eugene's revenue was invisible on every club-filtered report.
--
-- The ABC "Revenue by Profit Center" CSV writes Eugene as "07655". Every other
-- source of club numbers -- the ABC API, abc_members, checkins_hourly,
-- abc_pt_services, inventory_transactions -- writes "7655". So a report asking
-- for club 7655 matched no revenue rows at all: Club Snapshot, Topline and
-- revenue per member all read $0 for Eugene, while all-club totals stayed
-- correct because they apply no club filter.
--
-- The parser now unpads on the way in (services/revenueCsvParser.js
-- normalizeClub); this repoints the 116,525 rows already stored. Data only, no
-- schema change, and idempotent: re-running matches nothing.
--
-- Only this table was ever padded -- every other club_number/club_code column
-- in the database was checked and holds none.

update public.abc_revenue_transactions
   set club_number = '7655'
 where club_number = '07655';

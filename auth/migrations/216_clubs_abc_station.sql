-- 216: ABC station id per club, for the kiosk waiver's ABC check-in.
--
-- prospects---documents reads it (via its club registry) so a club added in
-- Admin -> Clubs can check members in without an edit to clubs-config.json.
-- Backfilled from that file, where every club already carries one.

alter table public.clubs add column if not exists abc_station_id text;

update public.clubs c set abc_station_id = v.station_id, updated_at = now()
from (values
  ('30935', 'E42B9D7C33C908BEE0532AE014ACBF25'),
  ('31599', '1E19FCD0EF6B33BAE06328E014AC862D'),
  ('7655',  '76A46412889485A2E05302E014ACDD95'),
  ('31598', '1D8ADAAA302604F9E06348E014AC9B57'),
  ('31600', '1E1934CDC139434AE06329E014AC9B64'),
  ('31601', '1E185AA71C3E0EF8E06329E014AC4990'),
  ('32073', '401FF85A16BB61E3E0633CE114AC0CD6')
) as v(club_number, station_id)
where c.club_number = v.club_number and c.abc_station_id is null;

notify pgrst, 'reload schema';

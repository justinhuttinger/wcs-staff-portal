-- Which clubs actually have courts and a pool.
--
-- Until now every club advertised both. A club with no pool still had a Pool
-- board URL that rendered an empty week, and its staff still saw a Pool pill
-- with nothing behind it.
--
-- Seeded ENABLED for every club/facility pair, which reproduces today's
-- behaviour exactly: nobody loses a board on deploy, and the clubs that do not
-- have a facility get switched off by hand in Admin -> Courts & Pool. The
-- alternative -- inferring from which pairs have events -- would silently
-- disable a club that is set up but has not scheduled anything yet, which is a
-- blank TV nobody asked for.

create table if not exists facility_locations (
  club_number text not null,
  facility    text not null,
  enabled     boolean not null default true,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  primary key (club_number, facility)
);

-- Service-role only, like the rest of the portal's tables. See
-- reference: the portal DB has no end-user Postgres roles.
alter table facility_locations enable row level security;

insert into facility_locations (club_number, facility, enabled)
select c.club_number, f.facility, true
from (values ('30935'), ('31599'), ('7655'), ('31598'), ('31600'), ('31601'), ('32073')) as c(club_number)
cross join (values ('courts'), ('pool')) as f(facility)
on conflict (club_number, facility) do nothing;

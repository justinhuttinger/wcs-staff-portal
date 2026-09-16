-- One secret, login-free attendance link per club, so whoever is at the desk
-- (or the instructor) can log a Group X headcount without a portal account.
-- Same model as tour_location_config (068): the token IS the access, and an
-- admin can regenerate it from Admin -> Group X -> Attendance links if it leaks.
--
-- Keyed on club_number rather than location_id because every other Group X
-- table is, and the public routes resolve the club straight from this row.
--
-- Idempotent: safe to re-run.

create table if not exists group_x_attendance_links (
  club_number  text primary key,
  public_token text not null unique,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Service-role only, per repo convention.
alter table group_x_attendance_links enable row level security;

-- Mirrors CLUBS in auth/src/lib/groupXClubs.js.
insert into group_x_attendance_links (club_number, public_token)
select c, encode(gen_random_bytes(24), 'hex')
from unnest(array['30935', '31599', '7655', '31598', '31600', '31601', '32073']) as c
on conflict (club_number) do nothing;

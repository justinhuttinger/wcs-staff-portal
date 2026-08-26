-- Analytics > Salesperson Performance reads two windows that had no index:
--   abc_members by sign_date          (101k rows, previously a seq scan)
--   day_one_appointments by booked_at (the table is only indexed on
--                                      scheduled_date, which is a different
--                                      question: when the Day One happens, not
--                                      when it was booked)
--
-- Both are plain CREATE INDEX rather than CONCURRENTLY: the tables are small
-- enough that the build is sub-second, and CONCURRENTLY cannot run inside the
-- transaction the SQL editor may wrap this in.

create index if not exists idx_abc_members_sign_date
  on public.abc_members (sign_date)
  where sign_date is not null;

-- Club-scoped variant: every report query filters club_number first, then the
-- date window.
create index if not exists idx_abc_members_club_sign_date
  on public.abc_members (club_number, sign_date);

create index if not exists idx_day_one_appointments_booked_at
  on public.day_one_appointments (booked_at desc)
  where booked_at is not null;

create index if not exists idx_day_one_appointments_loc_booked_at
  on public.day_one_appointments (location_slug, booked_at desc);

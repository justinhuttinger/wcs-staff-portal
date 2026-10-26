-- Childcare check-in: a login-free iPad page per club (childcare.html?token=)
-- where the childcare desk records who is in the room.
--
-- Everything on a visit is TYPED by staff on the day. Nothing is looked up from
-- ABC and a child is never linked to a parent record: two visits by the same
-- child are two independent rows. That is deliberate (Justin, 2026-10-26).
--
-- Same token model as group_x_attendance_links (203): the token IS the access,
-- and an admin can regenerate it from Admin -> Childcare Check-In if it leaks.
--
-- Idempotent: safe to re-run.

create table if not exists childcare_checkin_links (
  club_number  text primary key,
  public_token text not null unique,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table childcare_checkin_links enable row level security;

-- Mirrors config/clubs.json.
insert into childcare_checkin_links (club_number, public_token)
select c, encode(gen_random_bytes(24), 'hex')
from unnest(array['30935', '31599', '7655', '31598', '31600', '31601', '32073']) as c
on conflict (club_number) do nothing;

create table if not exists childcare_visits (
  id                  uuid primary key default gen_random_uuid(),
  club_number         text not null,

  child_name          text not null,
  -- Age is stored in months so under-1s stay countable (ratio rules care about
  -- them separately). The desk types years or months; the API converts.
  child_age_months    integer not null check (child_age_months between 0 and 216),

  parent_name         text not null,
  parent_phone        text not null,
  membership_kind     text not null check (membership_kind in ('monthly', 'drop_in')),

  -- Set at check-in when the parent says someone else may pick up.
  alt_pickup_name     text,

  checked_in_at       timestamptz not null default now(),
  checked_out_at      timestamptz,
  -- Who took the child: the parent who dropped off, the person they named at
  -- check-in, or someone else (the desk confirmed with the parent first).
  checked_out_by      text check (checked_out_by in ('same_parent', 'approved_alternate', 'other')),
  checked_out_by_name text,

  -- Still open when the day ended. The pickup time is unknown, so it is left
  -- null and the visit is excluded from length-of-stay numbers.
  auto_closed         boolean not null default false,

  created_at          timestamptz not null default now(),

  constraint childcare_checkout_complete check (
    (checked_out_at is null and checked_out_by is null)
    or (checked_out_at is not null and checked_out_by is not null)
  )
);

alter table childcare_visits enable row level security;

-- The iPad board: who is in the room right now at this club.
create index if not exists childcare_visits_open_idx
  on childcare_visits (club_number, checked_in_at)
  where checked_out_at is null and auto_closed = false;

-- Reports: a club over a date range.
create index if not exists childcare_visits_club_time_idx
  on childcare_visits (club_number, checked_in_at desc);

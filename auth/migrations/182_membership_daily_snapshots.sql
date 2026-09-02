-- 182: membership history, recorded rather than reconstructed.
--
-- THE PROBLEM THIS EXISTS FOR
--
-- abc_members is a CURRENT-STATE table: one row per member holding the status
-- they are in today and the date they entered it. When somebody cancels and
-- re-joins, since_date moves onto the new membership and the earlier one stops
-- existing. Measured 2026-09-02: 1,937 of 22,514 active members (8.6%) have a
-- record that predates their current membership by more than 60 days.
--
-- Every historical membership figure is therefore reconstructed from present
-- state, and every one of them UNDERSTATES the past:
--
--   members as of 2026-03-01   15,619, missing at least   436
--   members as of 2025-09-01   14,371, missing at least   752
--
-- The error grows the further back you look, and it always runs one way, so
-- year-over-year comparisons flatter the present.
--
-- WHY NOT A BACKFILL
--
-- ABC's REST API is current-state at every endpoint. Probed 2026-09-02 against
-- a known re-joiner: members/{id}/agreements, /agreement, /agreements/history,
-- /memberships and /history all 404; members/{id}/agreements/invoices returns
-- FUTURE scheduled billing, not history; the bulk members/agreements endpoint
-- returns exactly one agreement per member with no duplicate member ids.
-- Dues transactions were also considered and rejected: they cover 9,193 payers
-- against 19,247 primary active members, because annual, paid-in-full,
-- insurance and family members do not bill monthly. Reconstructing from them
-- would swap one wrong number for a different wrong number.
--
-- So the past cannot be recovered from anything we hold. This table stops the
-- erosion from the night it deploys, exactly as kpi_daily_snapshots did — its
-- header says "no backfill, history starts the day this deploys" for the same
-- reason.

create table if not exists membership_daily_snapshots (
  snapshot_date      date not null,
  location_slug      text not null,

  -- Counted the way analytics_topline_members_as_of counts: on the books at
  -- this date, excluded membership types dropped, conditional-membership rule
  -- applied. Stored rather than derived so a re-join can never rewrite it.
  total_members      integer,
  -- The same count with nothing excluded, so a later change to the exclusion
  -- rules can be understood against what was actually there rather than
  -- silently reinterpreting old rows.
  total_members_raw  integer,

  -- Flows for the day, on the same definitions the reports use: joined on
  -- since_date, left on member_status_date across Cancelled, Expired and
  -- Return For Collection.
  joined             integer,
  left_count         integer,

  past_due_members   integer,
  past_due_balance   numeric,

  computed_at        timestamptz not null default now(),

  primary key (snapshot_date, location_slug)
);

comment on table membership_daily_snapshots is
  'One row per club per night: membership as it actually stood that day. Exists because abc_members is current-state only, so historical counts reconstructed from it understate the past by ~5% at twelve months. No backfill is possible — history starts the day this deploys.';

-- Reading a club's line over time is the only query this table has.
create index if not exists membership_daily_snapshots_club_idx
  on membership_daily_snapshots (location_slug, snapshot_date desc);

-- The portal DB is service-role only. RLS on with no policy, so nothing is
-- reachable if an anon key ever leaks.
alter table membership_daily_snapshots enable row level security;

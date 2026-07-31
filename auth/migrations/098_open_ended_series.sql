-- Open-ended repeating events.
--
-- "Lap swim every weekday" has no end date. Storing that as ends_on = null and
-- materialising occurrences out to a rolling horizon is the honest way to do
-- it: we cannot insert infinite rows, so a nightly job tops each series up.
--
-- materialized_through records how far each series has actually been written,
-- so the top-up knows where to resume and never double-creates.
--
-- This repo has no migration runner. Apply by hand to prod Supabase after merge.

alter table facility_series alter column ends_on drop not null;

alter table facility_series
  add column if not exists materialized_through date;

-- Backfill: every existing series is closed-ended and fully materialised.
update facility_series
   set materialized_through = ends_on
 where materialized_through is null;

-- The top-up job asks "which live series need more occurrences?"
create index if not exists facility_series_open_idx
  on facility_series (canceled_at, materialized_through);

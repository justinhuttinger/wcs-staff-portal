-- Open-ended Group X series.
--
-- Mirrors 098 for facilities. A class that runs "every Tuesday until further
-- notice" cannot be stored as infinite rows, so occurrences are created in ABC
-- out to a rolling horizon and topped up nightly. materialized_through records
-- how far each series has actually been written.
--
-- This repo has no migration runner. Apply by hand to prod Supabase after merge.

alter table group_x_series alter column ends_on drop not null;

alter table group_x_series
  add column if not exists materialized_through date;

-- Every existing series is closed-ended and fully materialised.
update group_x_series
   set materialized_through = ends_on
 where materialized_through is null;

create index if not exists group_x_series_open_idx
  on group_x_series (canceled_at, materialized_through);

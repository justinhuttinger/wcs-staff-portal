-- Childcare pickup names become first + last, like the child and parent
-- (Justin, 2026-10-26). Two names change:
--   alt_pickup_name      the person the parent approved at check-in
--   checked_out_by_name  who actually took the child
--
-- Existing rows are split on the first space ("Mary Jo Smith" -> "Mary",
-- "Jo Smith"); a single word lands in first name with last name empty. Then
-- the single-name columns are dropped so nothing reads a stale copy.
--
-- Apply as soon as the code that reads the new columns deploys: the previous
-- code reads the dropped columns.

alter table childcare_visits
  add column if not exists alt_pickup_first_name text,
  add column if not exists alt_pickup_last_name text,
  add column if not exists checked_out_by_first_name text,
  add column if not exists checked_out_by_last_name text;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'childcare_visits' and column_name = 'alt_pickup_name') then
    update childcare_visits set
      alt_pickup_first_name = split_part(btrim(alt_pickup_name), ' ', 1),
      alt_pickup_last_name  = btrim(substr(btrim(alt_pickup_name), length(split_part(btrim(alt_pickup_name), ' ', 1)) + 1))
    where alt_pickup_name is not null and alt_pickup_first_name is null;

    update childcare_visits set
      checked_out_by_first_name = split_part(btrim(checked_out_by_name), ' ', 1),
      checked_out_by_last_name  = btrim(substr(btrim(checked_out_by_name), length(split_part(btrim(checked_out_by_name), ' ', 1)) + 1))
    where checked_out_by_name is not null and checked_out_by_first_name is null;
  end if;
end $$;

alter table childcare_visits
  drop column if exists alt_pickup_name,
  drop column if exists checked_out_by_name;

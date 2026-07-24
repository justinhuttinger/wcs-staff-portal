-- Weekly KPI digest aggregation for the Operandio knowledge-article job.
--
-- One function returns everything the digest needs for a Mon–Sun window, so the
-- Node service does no aggregation in JS. All source columns live on the
-- ghl_contacts_report view (staff-entered GHL custom fields, resolved per
-- location). Two view gotchas are handled here, NOT in the caller:
--   * date columns are epoch-millisecond TEXT — cast guarded to a UTC date.
--   * the two rep-name columns use inconsistent whitespace/casing — normalized
--     with regexp_replace so one person is not split across two rows.
-- See reference_ghl_contacts_report_gotchas (project memory) for the full story.
--
-- Thresholds are parameters, not baked in, so the digest config stays in JS.

create or replace function kpi_digest_week(
  p_start        date,
  p_end          date,
  p_min_sales    int default 5,
  p_min_dayones  int default 2
)
returns jsonb
language sql
stable
as $$
  with base as (
    select
      location_name,
      full_name,
      nullif(regexp_replace(trim(sale_team_member), '\s+', ' ', 'g'), '')             as sale_rep,
      nullif(regexp_replace(trim(day_one_booking_team_member), '\s+', ' ', 'g'), '')  as book_rep,
      nullif(regexp_replace(trim(day_one_trainer), '\s+', ' ', 'g'), '')              as trainer,
      day_one_booked,
      day_one_sale,
      nullif(pt_sale_type, '')                                                        as pt_sale_type,
      case when member_sign_date ~ '^[0-9]{10,}$'
        then (to_timestamp(member_sign_date::bigint / 1000) at time zone 'UTC')::date end        as sign_d,
      case when day_one_booking_date ~ '^[0-9]{10,}$'
        then (to_timestamp(day_one_booking_date::bigint / 1000) at time zone 'UTC')::date end as book_d,
      case when day_one_date ~ '^[0-9]{10,}$'
        then (to_timestamp(day_one_date::bigint / 1000) at time zone 'UTC')::date end         as d1_d
    from ghl_contacts_report
  ),
  -- Roster: one row per person per club, sales and Day-One bookings unioned then
  -- summed on a normalized key so the two differently-spaced columns line up.
  evts as (
    select location_name, lower(sale_rep) k, sale_rep nm, 1 as sales, 0 as books
      from base
      where sale_rep is not null and sign_d between p_start and p_end
    union all
    select location_name, lower(book_rep), book_rep, 0, 1
      from base
      where book_rep is not null and day_one_booked = 'Yes' and book_d between p_start and p_end
  ),
  roster as (
    select location_name as club, max(nm) as person,
           sum(sales)::int as sales, sum(books)::int as day_ones
    from evts
    group by location_name, k
    having sum(sales) >= p_min_sales or sum(books) >= p_min_dayones
  ),
  day_one_sales as (
    select location_name as club, trainer, full_name as member,
           coalesce(pt_sale_type, '(package not recorded)') as pkg
    from base
    where d1_d between p_start and p_end and day_one_sale = 'Sale'
  ),
  totals as (
    select
      (select count(*) from base where sign_d between p_start and p_end)::int as sales,
      (select count(*) from base where day_one_booked = 'Yes'
         and book_d between p_start and p_end)::int as booked,
      (select count(*) from base where d1_d between p_start and p_end
         and day_one_sale = 'Sale')::int as d1_sales
  )
  select jsonb_build_object(
    'window',        jsonb_build_object('start', p_start, 'end', p_end),
    'totals',        (select to_jsonb(t) from totals t),
    'day_one_sales', coalesce((select jsonb_agg(to_jsonb(d) order by d.club, d.trainer nulls last, d.member)
                                 from day_one_sales d), '[]'::jsonb),
    'roster',        coalesce((select jsonb_agg(to_jsonb(r) order by r.club, r.sales desc, r.day_ones desc)
                                 from roster r), '[]'::jsonb)
  );
$$;

comment on function kpi_digest_week(date, date, int, int) is
  'Weekly KPI digest source data (Mon–Sun window) for the Operandio knowledge-article job. Returns {window, totals, day_one_sales[], roster[]}. Roster filtered to >= p_min_sales sales OR >= p_min_dayones Day Ones. See migration 091.';

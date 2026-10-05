-- 229_day_one_total_conversion.sql
--
-- Day One conversion, measured two ways.
--
--   First Visit Sale   the trainer marked the Day One 'Sale' on the outcome
--                      form. This is the number every report already showed,
--                      under the old name "Sold" / "Close Rate".
--   Total Sale         a First Visit Sale, OR the member bought PT in ABC
--                      within 30 days of the Day One. Catches the "No Sale,
--                      came back on Thursday and signed" member the form
--                      cannot see.
--
-- Both are counted over Day Ones that SHOWED (status = 'completed'), so the
-- two rates share a denominator and Total can never be below First Visit.
--
-- HOW A DAY ONE IS LINKED TO ABC
-- A Day One carries a GHL contact id, not an ABC member id. The link is made
-- by email first, then by phone where the first names also agree (a shared
-- household phone would otherwise credit a spouse's purchase). Email/phone
-- missing from the Day One row are filled from the GHL contact. Measured on
-- Day Ones that showed 2026-06-01..09-20: 559 of 592 (94%) link; of the 21
-- later buyers, 17 linked by email and 4 by phone, none with a name conflict.
--
-- The link is computed by day_one_link_conversions() and STORED on the row,
-- rather than joined at report time, because the email-or-phone join across
-- abc_members took over two minutes when tried inline in a report query.
-- pg_cron refreshes it hourly for Day Ones in the last 45 days (30-day window
-- plus slack for ABC sync lag).

alter table public.day_one_appointments
  add column if not exists abc_member_id text,
  -- First ABC PT sale for the linked member dated on the Day One or within
  -- the 30 days after it. Null = no such sale (yet).
  add column if not exists abc_pt_sale_date date,
  add column if not exists conversion_checked_at timestamptz;

comment on column public.day_one_appointments.abc_pt_sale_date is
  'First ABC PT sale (abc_pt_services.sale_date) for the linked member within scheduled_date..+30 days. Set by day_one_link_conversions().';

-- ---------------------------------------------------------------------------
-- The one rule, so seven report functions cannot drift apart on it.
-- ---------------------------------------------------------------------------
create or replace function public.day_one_total_sale(p_status text, p_outcome text, p_abc_pt_sale_date date)
returns boolean
language sql
immutable
as $$
  select p_status = 'completed' and (p_outcome = 'Sale' or p_abc_pt_sale_date is not null)
$$;

-- ---------------------------------------------------------------------------
-- Link Day Ones scheduled on/after p_since to ABC and record any PT sale in
-- the 30-day window. Returns the number of rows whose link changed.
-- ---------------------------------------------------------------------------
create or replace function public.day_one_link_conversions(p_since date default (current_date - 45))
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  with d as materialized (
    select a.id, a.scheduled_date,
      nullif(lower(btrim(coalesce(nullif(btrim(a.contact_email), ''), g.email))), '') as em,
      right(regexp_replace(coalesce(nullif(btrim(a.contact_phone), ''), g.phone, ''), '\D', '', 'g'), 10) as ph,
      nullif(lower(btrim(g.first_name)), '') as fn
    from public.day_one_appointments a
    left join public.ghl_contacts_v2 g on g.id = a.ghl_contact_id
    where a.scheduled_date >= p_since
      and a.scheduled_date <= current_date
      and a.status = 'completed'
  ),
  me as materialized (
    select member_id, lower(btrim(email)) as em
    from public.abc_members
    where email is not null and btrim(email) <> ''
  ),
  mp as materialized (
    select member_id, nullif(lower(btrim(first_name)), '') as fn,
           right(regexp_replace(coalesce(mobile_phone, primary_phone, ''), '\D', '', 'g'), 10) as ph
    from public.abc_members
  ),
  cand as (
    select d.id, me.member_id, 1 as pri from d join me on me.em = d.em
    union
    select d.id, mp.member_id, 2 from d
    join mp on mp.ph = d.ph and length(d.ph) = 10
    where d.fn is null or mp.fn is null or d.fn = mp.fn
  ),
  sale as (
    select c.id, c.member_id, c.pri, min(s.sale_date) as sale_date
    from cand c
    join d on d.id = c.id
    left join public.abc_pt_services s
      on s.member_id = c.member_id
     and s.sale_date between d.scheduled_date and d.scheduled_date + 30
    group by 1, 2, 3
  ),
  -- Prefer a member who bought, then the email match, then the earliest sale.
  best as (
    select distinct on (id) id, member_id, sale_date
    from sale
    order by id, (sale_date is null), pri, sale_date, member_id
  ),
  res as (
    select d.id, b.member_id, b.sale_date
    from d left join best b on b.id = d.id
  ),
  upd as (
    update public.day_one_appointments a
       set abc_member_id = res.member_id,
           abc_pt_sale_date = res.sale_date,
           conversion_checked_at = now()
      from res
     where a.id = res.id
       and (a.abc_member_id is distinct from res.member_id
            or a.abc_pt_sale_date is distinct from res.sale_date
            or a.conversion_checked_at is null)
    returning 1
  )
  select count(*) into n from upd;
  return n;
end
$$;

-- ---------------------------------------------------------------------------
-- Report functions: each gains day_ones_total_sold (pt_scorecard gains
-- total_close_count) as its LAST column. Existing columns are unchanged, so
-- callers that do not read the new one keep working. The return type changes,
-- which CREATE OR REPLACE cannot do, hence the drops. Bodies are the live
-- definitions as of 2026-10-05 (including 214's clubs-table rewrite) with
-- only the new column added.
-- ---------------------------------------------------------------------------
drop function if exists public.analytics_daily_series(date, integer, text[]);
drop function if exists public.analytics_pt_monthly(date, integer, text[]);
drop function if exists public.analytics_pt_snapshot(date, date, text[]);
drop function if exists public.analytics_pt_scorecard(date, date, text[], boolean);
drop function if exists public.analytics_trainer_performance(date, date, text[]);
drop function if exists public.analytics_trainer_performance_totals(date, date, text[]);
drop function if exists public.analytics_trainer_monthly(date, integer, text[], text);

CREATE OR REPLACE FUNCTION public.analytics_pt_snapshot(p_start date, p_end date, p_clubs text[] DEFAULT NULL::text[])
 RETURNS TABLE(day_ones bigint, day_ones_completed bigint, day_ones_no_show bigint, day_ones_cancelled bigint, day_ones_scheduled bigint, day_ones_sold bigint, day_ones_no_sale bigint, new_sales bigint, new_clients bigint, resigns bigint, new_rs_count bigint, new_pif_count bigint, new_value numeric, new_rs_value numeric, new_pif_value numeric, new_client_value numeric, resign_value numeric, lost_count bigint, lost_value numeric, day_ones_total_sold bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with slugs as (select public.analytics_club_slugs(p_clubs) as s),
  d as (
    select d.status, d.outcome, d.abc_pt_sale_date
    from public.day_one_appointments d, slugs
    where d.scheduled_date::date between p_start and p_end
      and (slugs.s is null or d.location_slug = any(slugs.s))
  ),
  sales as (select * from public.analytics_pt_sales_labelled(p_start, p_end, p_clubs)),
  loss as (select * from public.analytics_pt_losses(p_start, p_end, p_clubs))
  select
    (select count(*) from d),
    (select count(*) from d where status = 'completed'),
    (select count(*) from d where status = 'no_show'),
    (select count(*) from d where status = 'cancelled'),
    (select count(*) from d where status = 'scheduled'),
    (select count(*) from d where outcome = 'Sale'),
    (select count(*) from d where outcome = 'No Sale'),
    (select count(*) from sales),
    (select count(*) from sales where not is_resign),
    (select count(*) from sales where is_resign),
    (select count(*) from sales where not is_pif),
    (select count(*) from sales where is_pif),
    (select coalesce(sum(value), 0) from sales),
    (select coalesce(sum(value) filter (where not is_pif), 0) from sales),
    (select coalesce(sum(value) filter (where is_pif), 0) from sales),
    (select coalesce(sum(value) filter (where not is_resign), 0) from sales),
    (select coalesce(sum(value) filter (where is_resign), 0) from sales),
    (select count(*) from loss),
    (select coalesce(sum(value), 0) from loss),
    (select count(*) from d where public.day_one_total_sale(status, outcome, abc_pt_sale_date))
$function$;

CREATE OR REPLACE FUNCTION public.analytics_pt_monthly(p_end date, p_months integer DEFAULT 13, p_clubs text[] DEFAULT NULL::text[])
 RETURNS TABLE(month_start date, day_ones bigint, day_ones_completed bigint, day_ones_sold bigint, new_sales bigint, new_clients bigint, new_value numeric, new_rs_value numeric, new_pif_value numeric, lost_count bigint, lost_value numeric, day_ones_total_sold bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with months as (
    select generate_series(
      date_trunc('month', p_end)::date - ((p_months - 1) || ' months')::interval,
      date_trunc('month', p_end)::date,
      '1 month'
    )::date as m
  ),
  bounds as (
    select m as start_d,
           least((m + interval '1 month' - interval '1 day')::date, p_end) as end_d
    from months
  )
  select
    b.start_d,
    coalesce(t.day_ones, 0),
    coalesce(t.day_ones_completed, 0),
    coalesce(t.day_ones_sold, 0),
    coalesce(t.new_sales, 0),
    coalesce(t.new_clients, 0),
    coalesce(t.new_value, 0),
    coalesce(t.new_rs_value, 0),
    coalesce(t.new_pif_value, 0),
    coalesce(t.lost_count, 0),
    coalesce(t.lost_value, 0),
    coalesce(t.day_ones_total_sold, 0)
  from bounds b
  left join lateral public.analytics_pt_snapshot(b.start_d, b.end_d, p_clubs) t on true
  order by b.start_d
$function$;

CREATE OR REPLACE FUNCTION public.analytics_daily_series(p_end date, p_days integer DEFAULT 14, p_clubs text[] DEFAULT NULL::text[])
 RETURNS TABLE(day date, new_members bigint, lost_members bigint, net_members bigint, new_dues numeric, revenue numeric, pt_revenue numeric, day_ones bigint, day_ones_completed bigint, day_ones_sold bigint, pt_new_sales bigint, pt_new_clients bigint, pt_new_value numeric, pt_lost_count bigint, pt_lost_value numeric, day_ones_total_sold bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select
    d.day::date,
    w.new_members, w.lost_members, (w.new_members - w.lost_members),
    w.new_dues, w.revenue, w.pt_revenue,
    p.day_ones, p.day_ones_completed, p.day_ones_sold,
    p.new_sales, p.new_clients, p.new_value, p.lost_count, p.lost_value,
    p.day_ones_total_sold
  from generate_series(
    (p_end - (greatest(p_days, 1) - 1))::date, p_end::date, interval '1 day'
  ) d(day)
  cross join lateral public.analytics_topline_window(d.day::date, d.day::date, p_clubs, true) w
  cross join lateral public.analytics_pt_snapshot(d.day::date, d.day::date, p_clubs) p
  order by 1
$function$;

CREATE OR REPLACE FUNCTION public.analytics_pt_scorecard(p_start date, p_end date, p_clubs text[] DEFAULT NULL::text[], p_exclude boolean DEFAULT true)
 RETURNS TABLE(club_number text, new_members bigint, pt_on_join bigint, pif_on_join bigint, book_count bigint, book_on_join bigint, set_to_date bigint, set_incl_future bigint, show_count bigint, close_count bigint, pt_revenue numeric, new_eft_draft numeric, cancelled_eft_draft numeric, new_pif_revenue numeric, total_close_count bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  clubmap(club_number, slug) as (select c.club_number, c.slug from public.clubs c),
  clubs as (
    select c.club_number, c.slug from clubmap c
    where p_clubs is null or c.club_number = any(p_clubs)
  ),
  newmem as (
    select m.club_number, m.member_id, m.since_date,
           lower(trim(m.email)) as email,
           right(regexp_replace(coalesce(m.mobile_phone, m.primary_phone, ''), '\D', '', 'g'), 10) as phone,
           lower(regexp_replace(trim(m.first_name || ' ' || m.last_name), '\s+', ' ', 'g')) as name_key
    from public.abc_members m
    where m.since_date between p_start and p_end
      and (p_clubs is null or m.club_number = any(p_clubs))
      and (not p_exclude or lower(coalesce(m.membership_type, '')) not in (select t from skip))
  ),
  join_pt as (
    select n.club_number,
           count(distinct n.member_id) filter (where s.recurring_service_id is not null) as pt_on_join,
           count(distinct n.member_id) filter (where s.recurring_type_desc ilike '%paid in full%') as pif_on_join
    from newmem n
    left join public.abc_pt_services s
      on s.member_id = n.member_id
     and s.sale_date = n.since_date
    group by 1
  ),
  d1 as (
    select d.*, c.club_number
    from public.day_one_appointments d
    join clubs c on c.slug = d.location_slug
  ),
  booked as (
    select club_number, count(*) as book_count
    from d1
    where booked_at >= p_start and booked_at < (p_end + 1)
    group by 1
  ),
  booked_join as (
    select d.club_number, count(distinct n.member_id) as book_on_join
    from d1 d
    join public.ghl_contacts_v2 g on g.id = d.ghl_contact_id
    join newmem n
      on n.club_number = d.club_number
     and (
       (n.email <> '' and n.email = lower(trim(g.email)))
       or (length(n.phone) = 10 and n.phone = right(regexp_replace(coalesce(g.phone, ''), '\D', '', 'g'), 10))
       or (n.name_key = lower(regexp_replace(trim(coalesce(g.first_name, '') || ' ' || coalesce(g.last_name, '')), '\s+', ' ', 'g')))
     )
    where d.booked_at::date = n.since_date
    group by 1
  ),
  -- A "set" is an appointment scheduled to happen from the window start
  -- onwards. To-date stops at today so Show % is not diluted by appointments
  -- that have not happened yet; incl-future adds the ones still ahead, and is
  -- therefore always the larger of the two. (An earlier cut counted to-date by
  -- appointment date and incl-future by booking date, which are different
  -- populations — Keizer came back with 29 to-date against 27 including the
  -- future, which cannot happen.)
  sets as (
    select club_number,
      count(*) filter (where scheduled_date between p_start and least(p_end, current_date)) as set_to_date,
      count(*) filter (where scheduled_date >= p_start) as set_incl_future,
      count(*) filter (where scheduled_date between p_start and least(p_end, current_date)
                         and status = 'completed') as show_count,
      count(*) filter (where scheduled_date between p_start and least(p_end, current_date)
                         and status = 'completed' and outcome = 'Sale') as close_count,
      count(*) filter (where scheduled_date between p_start and least(p_end, current_date)
                         and public.day_one_total_sale(status, outcome, abc_pt_sale_date)) as total_close_count
    from d1
    group by 1
  ),
  rev as (
    select ltrim(r.club_number, '0') as club_key, sum(r.payment_amount) as pt_revenue
    from public.abc_revenue_transactions r
    where r.profit_center = 'TRAINING'
      and upper(coalesce(r.catalog_item, '')) not in ('PT CONSULT', 'INBODY SCAN')
      and r.payment_date between p_start and p_end
    group by 1
  ),
  svc as (
    select club_number,
      sum(invoice_total) filter (where not (recurring_type_desc ilike '%paid in full%')
                                   and sale_date between p_start and p_end) as new_eft_draft,
      sum(invoice_total) filter (where not (recurring_type_desc ilike '%paid in full%')
                                   and inactive_date between p_start and p_end) as cancelled_eft_draft,
      sum(invoice_total) filter (where recurring_type_desc ilike '%paid in full%'
                                   and sale_date between p_start and p_end) as new_pif_revenue
    from public.abc_pt_services
    group by 1
  )
  select
    clubs.club_number,
    coalesce(nm.new_members, 0),
    coalesce(jp.pt_on_join, 0),
    coalesce(jp.pif_on_join, 0),
    coalesce(b.book_count, 0),
    coalesce(bj.book_on_join, 0),
    coalesce(s.set_to_date, 0),
    coalesce(s.set_incl_future, 0),
    coalesce(s.show_count, 0),
    coalesce(s.close_count, 0),
    coalesce(rv.pt_revenue, 0),
    coalesce(sv.new_eft_draft, 0),
    coalesce(sv.cancelled_eft_draft, 0),
    coalesce(sv.new_pif_revenue, 0),
    coalesce(s.total_close_count, 0)
  from clubs
  left join (select club_number, count(*) as new_members from newmem group by 1) nm using (club_number)
  left join join_pt jp using (club_number)
  left join booked b using (club_number)
  left join booked_join bj using (club_number)
  left join sets s using (club_number)
  left join svc sv using (club_number)
  left join rev rv on rv.club_key = ltrim(clubs.club_number, '0')
  order by 1;
$function$;

CREATE OR REPLACE FUNCTION public.analytics_trainer_performance(p_start date, p_end date, p_clubs text[] DEFAULT NULL::text[])
 RETURNS TABLE(trainer text, club_number text, last_session date, unique_members bigint, completed_sessions bigint, cancelled_sessions bigint, consult_sessions bigint, admin_sessions bigint, session_minutes bigint, pt_minutes bigint, class_minutes bigint, admin_minutes bigint, member_months numeric, day_ones_booked bigint, day_ones_completed bigint, day_ones_sold bigint, close_amount numeric, close_amount_estimated boolean, day_ones_total_sold bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with clubmap(club_number, slug) as (select c.club_number, c.slug from public.clubs c),
  ev as (
    select
      lower(regexp_replace(trim(e.employee_first_name || ' ' || e.employee_last_name), '\s+', ' ', 'g')) as k,
      trim(regexp_replace(e.employee_first_name || ' ' || e.employee_last_name, '\s+', ' ', 'g')) as raw,
      e.club_number, e.member_id, e.event_timestamp_local::date as d,
      e.status, e.category, coalesce(e.duration_minutes, 0) as mins,
      public.abc_calendar_event_kind(e.event_name, e.category) as kind
    from public.abc_calendar_events e
    where e.employee_first_name is not null
      and e.event_timestamp_local::date between p_start and p_end
      and (p_clubs is null or e.club_number = any(p_clubs))
  ),
  d1 as (
    select
      lower(regexp_replace(trim(a.trainer_name), '\s+', ' ', 'g')) as k,
      trim(regexp_replace(a.trainer_name, '\s+', ' ', 'g')) as raw,
      c.club_number, a.status, a.outcome, a.abc_pt_sale_date
    from public.day_one_appointments a
    join clubmap c on c.slug = a.location_slug
    where a.trainer_name is not null and trim(a.trainer_name) <> ''
      and a.booked_at::date between p_start and p_end
      and (p_clubs is null or c.club_number = any(p_clubs))
  ),
  svc as (
    select
      coalesce(
        lower(regexp_replace(trim(p.employee_name), '\s+', ' ', 'g')),
        lower(regexp_replace(trim(s.trainer_name), '\s+', ' ', 'g'))
      ) as k,
      coalesce(
        trim(regexp_replace(p.employee_name, '\s+', ' ', 'g')),
        trim(regexp_replace(s.trainer_name, '\s+', ' ', 'g'))
      ) as raw,
      s.club_number, s.member_id, s.sale_date as d,
      coalesce(s.invoice_total, 0) as amount,
      (p.employee_name is null) as estimated
    from public.abc_pt_services s
    left join public.payroll_recurring_commissions p
      on p.recurring_service_id = s.recurring_service_id
    where s.sale_date between p_start and p_end
      and trim(coalesce(p.employee_name, s.trainer_name, '')) <> ''
      and (p_clubs is null or s.club_number = any(p_clubs))
  ),
  svc_service as (
    select
      lower(regexp_replace(trim(s.trainer_name), '\s+', ' ', 'g')) as k,
      s.member_id, s.sale_date as d
    from public.abc_pt_services s
    where s.trainer_name is not null and trim(s.trainer_name) <> '' and s.member_id is not null
  ),
  people as (
    select k, max(raw) as raw from (
      select k, raw from ev union all select k, raw from d1 union all select k, raw from svc
    ) z group by k
  ),
  home as (
    select distinct on (k) k, club_number
    from (
      select k, club_number, count(*) * 10 as w from ev group by 1,2
      union all select k, club_number, count(*) as w from d1 group by 1,2
      union all select k, club_number, count(*) as w from svc group by 1,2
    ) z
    group by k, club_number
    order by k, sum(w) desc
  ),
  sess as (
    select
      k,
      max(d) filter (where status = 'Completed' and kind = 'session') as last_session,
      count(distinct member_id) filter (where status = 'Completed' and kind = 'session' and member_id is not null) as unique_members,
      count(*) filter (where status = 'Completed' and kind = 'session') as completed_sessions,
      count(*) filter (where status like 'Canceled%' and kind = 'session') as cancelled_sessions,
      count(*) filter (where status = 'Completed' and kind = 'consult') as consult_sessions,
      count(*) filter (where status = 'Completed' and kind = 'admin') as admin_sessions,
      coalesce(sum(mins) filter (where status = 'Completed' and kind = 'session'), 0) as session_minutes,
      coalesce(sum(mins) filter (where status = 'Completed' and kind = 'session' and category = 'Appointment'), 0) as pt_minutes,
      coalesce(sum(mins) filter (where status = 'Completed' and kind = 'class'), 0) as class_minutes,
      coalesce(sum(mins) filter (where status = 'Completed' and kind = 'admin'), 0) as admin_minutes
    from ev group by k
  ),
  contact as (
    select k, member_id, min(d) as first_d, max(d) as last_d
    from (
      select
        lower(regexp_replace(trim(e.employee_first_name || ' ' || e.employee_last_name), '\s+', ' ', 'g')) as k,
        e.member_id, e.event_timestamp_local::date as d
      from public.abc_calendar_events e
      where e.employee_first_name is not null and e.member_id is not null
      union all
      select k, member_id, d from svc_service
    ) z
    group by 1, 2
  ),
  trained as (
    select distinct k, member_id from ev
    where status = 'Completed' and kind = 'session' and member_id is not null
  ),
  months as (
    select t.k,
           round(avg(greatest(least(c.last_d, p_end) - c.first_d, 0) / 30.44)::numeric, 1) as member_months
    from trained t
    join contact c on c.k = t.k and c.member_id = t.member_id
    group by t.k
  ),
  intros as (
    select k,
      count(*) as booked,
      count(*) filter (where status = 'completed') as completed,
      count(*) filter (where status = 'completed' and outcome = 'Sale') as sold,
      count(*) filter (where public.day_one_total_sale(status, outcome, abc_pt_sale_date)) as total_sold
    from d1 group by k
  ),
  sales as (
    select k, coalesce(sum(amount), 0) as close_amount, bool_or(estimated) as estimated
    from svc group by k
  )
  select
    p.raw, home.club_number, sess.last_session,
    coalesce(sess.unique_members, 0), coalesce(sess.completed_sessions, 0),
    coalesce(sess.cancelled_sessions, 0),
    coalesce(sess.consult_sessions, 0), coalesce(sess.admin_sessions, 0),
    coalesce(sess.session_minutes, 0),
    coalesce(sess.pt_minutes, 0), coalesce(sess.class_minutes, 0),
    coalesce(sess.admin_minutes, 0),
    months.member_months,
    coalesce(intros.booked, 0), coalesce(intros.completed, 0), coalesce(intros.sold, 0),
    coalesce(sales.close_amount, 0),
    coalesce(sales.estimated, false),
    coalesce(intros.total_sold, 0)
  from people p
  left join home   on home.k = p.k
  left join sess   on sess.k = p.k
  left join months on months.k = p.k
  left join intros on intros.k = p.k
  left join sales  on sales.k = p.k
  order by coalesce(sess.completed_sessions, 0) desc, p.raw;
$function$;

CREATE OR REPLACE FUNCTION public.analytics_trainer_performance_totals(p_start date, p_end date, p_clubs text[] DEFAULT NULL::text[])
 RETURNS TABLE(unique_members bigint, trainers bigint, completed_sessions bigint, cancelled_sessions bigint, consult_sessions bigint, admin_sessions bigint, session_minutes bigint, pt_minutes bigint, class_minutes bigint, admin_minutes bigint, day_ones_booked bigint, day_ones_completed bigint, day_ones_sold bigint, close_amount numeric, day_ones_total_sold bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with clubmap(club_number, slug) as (select c.club_number, c.slug from public.clubs c),
  ev as (
    select e.member_id, e.status, e.category, coalesce(e.duration_minutes, 0) as mins,
           public.abc_calendar_event_kind(e.event_name, e.category) as kind,
           lower(regexp_replace(trim(e.employee_first_name || ' ' || e.employee_last_name), '\s+', ' ', 'g')) as k
    from public.abc_calendar_events e
    where e.employee_first_name is not null
      and e.event_timestamp_local::date between p_start and p_end
      and (p_clubs is null or e.club_number = any(p_clubs))
  ),
  d1 as (
    select a.status, a.outcome, a.abc_pt_sale_date
    from public.day_one_appointments a
    join clubmap c on c.slug = a.location_slug
    where a.trainer_name is not null and trim(a.trainer_name) <> ''
      and a.booked_at::date between p_start and p_end
      and (p_clubs is null or c.club_number = any(p_clubs))
  ),
  svc as (
    select coalesce(s.invoice_total, 0) as amount
    from public.abc_pt_services s
    where s.trainer_name is not null and trim(s.trainer_name) <> ''
      and s.sale_date between p_start and p_end
      and (p_clubs is null or s.club_number = any(p_clubs))
  )
  select
    (select count(distinct member_id) from ev where status = 'Completed' and kind = 'session' and member_id is not null),
    (select count(distinct k) from ev where status = 'Completed'),
    (select count(*) from ev where status = 'Completed' and kind = 'session'),
    (select count(*) from ev where status like 'Canceled%' and kind = 'session'),
    (select count(*) from ev where status = 'Completed' and kind = 'consult'),
    (select count(*) from ev where status = 'Completed' and kind = 'admin'),
    (select coalesce(sum(mins), 0) from ev where status = 'Completed' and kind = 'session'),
    (select coalesce(sum(mins), 0) from ev where status = 'Completed' and kind = 'session' and category = 'Appointment'),
    (select coalesce(sum(mins), 0) from ev where status = 'Completed' and kind = 'class'),
    (select coalesce(sum(mins), 0) from ev where status = 'Completed' and kind = 'admin'),
    (select count(*) from d1),
    (select count(*) from d1 where status = 'completed'),
    (select count(*) from d1 where status = 'completed' and outcome = 'Sale'),
    (select coalesce(sum(amount), 0) from svc),
    (select count(*) from d1 where public.day_one_total_sale(status, outcome, abc_pt_sale_date))
$function$;

CREATE OR REPLACE FUNCTION public.analytics_trainer_monthly(p_end date, p_months integer DEFAULT 13, p_clubs text[] DEFAULT NULL::text[], p_person text DEFAULT NULL::text)
 RETURNS TABLE(month_start date, completed_sessions bigint, cancelled_sessions bigint, unique_clients bigint, pt_minutes bigint, day_ones bigint, day_ones_completed bigint, day_ones_sold bigint, day_ones_cancelled bigint, day_ones_no_show bigint, close_amount numeric, day_ones_total_sold bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with clubmap(club_number, slug) as (select c.club_number, c.slug from public.clubs c),
  months as (
    select mo::date
    from generate_series(
      date_trunc('month', p_end)::date - ((greatest(p_months, 1) - 1) || ' months')::interval,
      date_trunc('month', p_end)::date,
      '1 month'
    ) as g(mo)
  ),
  key as (select lower(regexp_replace(trim(coalesce(p_person, '')), '\s+', ' ', 'g')) as k),
  ev as (
    select date_trunc('month', e.event_timestamp_local)::date as mo,
           count(*) filter (where e.status = 'Completed') as completed,
           count(*) filter (where e.status like 'Canceled%') as cancelled,
           count(distinct e.member_id) filter (where e.status = 'Completed' and e.member_id is not null) as clients,
           coalesce(sum(e.duration_minutes) filter (where e.status = 'Completed' and e.category = 'Appointment'), 0) as pt_minutes
    from public.abc_calendar_events e, key
    where e.employee_first_name is not null
      and (p_clubs is null or e.club_number = any(p_clubs))
      and (key.k = '' or lower(regexp_replace(trim(e.employee_first_name || ' ' || e.employee_last_name), '\s+', ' ', 'g')) = key.k)
    group by 1
  ),
  d1 as (
    select date_trunc('month', a.booked_at)::date as mo,
           count(*) as given,
           count(*) filter (where a.status = 'completed') as completed,
           count(*) filter (where a.status = 'completed' and a.outcome = 'Sale') as sold,
           count(*) filter (where a.status = 'cancelled') as cancelled,
           count(*) filter (where a.status = 'no_show') as no_show,
           count(*) filter (where public.day_one_total_sale(a.status, a.outcome, a.abc_pt_sale_date)) as total_sold
    from public.day_one_appointments a
    join clubmap c on c.slug = a.location_slug, key
    where (p_clubs is null or c.club_number = any(p_clubs))
      and (key.k = '' or lower(regexp_replace(trim(coalesce(a.trainer_name, '')), '\s+', ' ', 'g')) = key.k)
    group by 1
  ),
  svc as (
    select date_trunc('month', s.sale_date)::date as mo,
           coalesce(sum(s.invoice_total), 0) as amount
    from public.abc_pt_services s
    left join public.payroll_recurring_commissions p
      on p.recurring_service_id = s.recurring_service_id, key
    where s.sale_date is not null
      and (p_clubs is null or s.club_number = any(p_clubs))
      and (key.k = '' or lower(regexp_replace(trim(coalesce(p.employee_name, s.trainer_name, '')), '\s+', ' ', 'g')) = key.k)
    group by 1
  )
  select months.mo,
         coalesce(ev.completed, 0), coalesce(ev.cancelled, 0),
         coalesce(ev.clients, 0), coalesce(ev.pt_minutes, 0),
         coalesce(d1.given, 0), coalesce(d1.completed, 0), coalesce(d1.sold, 0),
         coalesce(d1.cancelled, 0), coalesce(d1.no_show, 0),
         coalesce(svc.amount, 0),
         coalesce(d1.total_sold, 0)
  from months
  left join ev  on ev.mo = months.mo
  left join d1  on d1.mo = months.mo
  left join svc on svc.mo = months.mo
  order by 1;
$function$;

-- ---------------------------------------------------------------------------
-- Backfill every Day One once, then keep the recent ones fresh hourly.
-- ---------------------------------------------------------------------------
select public.day_one_link_conversions('2000-01-01');

select cron.schedule(
  'link-day-one-conversions',
  '35 * * * *',
  $$select public.day_one_link_conversions()$$
);

notify pgrst, 'reload schema';

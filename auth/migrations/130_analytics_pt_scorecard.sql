-- Per-club PT scorecard for a date window, behind Analytics > PT Scorecard.
--
-- DEFINITIONS
--   Book   Day Ones booked during the window
--   Set    appointments scheduled from the window start. To-date stops at today
--          so Show % is not diluted by appointments that have not happened yet;
--          incl-future adds the ones still ahead and is always the larger of
--          the two. An earlier cut counted to-date by appointment date and
--          incl-future by booking date - different populations - and Keizer came
--          back with 29 to-date against 27 including the future.
--   Show   a set appointment marked completed
--   Close  a completed appointment whose outcome was a Sale
--
-- New members are counted on since_date, the original join date, for the same
-- reason as the other Analytics reports: sign_date moves when a member
-- re-signs. Book-on-join bridges the Day One to a member through the GHL
-- contact, because day_one_appointments.contact_phone is populated on 3 of
-- 1,696 rows.
--
-- PT revenue is net of refunds and excludes PT CONSULT (the free consultation,
-- ~1,900 members a year at /usr/bin/bash) and INBODY SCAN, neither of which is training.
-- EFT draft uses ABC invoiceTotal on a recurring service, which is the MONTHLY
-- draft - confirmed by deactivatedPT.js and by exact agreement with the source
-- dashboard at two clubs.
--
-- Goals are NOT stored here: they are three percentages the reader adjusts, and
-- the API applies them to these counts.

create or replace function public.analytics_pt_scorecard(
  p_start   date,
  p_end     date,
  p_clubs   text[]  default null,
  p_exclude boolean default true
)
returns table (
  club_number            text,
  new_members            bigint,
  pt_on_join             bigint,
  pif_on_join            bigint,
  book_count             bigint,
  book_on_join           bigint,
  set_to_date            bigint,
  set_incl_future        bigint,
  show_count             bigint,
  close_count            bigint,
  pt_revenue             numeric,
  new_eft_draft          numeric,
  cancelled_eft_draft    numeric,
  new_pif_revenue        numeric
)
language sql
stable
as $$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  clubmap(club_number, slug) as (values
    ('30935','salem'),('31599','keizer'),('7655','eugene'),('31598','springfield'),
    ('31600','clackamas'),('31601','milwaukie'),('32073','medford')
  ),
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
  sets as (
    select club_number,
      count(*) filter (where scheduled_date between p_start and least(p_end, current_date)) as set_to_date,
      count(*) filter (where scheduled_date >= p_start) as set_incl_future,
      count(*) filter (where scheduled_date between p_start and least(p_end, current_date)
                         and status = 'completed') as show_count,
      count(*) filter (where scheduled_date between p_start and least(p_end, current_date)
                         and status = 'completed' and outcome = 'Sale') as close_count
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
    coalesce(sv.new_pif_revenue, 0)
  from clubs
  left join (select club_number, count(*) as new_members from newmem group by 1) nm using (club_number)
  left join join_pt jp using (club_number)
  left join booked b using (club_number)
  left join booked_join bj using (club_number)
  left join sets s using (club_number)
  left join svc sv using (club_number)
  left join rev rv on rv.club_key = ltrim(clubs.club_number, '0')
  order by 1;
$$;

comment on function public.analytics_pt_scorecard is
  'Per-club PT scorecard for a date window. Book = Day Ones booked; Set = appointments scheduled from the window start (to-date stops at today, incl-future is its superset); Show = completed; Close = completed with a Sale outcome.';

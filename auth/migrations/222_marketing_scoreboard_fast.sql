-- 222: marketing_scoreboard_daily, fast enough for the API.
--
-- 221's version took 11.5s for a month (the API role's statement_timeout is
-- 8s), so the Scoreboard 500'd. The cost was the "Meta lead in the 90 days
-- before" check: a correlated EXISTS against the 11.7k-row meta_people CTE,
-- rescanned once per cart and per join, plus three count subqueries per
-- day. Now meta_people is hash-joined once and the counts are one grouped
-- aggregate. Same rules, same results (Sept 2026: meta 194/7/23, organic
-- 155/191/102), ~0.4s.

create or replace function public.marketing_scoreboard_daily(
  p_start date, p_end date, p_clubs text[] default null
)
returns table (day date, channel text, leads integer, carts integer, joins integer)
language sql
stable
set search_path = public
as $$
  with cl as (
    select club_number, ghl_location_id from clubs
    where active and (p_clubs is null or club_number = any(p_clubs))
  ),
  bounds as (
    select (p_start::timestamp at time zone 'America/Los_Angeles') ts0,
           ((p_end + 1)::timestamp at time zone 'America/Los_Angeles') ts1
  ),
  -- Everyone who was ever a paid Meta lead, and when they first were.
  meta_people as (
    select lower(c.email) em, min(c.created_at_ghl) first_at
    from ghl_contacts_v2 c
    where c.email is not null and marketing_is_meta_paid(c.attribution_source, c.source)
    group by 1
  ),
  lead_rows as (
    select (c.created_at_ghl at time zone 'America/Los_Angeles')::date d,
      case when marketing_is_meta_paid(c.attribution_source, c.source) then 'meta'
           when c.source ilike 'external_form%' or c.source = 'Website' then 'organic' end ch
    from ghl_contacts_v2 c join cl on cl.ghl_location_id = c.location_id, bounds b
    where c.created_at_ghl >= b.ts0 and c.created_at_ghl < b.ts1
  ),
  -- One Online Join start per email per day.
  carts0 as (
    select distinct on (lower(o.email), (o.started_at at time zone 'America/Los_Angeles')::date)
      lower(o.email) em, o.started_at,
      (o.started_at at time zone 'America/Los_Angeles')::date d,
      marketing_signup_is_meta_paid(o.utm_medium, o.utm_content, o.fbclid, o.fbc, o.started_at) paid
    from online_signups o join cl on cl.club_number = o.abc_club_number, bounds b
    where o.started_at >= b.ts0 and o.started_at < b.ts1
    order by lower(o.email), (o.started_at at time zone 'America/Los_Angeles')::date, o.started_at
  ),
  cart_rows as (
    select c.d,
      case when c.paid or mp.first_at between c.started_at - interval '90 days' and c.started_at
           then 'meta' else 'organic' end ch
    from carts0 c left join meta_people mp on mp.em = c.em
  ),
  new_joins as (
    select m.member_id, m.club_number, lower(m.email) em, m.since_date d, m.agreement_entry_source src,
      (m.since_date::timestamp at time zone 'America/Los_Angeles') day0
    from abc_members m join cl on cl.club_number = m.club_number
    where m.since_date between p_start and p_end
      and m.is_primary_member is not false
      and not coalesce(m.is_non_member, false)
      and coalesce(m.membership_type, '') !~* '^z\.'
      and lower(coalesce(m.membership_type, '')) not in ('non-member', 'employee', 'employee fao', 'staff', 'childcare')
      and lower(coalesce(m.membership_type, '')) not in (select lower(membership_type) from abc_membership_skip_list)
  ),
  join_contact as (
    select distinct on (j.member_id) j.member_id, c.attribution_source a, c.source src
    from new_joins j
    join cl on cl.club_number = j.club_number
    join ghl_contacts_v2 c on c.location_id = cl.ghl_location_id and lower(c.email) = j.em
    order by j.member_id, c.created_at_ghl
  ),
  join_signup as (
    select distinct on (j.member_id) j.member_id,
      marketing_signup_is_meta_paid(o.utm_medium, o.utm_content, o.fbclid, o.fbc, o.started_at) paid
    from new_joins j join online_signups o on lower(o.email) = j.em
    where o.started_at < j.day0 + interval '1 day'
    order by j.member_id, o.started_at desc
  ),
  join_rows as (
    select j.d,
      case when marketing_is_meta_paid(jc.a, jc.src)
             or coalesce(js.paid, false)
             or mp.first_at between j.day0 - interval '90 days' and j.day0 + interval '1 day'
           then 'meta'
           when j.src = 'Web' or jc.src ilike 'external_form%' or jc.src = 'Website' or jc.src ilike 'online join%'
           then 'organic' end ch
    from new_joins j
    left join join_contact jc using (member_id)
    left join join_signup js using (member_id)
    left join meta_people mp on mp.em = j.em
  ),
  agg as (
    select d, ch, count(*) n, 'l' k from lead_rows where ch is not null group by d, ch
    union all
    select d, ch, count(*), 'c' from cart_rows group by d, ch
    union all
    select d, ch, count(*), 'j' from join_rows where ch is not null group by d, ch
  ),
  days as (
    select g::date d, x.ch
    from generate_series(p_start, p_end, interval '1 day') g
    cross join (values ('meta'), ('organic')) x(ch)
  )
  select days.d, days.ch,
    coalesce(sum(a.n) filter (where a.k = 'l'), 0)::int,
    coalesce(sum(a.n) filter (where a.k = 'c'), 0)::int,
    coalesce(sum(a.n) filter (where a.k = 'j'), 0)::int
  from days left join agg a on a.d = days.d and a.ch = days.ch
  group by days.d, days.ch
  order by days.d, days.ch
$$;

revoke all on function public.marketing_scoreboard_daily(date, date, text[]) from public, anon, authenticated;

notify pgrst, 'reload schema';

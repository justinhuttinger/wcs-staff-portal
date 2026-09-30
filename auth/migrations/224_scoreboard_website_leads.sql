-- 224: Marketing Scoreboard counts every website lead, not just the ones
-- GHL's tracker tagged.
--
-- Website forms reach GHL through each club's inbound-webhook workflow, which
-- creates the contact with NO source ("CRM Workflows"). 221/222 only counted
-- source external_form / Website, which GHL's own website tracker sets and
-- which only started on 2026-09-23. So most website leads were missed:
-- Eugene Sept showed 31 organic, the real figure is 57 (all clubs 155 -> 262).
--
-- Every website form sends the visitor id (the theme's wcs_xid) into the GHL
-- field contact.external_id, so that is the signal. In-club forms (kiosk
-- waiver, front desk, gym tour, Day One) also run on the website's domain and
-- carry it, and Online Join is a cart, so those sources are excluded.
--
-- Meta counts are unchanged (paid is decided by first-touch attribution).
-- East Side (milwaukie) has its own website with no visitor id, so its
-- organic count is unchanged.

create or replace function public.marketing_is_website_lead(p_source text, p_has_xid boolean)
returns boolean
language sql
immutable
as $$
  select coalesce(
       coalesce(p_source, '') ilike 'external_form%'
    or p_source = 'Website'
    or (p_has_xid
        and coalesce(p_source, '') !~* '^(kiosk|front desk|day ?(one|1)|online join|payment_link)'
        and coalesce(p_source, '') !~* 'gym tour'), false)
$$;

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
  -- Each location's id for the contact.external_id (website visitor id) field.
  xid_field as (
    select location_id, id fid from ghl_custom_field_defs where field_key = 'contact.external_id'
  ),
  meta_people as (
    select lower(c.email) em, min(c.created_at_ghl) first_at
    from ghl_contacts_v2 c
    where c.email is not null and marketing_is_meta_paid(c.attribution_source, c.source)
    group by 1
  ),
  lead_rows as (
    select (c.created_at_ghl at time zone 'America/Los_Angeles')::date d,
      case when marketing_is_meta_paid(c.attribution_source, c.source) then 'meta'
           when marketing_is_website_lead(c.source, coalesce(c.custom_fields->>xf.fid, '') <> '') then 'organic' end ch
    from ghl_contacts_v2 c
    join cl on cl.ghl_location_id = c.location_id
    left join xid_field xf on xf.location_id = c.location_id, bounds b
    where c.created_at_ghl >= b.ts0 and c.created_at_ghl < b.ts1
  ),
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
    select distinct on (j.member_id) j.member_id, c.attribution_source a, c.source src,
      coalesce(c.custom_fields->>xf.fid, '') <> '' has_xid
    from new_joins j
    join cl on cl.club_number = j.club_number
    join ghl_contacts_v2 c on c.location_id = cl.ghl_location_id and lower(c.email) = j.em
    left join xid_field xf on xf.location_id = c.location_id
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
           when j.src = 'Web' or jc.src ilike 'online join%'
             or marketing_is_website_lead(jc.src, coalesce(jc.has_xid, false))
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

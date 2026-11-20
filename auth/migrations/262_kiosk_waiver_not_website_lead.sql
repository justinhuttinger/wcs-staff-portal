-- 262: Check-in kiosk waivers are walk-ins, not website leads.
--
-- The kiosk (kiosk.westcoaststrength.com/<club>) creates the GHL contact
-- through an inbound form, so GHL stamps it source 'external_form' with NO
-- first-touch attribution; the only trace of the kiosk is the LAST-touch url.
-- 'external_form' is exactly what marketing_is_website_lead() treats as a
-- website lead, so every person who walked in and signed a waiver was being
-- counted as an organic website lead on the Marketing Scoreboard.
--
-- October 2026, organic leads by club, before -> after:
--   clackamas 173 -> 74, eugene 214 -> 134, keizer 87 -> 46, medford 95 -> 57,
--   salem 122 -> 78, springfield 260 -> 126, milwaukie 13 -> 13 (no kiosk).
--   All clubs 964 -> 528.
--
-- The same contacts fell into 'Other' on Lead Sources (their source is not
-- one the bucket recognises). They now bucket as Walk-in / Manual.
--
-- A contact whose FIRST touch was a website form and who later signed a
-- waiver is still a website lead: the rule needs first-touch attribution to
-- be empty, not just a kiosk last touch. Lead totals do not change anywhere;
-- only which channel / source they are filed under.

create or replace function public.marketing_is_kiosk_contact(p_attr jsonb, p_last jsonb)
returns boolean
language sql
immutable
as $$
  select p_attr is null
     and coalesce(p_last->>'url', '') ilike '%kiosk.westcoaststrength.com%'
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
           when marketing_is_website_lead(c.source, coalesce(c.custom_fields->>xf.fid, '') <> '')
                and not marketing_is_kiosk_contact(c.attribution_source, c.last_attribution_source)
             then 'organic' end ch
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
      coalesce(c.custom_fields->>xf.fid, '') <> '' has_xid,
      marketing_is_kiosk_contact(c.attribution_source, c.last_attribution_source) kiosk
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
             or (marketing_is_website_lead(jc.src, coalesce(jc.has_xid, false))
                 and not coalesce(jc.kiosk, false))
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

-- Lead Sources: a kiosk-created contact is handed to the bucket as a
-- 'Kiosk Waiver' source, which it already files under Walk-in / Manual.
create or replace function public.analytics_lead_sources(
  p_start date, p_end date, p_clubs text[] default null, p_attribution text default 'real'
)
returns table (source text, leads bigint, tours bigint, trials bigint, won bigint, lost bigint)
language sql
stable
as $$
  with opp as (
    select o.id, o.contact_id, o.status, s.position, l.slug
    from public.ghl_opportunities_v2 o
    join public.ghl_locations l on l.id = o.location_id
    join public.ghl_pipelines p on p.id = o.pipeline_id
    join public.ghl_pipeline_stages s on s.id = o.stage_id
    where p.name in ('Membership Pipeline', 'Standard Member Pipeline')
      and o.created_at_ghl >= p_start and o.created_at_ghl < (p_end + 1)
      and (p_clubs is null or l.slug = any(p_clubs))
  ),
  joined as (
    select opp.*,
      case when p_attribution = 'claimed'
        then public.analytics_lead_claimed_source(c.custom_fields)
        else public.analytics_lead_source_bucket(
               c.attribution_source,
               case when public.marketing_is_kiosk_contact(c.attribution_source, c.last_attribution_source)
                    then 'Kiosk Waiver' else c.source end,
               opp.position >= 2)
      end as src
    from opp
    left join public.ghl_contacts_v2 c on c.id = opp.contact_id
  )
  select src, count(*),
    count(*) filter (where position >= 1),
    count(*) filter (where position >= 2),
    count(*) filter (where status = 'won'),
    count(*) filter (where status in ('lost', 'abandoned'))
  from joined group by src order by 2 desc
$$;

create or replace function public.analytics_lead_outcomes(
  p_start date, p_end date, p_clubs text[] default null, p_attribution text default 'real'
)
returns table (source text, outcomes bigint, not_interested bigint, day_passes bigint)
language sql
stable
as $$
  with c as (
    select
      c.id,
      (ni.contact_id is not null or coalesce(c.dnd, false)) as not_interested,
      ('guest' = any(c.tags) and not ('sale' = any(c.tags))) as day_pass,
      case when p_attribution = 'claimed'
        then public.analytics_lead_claimed_source(c.custom_fields)
        else public.analytics_lead_source_bucket(
               c.attribution_source,
               case when public.marketing_is_kiosk_contact(c.attribution_source, c.last_attribution_source)
                    then 'Kiosk Waiver' else c.source end,
               false)
      end as src
    from public.ghl_contacts_v2 c
    join public.ghl_locations l on l.id = c.location_id
    left join public.ghl_not_interested ni on ni.contact_id = c.id
    where c.created_at_ghl >= p_start
      and c.created_at_ghl < (p_end + 1)
      and (p_clubs is null or l.slug = any(p_clubs))
  )
  select src,
    count(*) filter (where not_interested or day_pass),
    count(*) filter (where not_interested),
    count(*) filter (where day_pass)
  from c
  group by src
  having count(*) filter (where not_interested or day_pass) > 0
  order by 2 desc
$$;

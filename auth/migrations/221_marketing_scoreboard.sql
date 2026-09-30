-- 221: Marketing Scoreboard (auth/src/routes/marketingScoreboard.js).
--
-- A daily leads / carts / joins table per channel, laid out like the Meta
-- ads sheet Justin keeps: one row per day, totals, CPL, month-end pace against
-- goals. Two channels, never blended:
--
--   meta     paid Facebook / Instagram. Instant Form leads (GHL sets adId),
--            and website / Online Join visits that arrived on a paid click.
--   organic  the website with no paid click: direct, search, referral, and
--            organic social (IG link in bio, shared posts).
--
-- Leads   GHL contacts created that day (Pacific). Meta: paid per
--         marketing_is_meta_paid. Organic: the website's own forms
--         (source external_form / Website) with no paid click.
-- Carts   Online Join starts (online_signups.started_at), one per email per
--         day. Meta when the signup carries a paid click, or the person was a
--         Meta lead in the 90 days before; organic otherwise.
-- Joins   New memberships by since_date, same rules as ghl-sync's Meta
--         Purchase (metaPurchase.js): primary, not a non-member / staff /
--         childcare / Z. Deleting type, not on the skip list. Meta when their
--         first GHL contact at the club was a Meta lead, their Online Join was
--         a paid click, or they were a Meta lead in the 90 days before.
--         Organic when they joined online (entry source Web) or first came in
--         through the website. Walk-ins are in neither.

-- A GHL first-touch attribution that is a paid Meta click.
create or replace function public.marketing_is_meta_paid(p_attr jsonb, p_source text)
returns boolean
language sql
immutable
as $$
  select coalesce(
       p_attr->>'adId' is not null
    or p_attr->>'sessionSource' = 'Paid Social'
    or lower(coalesce(p_attr->>'utmMedium', '')) in ('paid', 'cpc')
    or coalesce(p_attr->>'utmContent', '') ~ '^\d{10,}$'
    or coalesce(p_source, '') ilike 'facebook%', false)
$$;

-- An Online Join signup that arrived on a paid Meta click. A click id with
-- no utm is paid unless the utm says social; an fbc older than 28 days at the
-- start is an old click, not this visit.
create or replace function public.marketing_signup_is_meta_paid(
  p_utm_medium text, p_utm_content text, p_fbclid text, p_fbc text, p_started timestamptz
)
returns boolean
language sql
immutable
as $$
  select coalesce(
       lower(coalesce(p_utm_medium, '')) in ('paid', 'cpc')
    or coalesce(p_utm_content, '') ~ '^\d{10,}$'
    or (
      lower(coalesce(p_utm_medium, '')) not in ('social', 'organic', 'email', 'sms')
      and (
        p_fbclid is not null
        or (p_fbc ~ '^fb\.\d\.\d{13}\.'
            and to_timestamp(split_part(p_fbc, '.', 3)::bigint / 1000.0) > p_started - interval '28 days')
      )
    ), false)
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
  cart_rows as (
    select distinct on (lower(o.email), (o.started_at at time zone 'America/Los_Angeles')::date)
      (o.started_at at time zone 'America/Los_Angeles')::date d,
      case when marketing_signup_is_meta_paid(o.utm_medium, o.utm_content, o.fbclid, o.fbc, o.started_at)
             or exists (select 1 from meta_people mp where mp.em = lower(o.email)
                        and mp.first_at between o.started_at - interval '90 days' and o.started_at)
           then 'meta' else 'organic' end ch
    from online_signups o join cl on cl.club_number = o.abc_club_number, bounds b
    where o.started_at >= b.ts0 and o.started_at < b.ts1
    order by lower(o.email), (o.started_at at time zone 'America/Los_Angeles')::date, o.started_at
  ),
  new_joins as (
    select m.member_id, m.club_number, lower(m.email) em, m.since_date d, m.agreement_entry_source src
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
    where o.started_at < (j.d + 1)::timestamp at time zone 'America/Los_Angeles'
    order by j.member_id, o.started_at desc
  ),
  join_rows as (
    select j.d,
      case when marketing_is_meta_paid(jc.a, jc.src)
             or coalesce(js.paid, false)
             or exists (select 1 from meta_people mp where mp.em = j.em
                        and mp.first_at between (j.d::timestamp at time zone 'America/Los_Angeles') - interval '90 days'
                                            and (j.d + 1)::timestamp at time zone 'America/Los_Angeles')
           then 'meta'
           when j.src = 'Web' or jc.src ilike 'external_form%' or jc.src = 'Website' or jc.src ilike 'online join%'
           then 'organic' end ch
    from new_joins j
    left join join_contact jc using (member_id)
    left join join_signup js using (member_id)
  ),
  days as (
    select g::date d, x.ch
    from generate_series(p_start, p_end, interval '1 day') g
    cross join (values ('meta'), ('organic')) x(ch)
  )
  select days.d, days.ch,
    (select count(*) from lead_rows l where l.d = days.d and l.ch = days.ch)::int,
    (select count(*) from cart_rows c where c.d = days.d and c.ch = days.ch)::int,
    (select count(*) from join_rows j where j.d = days.d and j.ch = days.ch)::int
  from days
  order by days.d, days.ch
$$;

revoke all on function public.marketing_scoreboard_daily(date, date, text[]) from public, anon, authenticated;

-- Monthly goals, per channel, for all clubs ('all') or one club.
create table if not exists public.marketing_scoreboard_goals (
  month        date        not null,          -- first of the month
  channel      text        not null check (channel in ('meta', 'organic')),
  club_number  text        not null default 'all',
  leads        integer,
  carts        integer,
  joins        integer,
  target_cpl   numeric,                       -- meta only
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  primary key (month, channel, club_number)
);

-- Service role only (portal-wide convention): RLS on, no policies.
alter table public.marketing_scoreboard_goals enable row level security;

-- Roles grid (migration 084 pattern). Admin only for now; widen it in
-- Admin -> Roles.
insert into permission_catalog (perm_key, label, category, min_tier) values
  ('report:marketing-scoreboard', 'Marketing Scoreboard', 'Reports', 'admin')
on conflict (perm_key) do nothing;

insert into role_tool_visibility (role, tool_key, visible)
values ('admin', 'report:marketing-scoreboard', true)
on conflict (role, tool_key) do update set visible = true;

notify pgrst, 'reload schema';

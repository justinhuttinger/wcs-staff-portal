-- 194: membership category (Insurance / Temp / Dues) and the members-vs-
-- agreements counting basis.
--
-- TWO NEW CONTROLS
--
-- Category answers "show me this report for insurance plans only". Basis
-- answers "count agreements, not people" — a FAMILY sign-up is one agreement
-- and three members, and reports titled things like "New Member Units" have
-- always been ambiguous about which they meant.
--
-- WHY CATEGORY IS A TABLE AND NOT A CASE EXPRESSION
--
-- Same reason abc_membership_skip_list is a table: ABC invents membership types
-- without telling us, and a rule buried in SQL can only be changed by a
-- deploy. As data it is an admin screen and a row.
--
-- WHY DUES IS AN EXPLICIT LIST RATHER THAN "EVERYTHING ELSE"
--
-- If Dues were the fallback, every type ABC invents next year would silently
-- become a dues payer and the number would drift with nobody noticing. Mapped
-- explicitly, an unknown type lands in Other: visible under All, absent from
-- the three, and findable. Being told about a new plan by seeing it is the
-- whole point.
--
-- MEASURED 2026-09-07, active members, skip list applied, ghosts excluded:
--
--   Dues        11,935
--   Insurance    5,648      <- 32% of the base; filtering to Dues is a big move
--   Temp           254
--   Other            4      CORP PREMIUM, Limited, Z. Deleting Individual
--               ------
--               17,841
--
-- The three do NOT sum to All, by design (Justin's call): Other is reachable
-- only under All. The reports say so rather than letting the gap read as a bug.

create table if not exists public.abc_membership_categories (
  membership_type text primary key,
  category        text not null check (category in ('Insurance', 'Temp', 'Dues')),
  note            text,
  created_at      timestamptz not null default now(),
  created_by      uuid
);

comment on table public.abc_membership_categories is
  'Maps an ABC membership type to Insurance / Temp / Dues for the Analytics category filter. Unmapped types are Other: they count under All and appear under none of the three. Editable from Admin, like abc_membership_skip_list.';

alter table public.abc_membership_categories enable row level security;

-- Matching is case-insensitive everywhere this is read, because ABC spells the
-- same plan two ways ('SUMMER MEMBERSHIP' and 'Summer Membership' are both in
-- abc_members). One row per plan, not one per spelling.
create unique index if not exists abc_membership_categories_lower_idx
  on public.abc_membership_categories (lower(membership_type));

insert into public.abc_membership_categories (membership_type, category, note) values
  -- Insurance: third-party programmes. Nobody here pays us monthly dues.
  ('A2 RECIP USE -Active Adult Reciprocal Use', 'Insurance', 'Active Adult'),
  ('A2 CORE - Active Adult Core',               'Insurance', 'Active Adult'),
  ('A2 EXEC -Active Adult Exec',                'Insurance', 'Active Adult'),
  ('A2 EXEC 247',                               'Insurance', 'Active Adult'),
  ('Active and Fit Limited',                    'Insurance', 'Active&Fit'),
  ('Active and Fit All Access',                 'Insurance', 'Active&Fit'),
  ('Active and Fit Premium',                    'Insurance', 'Active&Fit'),
  ('All Access Active and Fit',                 'Insurance', 'Active&Fit, older spelling'),
  ('Limited Active and Fit',                    'Insurance', 'Active&Fit, older spelling'),
  ('Premium Active and Fit',                    'Insurance', 'Active&Fit, older spelling'),

  -- Temp: memberships that are meant to end. Deliberately NOT derived from
  -- expiration_date — 1,350 plain SINGLE members carry one and that is just a
  -- term end, not a temporary membership.
  ('TEMPORARY SINGLE',                          'Temp', null),
  ('TEMPORARY STUDENT',                         'Temp', null),
  ('TEMPORARY COUPLE',                          'Temp', null),
  ('TEMPORARY FAMILY',                          'Temp', null),
  ('SUMMER MEMBERSHIP',                         'Temp', 'Seasonal, always carries an expiry'),

  -- Dues: pays us every month. Deliberately NOT derived from
  -- projected_due_amount — ABC populates it on 80 of 21,180 active members, so
  -- the money column cannot answer the money question.
  ('SINGLE',         'Dues', null), ('FAMILY',         'Dues', null),
  ('PREMIUM',        'Dues', null), ('COUPLE',         'Dues', null),
  ('STUDENT',        'Dues', null), ('SENIOR',         'Dues', null),
  ('SINGLE D1',      'Dues', null), ('FAMILY D3',      'Dues', null),
  ('COUPLE D2',      'Dues', null), ('SINGLE PREMIUM', 'Dues', null),
  ('MEDFORD PREMIUM','Dues', null), ('MEDFORD SINGLE', 'Dues', null),
  ('MEDFORD FAMILY', 'Dues', null), ('YOUTH',          'Dues', null),
  ('U18',            'Dues', null), ('Standard M2M',   'Dues', null),
  ('One Club',       'Dues', null), ('Military',       'Dues', null)
on conflict (membership_type) do nothing;

-- ---------------------------------------------------------------------------
-- The category joins the one place segments are already defined, so no report
-- re-derives it and none can drift. Added at the END of the select list:
-- create-or-replace on a view permits new trailing columns and nothing else.
-- ---------------------------------------------------------------------------
create or replace view public.abc_member_segments as
select
  m.club_number,
  m.member_id,
  ltrim(m.club_number, '0')      as club_key,
  ltrim(m.agreement_number, '0') as agr_key,
  m.membership_type,
  m.since_date,
  m.member_status,
  m.member_status_date,

  coalesce(nullif(trim(m.membership_type), ''), 'Unknown')            as seg_membership_type,
  coalesce(nullif(trim(m.gender), ''), 'Unknown')                     as seg_gender,
  coalesce(nullif(trim(m.agreement_term), ''), 'Unknown')             as seg_payment_term,
  coalesce(nullif(trim(m.agreement_payment_method), ''), 'Unknown')   as seg_payment_method,
  coalesce(nullif(trim(m.agreement_entry_source), ''), 'Unknown')     as seg_join_source,
  coalesce(
    nullif(regexp_replace(trim(coalesce(m.sales_person_name, '')), '\s+', ' ', 'g'), ''),
    'Unknown'
  )                                                                   as seg_salesperson,

  case
    when m.is_primary_member is true  then 'Primary'
    when m.is_primary_member is false then 'Secondary / Dependent'
    else 'Unknown'
  end                                                                 as seg_relationship,

  case
    when m.birth_date is null then 'Unknown'
    when extract(year from age(current_date, m.birth_date)) < 18 then 'Under 18'
    when extract(year from age(current_date, m.birth_date)) < 25 then '18-24'
    when extract(year from age(current_date, m.birth_date)) < 35 then '25-34'
    when extract(year from age(current_date, m.birth_date)) < 45 then '35-44'
    when extract(year from age(current_date, m.birth_date)) < 55 then '45-54'
    when extract(year from age(current_date, m.birth_date)) < 65 then '55-64'
    else '65+'
  end                                                                 as seg_age_group,

  case
    when m.birth_date is null then 'Unknown'
    when extract(year from m.birth_date) >= 2013 then 'Gen Alpha'
    when extract(year from m.birth_date) >= 1997 then 'Gen Z'
    when extract(year from m.birth_date) >= 1981 then 'Millennial'
    when extract(year from m.birth_date) >= 1965 then 'Gen X'
    when extract(year from m.birth_date) >= 1946 then 'Boomer'
    else 'Silent'
  end                                                                 as seg_generation,

  -- NEW. 'Other' rather than null so a filter comparison never has to reason
  -- about nulls, and so the bucket has a name a reader can see in a legend.
  coalesce(c.category, 'Other')                                       as seg_membership_category
from public.abc_members m
left join public.abc_membership_categories c
  on lower(c.membership_type) = lower(m.membership_type);

comment on view public.abc_member_segments is
  'Single definition of every member segment used by the Analytics reports. Age and generation are as of TODAY, so a member keeps one bucket across their whole history rather than moving between series each month. seg_membership_category comes from abc_membership_categories; unmapped types read Other.';

-- Membership Mix and Past Due read this view directly in JS rather than through
-- a report function, so the category has to reach it too.
create or replace view public.abc_members_counted as
select
  m.*,
  c.membership_type is not null as is_conditional_type,
  case
    when c.membership_type is null then true
    when m.last_check_in_timestamp is null then false
    when m.last_check_in_timestamp !~ '^\d{4}-\d{2}-\d{2}' then false
    when left(m.last_check_in_timestamp, 10)::date >= current_date - c.active_within_days then true
    else false
  end as counts_as_member,
  coalesce(cat.category, 'Other') as membership_category
from public.abc_members m
left join public.abc_conditional_membership_types c
  on c.membership_type = m.membership_type
left join public.abc_membership_categories cat
  on lower(cat.membership_type) = lower(m.membership_type);

comment on view public.abc_members_counted is
  'abc_members plus counts_as_member and membership_category. POINT IN TIME ONLY - never use to rebuild historical headcounts.';

-- ---------------------------------------------------------------------------
-- The three reports in this PR.
--
-- Both parameters go on the END with defaults that reproduce today's behaviour
-- exactly ('all' / 'members'), so an untouched control cannot change a number.
-- The functions are DROPPED first: adding a defaulted parameter creates an
-- overload rather than replacing, and PostgREST would then have two candidates
-- for the same rpc name and refuse the call.
--
-- Both predicates live in the mem CTE, which is the single place each of these
-- functions decides which members exist at all.
-- ---------------------------------------------------------------------------

drop function if exists public.analytics_membership_trends(date, integer, text[], text, boolean);
create function public.analytics_membership_trends(
  p_end      date,
  p_months   integer default 25,
  p_clubs    text[]  default null,
  p_segment  text    default 'club',
  p_exclude  boolean default true,
  p_category text    default 'all',
  p_basis    text    default 'members'
)
returns table (
  month_start   date,
  segment       text,
  total_members bigint,
  new_members   bigint
)
language sql
stable
as $function$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  mem as (
    select
      s.club_number, s.member_id, s.since_date, s.member_status, s.member_status_date,
      s.membership_type,
      case p_segment
        when 'membership_type' then s.seg_membership_type
        when 'gender'          then s.seg_gender
        when 'age_group'       then s.seg_age_group
        when 'generation'      then s.seg_generation
        when 'payment_term'    then s.seg_payment_term
        when 'payment_method'  then s.seg_payment_method
        when 'join_source'     then s.seg_join_source
        when 'salesperson'     then s.seg_salesperson
        when 'relationship'    then s.seg_relationship
        when 'membership_category' then s.seg_membership_category
        else s.club_number
      end as seg
    from public.abc_member_segments s
    where (p_clubs is null or s.club_number = any(p_clubs))
      and (not p_exclude or lower(coalesce(s.membership_type, '')) not in (select t from skip))
      and (p_category = 'all' or s.seg_membership_category = p_category)
      and (p_basis <> 'agreements' or s.seg_relationship = 'Primary')
  ),
  months as (
    select
      mo::date,
      (mo + interval '1 month - 1 day')::date as mo_end
    from generate_series(
      (
        select case
          when p_exclude then greatest(
            date_trunc('month', p_end)::date - ((p_months - 1) || ' months')::interval,
            min(k.month) + interval '1 month'
          )
          else date_trunc('month', p_end)::date - ((p_months - 1) || ' months')::interval
        end
        from public.abc_member_checkin_months k
      ),
      date_trunc('month', p_end)::date,
      '1 month'
    ) as g(mo)
  ),
  cond as (
    select m.club_number, m.member_id, m.since_date, c.active_within_months
    from mem m
    join public.abc_conditional_membership_types c
      on c.membership_type = m.membership_type
  ),
  dead as (
    select mo.mo, c.club_number, c.member_id
    from months mo
    cross join cond c
    cross join lateral (
      select public.analytics_conditional_window_start(mo.mo, c.active_within_months) as w
    ) win
    where not (c.since_date is not null and c.since_date >= win.w)
      and not exists (
        select 1 from public.abc_member_checkin_months k
        where k.club_number = c.club_number
          and k.member_id = c.member_id
          and k.checkins > 0
          and k.month >= win.w
          and k.month <= mo.mo
      )
  ),
  stock as (
    select months.mo, mem.seg, count(*) as n
    from months
    join mem
      on mem.since_date <= months.mo_end
     and not (
       mem.member_status in ('Cancelled', 'Expired', 'Return For Collection')
       and mem.member_status_date <= months.mo_end
     )
    left join dead d
      on p_exclude and d.mo = months.mo
     and d.club_number = mem.club_number and d.member_id = mem.member_id
    where d.member_id is null
    group by 1, 2
  ),
  joined as (
    select months.mo, mem.seg, count(*) as n
    from months
    join mem
      on mem.since_date >= months.mo
     and mem.since_date < months.mo + interval '1 month'
    group by 1, 2
  )
  select
    coalesce(stock.mo, joined.mo)   as month_start,
    coalesce(stock.seg, joined.seg) as segment,
    coalesce(stock.n, 0)            as total_members,
    coalesce(joined.n, 0)           as new_members
  from stock
  full outer join joined on joined.mo = stock.mo and joined.seg = stock.seg
  order by 1, 2;
$function$;

drop function if exists public.analytics_net_membership(date, date, text[], text, boolean);
create function public.analytics_net_membership(
  p_start    date,
  p_end      date,
  p_clubs    text[]  default null,
  p_segment  text    default 'club',
  p_exclude  boolean default true,
  p_category text    default 'all',
  p_basis    text    default 'members'
)
returns table (
  segment      text,
  new_members  bigint,
  lost_members bigint,
  prior_new    bigint,
  prior_lost   bigint
)
language sql
stable
as $function$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  bounds as (
    select
      p_start                                    as s,
      p_end                                      as e,
      (p_start - interval '1 year')::date        as ps,
      (p_end   - interval '1 year')::date        as pe
  ),
  mem as (
    select
      s.club_number, s.member_id, s.since_date, s.member_status, s.member_status_date,
      case p_segment
        when 'membership_type' then s.seg_membership_type
        when 'gender'          then s.seg_gender
        when 'age_group'       then s.seg_age_group
        when 'generation'      then s.seg_generation
        when 'payment_term'    then s.seg_payment_term
        when 'payment_method'  then s.seg_payment_method
        when 'join_source'     then s.seg_join_source
        when 'salesperson'     then s.seg_salesperson
        when 'relationship'    then s.seg_relationship
        when 'membership_category' then s.seg_membership_category
        else s.club_number
      end as seg
    from public.abc_member_segments s
    where (p_clubs is null or s.club_number = any(p_clubs))
      and (not p_exclude or lower(coalesce(s.membership_type, '')) not in (select t from skip))
      and (p_category = 'all' or s.seg_membership_category = p_category)
      and (p_basis <> 'agreements' or s.seg_relationship = 'Primary')
  ),
  dead_now as (
    select * from public.analytics_members_excluded_as_of(p_end)
  ),
  dead_prior as (
    select * from public.analytics_members_excluded_as_of((p_end - interval '1 year')::date)
  ),
  lost as (
    select m.seg, count(*) as n
    from mem m, bounds b
    left join dead_now d
      on p_exclude and d.club_number = m.club_number and d.member_id = m.member_id
    where m.member_status in ('Cancelled', 'Expired', 'Return For Collection')
      and m.member_status_date between b.s and b.e
      and d.member_id is null
    group by 1
  ),
  lost_prior as (
    select m.seg, count(*) as n
    from mem m, bounds b
    left join dead_prior d
      on p_exclude and d.club_number = m.club_number and d.member_id = m.member_id
    where m.member_status in ('Cancelled', 'Expired', 'Return For Collection')
      and m.member_status_date between b.ps and b.pe
      and d.member_id is null
    group by 1
  ),
  gained as (
    select m.seg, count(*) as n
    from mem m, bounds b
    where m.since_date between b.s and b.e
    group by 1
  ),
  gained_prior as (
    select m.seg, count(*) as n
    from mem m, bounds b
    where m.since_date between b.ps and b.pe
    group by 1
  ),
  segs as (
    select seg from gained
    union select seg from lost
    union select seg from gained_prior
    union select seg from lost_prior
  )
  select
    segs.seg                          as segment,
    coalesce(gained.n, 0)             as new_members,
    coalesce(lost.n, 0)               as lost_members,
    coalesce(gained_prior.n, 0)       as prior_new,
    coalesce(lost_prior.n, 0)         as prior_lost
  from segs
  left join gained       on gained.seg = segs.seg
  left join lost         on lost.seg = segs.seg
  left join gained_prior on gained_prior.seg = segs.seg
  left join lost_prior   on lost_prior.seg = segs.seg
  order by (coalesce(gained.n, 0) - coalesce(lost.n, 0)) desc;
$function$;

drop function if exists public.analytics_attrition_trends(date, integer, text[], text, boolean);
create function public.analytics_attrition_trends(
  p_end      date,
  p_months   integer default 25,
  p_clubs    text[]  default null,
  p_segment  text    default 'club',
  p_exclude  boolean default true,
  p_category text    default 'all',
  p_basis    text    default 'members'
)
returns table (
  month_start date,
  segment text,
  members bigint,
  lost_members bigint,
  monthly_dues_lost numeric,
  monthly_revenue_lost numeric
)
language sql
stable
as $$
  with months as (
    select
      m as mo,
      least((m + interval '1 month' - interval '1 day')::date, p_end) as mo_end
    from generate_series(
      date_trunc('month', p_end)::date - ((p_months - 1) || ' months')::interval,
      date_trunc('month', p_end)::date,
      '1 month'
    ) g(m)
  ),
  skip as (select lower(membership_type) as t from public.abc_membership_skip_list),
  mem as (
    select
      m.club_number, m.member_id, m.membership_type, m.since_date,
      m.member_status, m.member_status_date, m.agreement_number,
      case p_segment
        when 'overall'         then 'Overall'
        when 'club'            then m.club_number
        when 'membership_type' then coalesce(s.seg_membership_type, 'Unknown')
        when 'gender'          then coalesce(s.seg_gender, 'Unknown')
        when 'age_group'       then coalesce(s.seg_age_group, 'Unknown')
        when 'generation'      then coalesce(s.seg_generation, 'Unknown')
        when 'payment_term'    then coalesce(s.seg_payment_term, 'Unknown')
        when 'payment_method'  then coalesce(s.seg_payment_method, 'Unknown')
        when 'join_source'     then coalesce(s.seg_join_source, 'Unknown')
        when 'salesperson'     then coalesce(s.seg_salesperson, 'Unknown')
        when 'relationship'    then coalesce(s.seg_relationship, 'Unknown')
        when 'membership_category' then coalesce(s.seg_membership_category, 'Other')
        else 'Overall'
      end as seg
    from public.abc_members m
    left join public.abc_member_segments s
      on s.club_number = m.club_number and s.member_id = m.member_id
    where (p_clubs is null or m.club_number = any(p_clubs))
      and (not p_exclude or lower(coalesce(m.membership_type, '')) not in (select t from skip))
      and (p_category = 'all' or coalesce(s.seg_membership_category, 'Other') = p_category)
      and (p_basis <> 'agreements' or coalesce(s.seg_relationship, 'Unknown') = 'Primary')
  ),
  leavers_raw as (
    select mo.mo, mo.mo_end, m.seg, m.club_number, m.member_id, m.membership_type,
           m.since_date, m.agreement_number, m.member_status_date::date as left_on
    from mem m
    join months mo
      on m.member_status_date >= mo.mo and m.member_status_date <= mo.mo_end
    where m.member_status in ('Cancelled', 'Expired', 'Return For Collection')
  ),
  leavers as (
    select l.*,
           greatest(1, least(12,
             (l.left_on - greatest(coalesce(l.since_date, l.left_on - 365), l.left_on - 365)) / 30.0
           ))::numeric as tenure_months
    from leavers_raw l
    where not p_exclude
       or not exists (
         select 1
         from public.abc_conditional_membership_types c
         where c.membership_type = l.membership_type
           and not (l.since_date is not null
                    and l.since_date >= public.analytics_conditional_window_start(l.mo_end, c.active_within_months))
           and not exists (
             select 1 from public.abc_member_checkin_months k
             where k.club_number = l.club_number and k.member_id = l.member_id
               and k.checkins > 0
               and k.month >= public.analytics_conditional_window_start(l.mo_end, c.active_within_months)
               and k.month <= date_trunc('month', l.mo_end)::date
           )
       )
  ),
  spend as (
    select l.mo, l.seg, l.member_id,
      coalesce(sum(t.payment_amount) filter (where g.revenue_class = 'Dues & Fees'), 0) / l.tenure_months as mo_dues,
      coalesce(sum(t.payment_amount) filter (where g.revenue_class = 'Discretionary'), 0) / l.tenure_months as mo_disc
    from leavers l
    left join public.abc_revenue_transactions t
      on ltrim(t.club_number, '0') = ltrim(l.club_number, '0')
     and lpad(t.member_number, 5, '0') = lpad(l.agreement_number, 5, '0')
     and t.payment_date > l.left_on - 365
     and t.payment_date <= l.left_on
    left join public.abc_profit_center_groups g on g.profit_center = t.profit_center
    group by l.mo, l.seg, l.member_id, l.tenure_months
  ),
  lost_agg as (
    select mo, seg, count(*) as n,
           coalesce(sum(mo_dues), 0) as dues,
           coalesce(sum(mo_dues + mo_disc), 0) as revenue
    from spend group by mo, seg
  ),
  -- The base MUST take the same category and basis, or a filtered loss count
  -- would be divided into an unfiltered membership and every attrition rate on
  -- the report would be wrong by the size of the filter.
  base as (
    select
      t.month_start,
      case when p_segment = 'overall' then 'Overall' else t.segment end as segment,
      sum(t.total_members) as total_members
    from public.analytics_membership_trends(
           p_end, p_months, p_clubs,
           case when p_segment = 'overall' then 'club' else p_segment end,
           p_exclude, p_category, p_basis) t
    group by 1, 2
  )
  select
    coalesce(b.month_start, l.mo),
    coalesce(b.segment, l.seg),
    coalesce(b.total_members, 0)::bigint,
    coalesce(l.n, 0),
    round(coalesce(l.dues, 0), 2),
    round(coalesce(l.revenue, 0), 2)
  from base b
  full outer join lost_agg l on l.mo = b.month_start and l.seg = b.segment
  order by 1, 2
$$;

-- Monthly series behind Analytics > Revenue Per Member.
--
-- THE JOIN
--
-- abc_revenue_transactions.member_number is the AGREEMENT number, not a member
-- id: it matches abc_members.agreement_number, both short and zero-padded.
-- (The transaction's own agreement_number column is club + member_number
-- concatenated, and its club_number is zero-padded where abc_members' is not,
-- which is why a naive join on either column returns exactly zero rows.)
-- Compared with leading zeros stripped from both sides, 90% of transactions
-- match, carrying 95.4% of revenue. The remainder are guests, non-members and
-- purged accounts.
--
-- SPLITTING
--
-- Revenue lands on an agreement, and a family agreement covers several people.
-- Each transaction is therefore divided evenly across the members on its
-- agreement, so the per-segment revenue still sums to real revenue instead of
-- being multiplied once per family member.
--
-- TWO APPROXIMATIONS, both unavoidable with the data we hold:
--   * a member's segment is their CURRENT one. Revenue from March is attributed
--     to the membership type they hold today, so a member who changed plans
--     carries their whole history under the new one.
--   * the split uses today's agreement composition, not the composition at the
--     time of the payment.
-- Both wash out at club level and matter most for small segments.

create or replace function public.analytics_revenue_per_member(
  p_end       date,
  p_months    int     default 25,
  p_clubs     text[]  default null,
  p_breakdown text    default 'membership_type',
  p_exclude   boolean default true
)
returns table (
  month_start date,
  segment     text,
  revenue     numeric,
  members     bigint
)
language sql
stable
as $$
  with skip as (
    select lower(membership_type) as t from public.abc_membership_skip_list
  ),
  mem as (
    select
      m.*,
      ltrim(m.club_number, '0')      as club_key,
      ltrim(m.agreement_number, '0') as agr_key,
      case p_breakdown
        when 'gender'         then coalesce(nullif(trim(m.gender), ''), 'Unknown')
        when 'payment_term'   then coalesce(nullif(trim(m.agreement_term), ''), 'Unknown')
        when 'payment_method' then coalesce(nullif(trim(m.agreement_payment_method), ''), 'Unknown')
        when 'join_source'    then coalesce(nullif(trim(m.agreement_entry_source), ''), 'Unknown')
        when 'salesperson'    then coalesce(nullif(regexp_replace(trim(coalesce(m.sales_person_name, '')), '\s+', ' ', 'g'), ''), 'Unknown')
        when 'relationship'   then case
                                     when m.is_primary_member is true then 'Primary'
                                     when m.is_primary_member is false then 'Secondary / Dependent'
                                     else 'Unknown' end
        when 'age_group'      then case
                                     when m.birth_date is null then 'Unknown'
                                     when extract(year from age(p_end, m.birth_date)) < 18 then 'Under 18'
                                     when extract(year from age(p_end, m.birth_date)) < 25 then '18-24'
                                     when extract(year from age(p_end, m.birth_date)) < 35 then '25-34'
                                     when extract(year from age(p_end, m.birth_date)) < 45 then '35-44'
                                     when extract(year from age(p_end, m.birth_date)) < 55 then '45-54'
                                     when extract(year from age(p_end, m.birth_date)) < 65 then '55-64'
                                     else '65+' end
        when 'generation'     then case
                                     when m.birth_date is null then 'Unknown'
                                     when extract(year from m.birth_date) >= 2013 then 'Gen Alpha'
                                     when extract(year from m.birth_date) >= 1997 then 'Gen Z'
                                     when extract(year from m.birth_date) >= 1981 then 'Millennial'
                                     when extract(year from m.birth_date) >= 1965 then 'Gen X'
                                     when extract(year from m.birth_date) >= 1946 then 'Boomer'
                                     else 'Silent' end
        else coalesce(nullif(trim(m.membership_type), ''), 'Unknown')
      end as segment
    from public.abc_members m
    where (p_clubs is null or m.club_number = any(p_clubs))
      and (not p_exclude or lower(coalesce(m.membership_type, '')) not in (select t from skip))
  ),
  -- How many members share each agreement, so a payment can be divided.
  agr as (
    select club_key, agr_key, segment,
           count(*) over (partition by club_key, agr_key) as members_on_agreement
    from mem
    where agr_key is not null and agr_key <> ''
  ),
  months as (
    select generate_series(
      date_trunc('month', p_end)::date - ((p_months - 1) || ' months')::interval,
      date_trunc('month', p_end)::date,
      '1 month'
    )::date as mo
  ),
  rev as (
    select date_trunc('month', r.payment_date)::date as mo,
           a.segment,
           sum(r.payment_amount / a.members_on_agreement) as revenue
    from public.abc_revenue_transactions r
    join agr a
      on a.club_key = ltrim(r.club_number, '0')
     and a.agr_key  = ltrim(r.member_number, '0')
    where r.payment_date >= (date_trunc('month', p_end)::date - ((p_months - 1) || ' months')::interval)
      and r.payment_date <= p_end
      and (p_clubs is null or ltrim(r.club_number, '0') = any(select ltrim(c, '0') from unnest(p_clubs) c))
    group by 1, 2
  ),
  -- Members on the books at each month end, by segment. Same reconstruction as
  -- analytics_club_activity: joined by then, not already lost by then.
  base as (
    select months.mo, mem.segment, count(*) as members
    from months
    join mem
      on mem.since_date <= (months.mo + interval '1 month - 1 day')::date
     and not (
       mem.member_status in ('Cancelled', 'Expired', 'Return For Collection')
       and mem.member_status_date <= (months.mo + interval '1 month - 1 day')::date
     )
    group by 1, 2
  )
  select
    coalesce(base.mo, rev.mo)                as month_start,
    coalesce(base.segment, rev.segment)      as segment,
    coalesce(rev.revenue, 0)                 as revenue,
    coalesce(base.members, 0)                as members
  from base
  full outer join rev on rev.mo = base.mo and rev.segment = base.segment
  order by 1, 2;
$$;

comment on function public.analytics_revenue_per_member is
  'Monthly revenue and member counts per segment. Revenue joins abc_revenue_transactions.member_number to abc_members.agreement_number (leading zeros stripped) and is split across the members sharing each agreement.';

-- The join strips leading zeros on both sides, so plain column indexes cannot
-- serve it.
create index if not exists idx_abc_members_agreement_key
  on public.abc_members ((ltrim(club_number, '0')), (ltrim(agreement_number, '0')));

create index if not exists idx_abc_revenue_member_key
  on public.abc_revenue_transactions ((ltrim(club_number, '0')), (ltrim(member_number, '0')));

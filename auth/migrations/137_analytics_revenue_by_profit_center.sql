-- 137: profit centre groups, and Revenue by Profit Center.
--
-- The grouping lives in a TABLE, not a CASE, so adding a centre is a row rather
-- than a deploy -- and, more importantly, so anything NOT listed falls into
-- Other automatically. ABC gains profit centres over time; a CASE would
-- silently drop them.
--
-- WHICH GROUPS. Justin asked for annual fee, dues, training, WCS drinks, WCS
-- snacks, WCS merch and swim, with everything else in Other and an invitation
-- to promote anything really large. WCS Supplements earns a place on that
-- basis: at $18,321 in July 2026 it beats both Merchandise ($14,793) and Snacks
-- ($5,363), and it is the same retail family. That makes 8 named groups plus
-- Other, which is exactly the categorical ceiling a stacked chart can carry.
--
-- Guest Fees is the largest thing left in Other and is deliberately there --
-- promoting it too would take the chart past what its palette can distinguish.
create table if not exists public.abc_profit_center_groups (
  profit_center text primary key,
  group_name    text not null,
  sort_order    integer not null default 100
);

alter table public.abc_profit_center_groups enable row level security;

insert into public.abc_profit_center_groups (profit_center, group_name, sort_order) values
  ('DUES',                   'Dues',            10),
  ('A2EXECDUES',             'Dues',            10),
  ('A2 EXEC DUES',           'Dues',            10),
  ('SUMMER MEMBERSHIP DUES', 'Dues',            10),
  ('GYMSTRDUES',             'Dues',            10),
  ('MBODUES',                'Dues',            10),
  ('TRAINING',               'Training',        20),
  ('ANNUALFEE',              'Annual Fee',      30),
  ('ANNUAL',                 'Annual Fee',      30),
  ('WCS DRINKS',             'WCS Drinks',      40),
  ('WCS SNACKS',             'WCS Snacks',      50),
  ('WCS MERCHANDISE',        'WCS Merchandise', 60),
  ('WCS SUPPLEMENTS',        'WCS Supplements', 70),
  ('PRIVATE SWIM LESSONS',   'Swim',            80),
  ('GROUP SWIM LESSONS',     'Swim',            80),
  ('SWIM CLUB',              'Swim',            80)
on conflict (profit_center) do update
  set group_name = excluded.group_name, sort_order = excluded.sort_order;

comment on table public.abc_profit_center_groups is
  'Maps ABC profit centres onto the groups the Revenue by Profit Center report shows. Anything unmapped falls into Other, so a new profit centre is never silently lost.';

-- Rows are a segment (club by default), stacked by profit centre group.
--
-- NO SALES TAX CONTROL. Their tool has one; we have nothing to control --
-- tax_amount is 0 on every row of every month, because Oregon has no sales tax.
-- A toggle that cannot change a number is worse than no toggle.
--
-- Revenue is NET: refunds and chargebacks are profit centres of their own and
-- carry negative amounts, so they reduce Other rather than being filtered out.
-- Dropping them would overstate what we actually collected.
--
-- Verified: July 2026 sums to $904,228 under both the club view and the gender
-- view, matching the raw transaction total exactly.
create or replace function public.analytics_revenue_by_profit_center(
  p_start date,
  p_end   date,
  p_clubs text[] default null,
  p_view  text   default 'club'
)
returns table (view_key text, group_name text, sort_order integer, revenue numeric)
language sql
stable
as $function$
  with tx as (
    select
      r.id, r.club_number, r.payment_amount, r.payment_type,
      ltrim(r.club_number, '0')   as club_key,
      ltrim(r.member_number, '0') as agr_key,
      coalesce(g.group_name, 'Other') as grp,
      coalesce(g.sort_order, 999)     as ord
    from public.abc_revenue_transactions r
    left join public.abc_profit_center_groups g
      on g.profit_center = r.profit_center
    where r.payment_date between p_start and p_end
      and (p_clubs is null or r.club_number = any(p_clubs))
  ),
  -- A payment sits on an AGREEMENT, and an agreement can carry several members
  -- with different segments. Joining naively would multiply a family's revenue
  -- by its size, so the payment is split evenly across the members sharing the
  -- agreement -- the same rule Revenue Per Member uses, so the two reports agree.
  seg as (
    select
      s.club_key, s.agr_key,
      case p_view
        when 'membership_type' then s.seg_membership_type
        when 'gender'          then s.seg_gender
        when 'age_group'       then s.seg_age_group
        when 'generation'      then s.seg_generation
        when 'join_source'     then s.seg_join_source
      end as v,
      count(*) over (partition by s.club_key, s.agr_key) as members_on_agreement
    from public.abc_member_segments s
    where p_view in ('membership_type','gender','age_group','generation','join_source')
      and s.agr_key is not null and s.agr_key <> ''
  ),
  resolved as (
    select
      case p_view
        when 'club'         then tx.club_number
        when 'payment_type' then coalesce(nullif(trim(tx.payment_type), ''), 'Unknown')
        -- No agreement match: a guest, a non-member or a purged account. Kept
        -- as its own bar rather than dropped, so the stack still sums to total
        -- revenue.
        else coalesce(seg.v, 'Unattributed')
      end as view_key,
      tx.grp,
      tx.ord,
      case
        when p_view in ('club','payment_type') then tx.payment_amount
        when seg.v is null then tx.payment_amount
        else tx.payment_amount / seg.members_on_agreement
      end as amount
    from tx
    left join seg
      on p_view not in ('club','payment_type')
     and seg.club_key = tx.club_key
     and seg.agr_key  = tx.agr_key
  )
  select view_key, grp as group_name, ord as sort_order, sum(amount) as revenue
  from resolved
  group by 1, 2, 3
  order by 3, 4 desc;
$function$;

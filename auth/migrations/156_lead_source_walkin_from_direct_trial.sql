-- 156_lead_source_walkin_from_direct_trial.sql
--
-- A contact with no marketing attribution who went STRAIGHT INTO A TRIAL walked
-- in. That is what the pattern means in practice: nobody clicked an ad or filled
-- a form, and the first thing on their record is a trial started at the desk.
--
-- Previously these landed in "No Source Recorded", which was accurate about the
-- data and useless about the business: 513 of 513 such opportunities were Trial
-- Started created directly, and the bucket showed a 45% join rate nobody could
-- act on. Counting them as Walk-in puts them in the channel they came from and
-- lets that channel be compared with the others.
--
-- The effect for August 2026: Walk-in goes from 641 leads / 41 joined to 763 /
-- 163, making it the best-converting channel in the business at 21.4% against
-- Website's 19.0%. No Source Recorded drops to 81 leads with no trials and no
-- joins at all -- which is what that bucket should look like.
--
-- It survives for contacts with no attribution, no source AND no trial. Those
-- really are unidentified records, and folding them into Walk-in would inflate a
-- real channel with rows that mean nothing.
--
-- The trial flag has to be passed IN because bucketing is per contact and the
-- trial lives on the opportunity. analytics_lead_sources computes the
-- opportunity rollup first and hands the flag down.

create or replace function public.analytics_lead_source_bucket(
  p_attribution jsonb,
  p_source text,
  p_has_trial boolean default false
)
returns text
language sql
immutable
as $$
  select case
    when p_attribution->>'sessionSource' in ('Paid Social', 'Social media')
      or lower(coalesce(p_attribution->>'medium', '')) = 'facebook'
      then 'Facebook'
    when p_attribution->>'sessionSource' in ('CRM UI', 'CRM Workflows')
      or lower(coalesce(p_attribution->>'medium', '')) in ('manual', 'csv_import', 'conversation')
      then 'Walk-in / Manual'
    when p_attribution->>'sessionSource' in ('Direct traffic', 'Organic Search', 'Referral')
      or lower(coalesce(p_attribution->>'medium', '')) in ('survey', 'form', 'calendar')
      then 'Website'
    when p_source ilike 'front desk%' or p_source ilike 'kiosk%'
      or p_source ilike 'day 1%' or p_source ilike 'day one%'
      then 'Walk-in / Manual'
    when p_source ilike 'online join%' or p_source ilike 'payment_link%'
      then 'Website'
    when p_source ilike '%facebook%' or p_source ilike '%instagram%'
      then 'Facebook'
    -- No attribution, no source, but they started a trial: a walk-in.
    when p_attribution is null and coalesce(btrim(p_source), '') = '' and p_has_trial
      then 'Walk-in / Manual'
    when p_attribution is null and coalesce(btrim(p_source), '') = ''
      then 'No Source Recorded'
    else 'Other'
  end
$$;

-- The opportunity rollup moves ABOVE the contact scan so the trial flag can be
-- handed down to the bucketing.
create or replace function public.analytics_lead_sources(
  p_start date,
  p_end date,
  p_clubs text[] default null,
  p_attribution text default 'real'
)
returns table (
  source text,
  leads bigint,
  tours bigint,
  trials bigint,
  won bigint,
  not_interested bigint,
  lost bigint
)
language sql
stable
as $$
  with claimed_fields as (
    select array_agg(distinct id) as ids
    from public.ghl_custom_field_defs
    where field_key = 'contact.how_did_you_hear_about_us'
  ),
  opps as (
    select o.contact_id,
           bool_or(s.name = 'Tour Booked') as had_tour,
           bool_or(s.name = 'Trial Started') as had_trial,
           bool_or(o.status = 'won') as won,
           bool_or(o.status in ('lost', 'abandoned')) as lost
    from public.ghl_opportunities_v2 o
    left join public.ghl_pipeline_stages s on s.id = o.stage_id
    group by o.contact_id
  ),
  contacts as (
    select
      c.id,
      c.tags,
      o.had_tour, o.had_trial, o.won, o.lost,
      case
        when p_attribution = 'claimed' then coalesce(
          (select c.custom_fields->>k
             from claimed_fields cf, lateral unnest(cf.ids) k
            where c.custom_fields ? k
            limit 1),
          'Not Asked'
        )
        -- The trial flag is what turns an unattributed record into a walk-in.
        else public.analytics_lead_source_bucket(
          c.attribution_source, c.source, coalesce(o.had_trial, false))
      end as src
    from public.ghl_contacts_v2 c
    join public.ghl_locations l on l.id = c.location_id
    left join opps o on o.contact_id = c.id
    where c.created_at_ghl >= p_start
      and c.created_at_ghl < (p_end + 1)
      and (p_clubs is null or l.slug = any(p_clubs))
  )
  select
    c.src,
    count(*),
    count(*) filter (where c.had_tour),
    count(*) filter (where c.had_trial),
    count(*) filter (where c.won),
    count(*) filter (where 'not interested' = any(c.tags)),
    count(*) filter (where c.lost)
  from contacts c
  group by c.src
  order by 2 desc
$$;

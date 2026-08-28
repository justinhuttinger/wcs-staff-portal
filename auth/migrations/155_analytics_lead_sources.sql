-- 155_analytics_lead_sources.sql
--
-- Analytics > Lead Sources. Where leads come from, and what became of them.
--
-- TWO ATTRIBUTIONS, DELIBERATELY KEPT APART.
--
--   REAL     what GHL observed on the contact's FIRST touch (attribution_source,
--            not last_attribution_source -- 15% of contacts differ between the
--            two, so the choice is not cosmetic).
--   CLAIMED  what the person said when asked: the "How Did you Hear About Us?"
--            dropdown.
--
-- They answer different questions on different populations and must never be
-- blended. A lead can be observed as Facebook and claim Friend/Family; both are
-- true, and the gap is the interesting part.
--
-- CLAIMED IS ALL BUT EMPTY: 42 of 88,419 contacts, 0.05%. Not a sync gap --
-- 62,000 of those contacts carry other custom fields. The view is built so it
-- fills itself in the day the question starts being asked; the report carries a
-- coverage warning until then.
--
-- WHEN THERE IS NO OBSERVED ATTRIBUTION, THE CONTACT SOURCE IS USED INSTEAD.
-- 1,669 contacts in a 120-day window have no attribution_source, and they are
-- not unknown marketing: they are Online Join, Front Desk Guest Form, Kiosk
-- Waiver and Day One forms. Filing them under Unknown made that bucket the
-- best-converting "source" in the report, which is an artefact, not a finding.
--
-- NOTE: migration 156 replaces both functions below to add the walk-in rule.
-- This file is the original creation and is kept so the sequence is honest;
-- a fresh database should apply 155 then 156.

create or replace function public.analytics_lead_source_bucket(
  p_attribution jsonb,
  p_source text
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
    when p_attribution is null and coalesce(btrim(p_source), '') = ''
      then 'No Source Recorded'
    else 'Other'
  end
$$;

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
  contacts as (
    select
      c.id,
      c.tags,
      case
        when p_attribution = 'claimed' then coalesce(
          -- The dropdown has a different id per location, so every one is
          -- checked.
          (select c.custom_fields->>k
             from claimed_fields cf, lateral unnest(cf.ids) k
            where c.custom_fields ? k
            limit 1),
          'Not Asked'
        )
        else public.analytics_lead_source_bucket(c.attribution_source, c.source)
      end as src
    from public.ghl_contacts_v2 c
    -- Clubs come from ghl_locations.slug. This is the one report whose world is
    -- GHL rather than ABC, and the two number clubs differently.
    join public.ghl_locations l on l.id = c.location_id
    where c.created_at_ghl >= p_start
      and c.created_at_ghl < (p_end + 1)
      and (p_clubs is null or l.slug = any(p_clubs))
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
  )
  select
    c.src,
    count(*),
    count(*) filter (where o.had_tour),
    count(*) filter (where o.had_trial),
    count(*) filter (where o.won),
    -- The workflow tags the contact; there is no opportunity stage for it.
    count(*) filter (where 'not interested' = any(c.tags)),
    count(*) filter (where o.lost)
  from contacts c
  left join opps o on o.contact_id = c.id
  group by c.src
  order by 2 desc
$$;

-- 160_lead_outcomes_contact_level.sql
--
-- Not Interested and Day Pass move OUT of the opportunity funnel entirely.
--
-- BOTH OUTCOMES DELETE THE OPPORTUNITY IN GHL. The consequences are not
-- cosmetic:
--
--   Of 3,797 contacts who finished the Not Interested workflow, only 474 (12%)
--   still have a membership opportunity. Counting not-interested from the funnel
--   missed 88% of them -- Salem showed 12 where the truth is 52.
--
--   Of 377 day-pass contacts in August, exactly ONE had an opportunity.
--
-- So both are counted per CONTACT, and the funnel keeps only what GHL's board
-- keeps -- which is what makes it reconcile: Salem 1-27 August returns 148 leads
-- and 56 signed against GHL's own 148 and 56.
--
-- READ THEM AS ADDITIONAL TO THE FUNNEL, NOT A SLICE OF IT. Because the card is
-- deleted, somebody who was a lead and then went not-interested has already left
-- the 148. The arithmetic will not add up if they are read as a subset, and the
-- report says so rather than leaving it to be discovered.
--
-- NOTE: migration 161 replaces both functions again, to read claimed attribution
-- from contact.marketing_source. Apply 160 then 161.

drop function if exists public.analytics_lead_sources(date, date, text[], text);
drop function if exists public.analytics_lead_day_passes(date, date, text[], text);

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
  opp as (
    select o.id, o.contact_id, o.status, s.position, l.slug
    from public.ghl_opportunities_v2 o
    join public.ghl_locations l on l.id = o.location_id
    join public.ghl_pipelines p on p.id = o.pipeline_id
    join public.ghl_pipeline_stages s on s.id = o.stage_id
    where p.name in ('Membership Pipeline', 'Standard Member Pipeline')
      and o.created_at_ghl >= p_start
      and o.created_at_ghl < (p_end + 1)
      and (p_clubs is null or l.slug = any(p_clubs))
  ),
  joined as (
    select
      opp.*,
      case
        when p_attribution = 'claimed' then coalesce(
          (select c.custom_fields->>k
             from claimed_fields cf, lateral unnest(cf.ids) k
            where c.custom_fields ? k
            limit 1),
          'Not Asked'
        )
        else public.analytics_lead_source_bucket(
          c.attribution_source, c.source, opp.position >= 2)
      end as src
    from opp
    left join public.ghl_contacts_v2 c on c.id = opp.contact_id
  )
  select
    src,
    count(*),
    -- REACHED at least this stage, not currently sitting in it: stage_id is a
    -- position, not a history.
    count(*) filter (where position >= 1),
    count(*) filter (where position >= 2),
    count(*) filter (where status = 'won'),
    count(*) filter (where status in ('lost', 'abandoned'))
  from joined
  group by src
  order by 2 desc
$$;

-- The two outcomes whose opportunities are deleted, counted per contact.
create or replace function public.analytics_lead_outcomes(
  p_start date,
  p_end date,
  p_clubs text[] default null,
  p_attribution text default 'real'
)
returns table (
  source text,
  not_interested bigint,
  day_passes bigint
)
language sql
stable
as $$
  with claimed_fields as (
    select array_agg(distinct id) as ids
    from public.ghl_custom_field_defs
    where field_key = 'contact.how_did_you_hear_about_us'
  ),
  c as (
    select
      c.id,
      -- Finished the workflow (migration 157), or asked not to be contacted.
      (ni.contact_id is not null or coalesce(c.dnd, false)) as not_interested,
      ('guest' = any(c.tags) and not ('sale' = any(c.tags))) as day_pass,
      case
        when p_attribution = 'claimed' then coalesce(
          (select c.custom_fields->>k
             from claimed_fields cf, lateral unnest(cf.ids) k
            where c.custom_fields ? k
            limit 1),
          'Not Asked'
        )
        -- No trial flag: these contacts have no opportunity to have reached one.
        else public.analytics_lead_source_bucket(c.attribution_source, c.source, false)
      end as src
    from public.ghl_contacts_v2 c
    join public.ghl_locations l on l.id = c.location_id
    left join public.ghl_not_interested ni on ni.contact_id = c.id
    where c.created_at_ghl >= p_start
      and c.created_at_ghl < (p_end + 1)
      and (p_clubs is null or l.slug = any(p_clubs))
  )
  select src,
    count(*) filter (where not_interested),
    count(*) filter (where day_pass)
  from c
  group by src
  having count(*) filter (where not_interested) > 0
      or count(*) filter (where day_pass) > 0
  order by 2 desc
$$;

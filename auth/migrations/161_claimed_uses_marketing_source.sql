-- 161_claimed_uses_marketing_source.sql
--
-- Claimed attribution reads Marketing Source, not "How Did you Hear About Us?".
--
-- I picked the wrong field. "How Did you Hear About Us?" exists at every
-- location and is filled in on 42 contacts of 88,419 — a legacy field nobody
-- uses. The question staff actually ask writes to contact.marketing_source,
-- which carries 5,054 of the 11,909 contacts created in the last 120 days: 42%
-- coverage, and real answers.
--
--   Friend or Family Referral 2071   Google Maps            275
--   Other                      826   Drove By / Saw the Gym 241
--   Google Search              665   Facebook               176
--   Instagram                  559   TikTok                 106
--
-- The old field is kept as a fallback so those 42 are not thrown away, but it is
-- read second.
--
-- The lesson: the field NAMED after the question was not the field carrying the
-- answer, and a 0.05% coverage figure should have prompted a search for the real
-- one rather than a note on the report explaining the emptiness.

create or replace function public.analytics_lead_claimed_source(p_custom_fields jsonb)
returns text
language sql
stable
as $$
  with prim as (
    select array_agg(distinct id) as ids
    from public.ghl_custom_field_defs where field_key = 'contact.marketing_source'
  ),
  legacy as (
    select array_agg(distinct id) as ids
    from public.ghl_custom_field_defs where field_key = 'contact.how_did_you_hear_about_us'
  )
  select coalesce(
    (select nullif(btrim(p_custom_fields->>k), '')
       from prim, lateral unnest(prim.ids) k
      where p_custom_fields ? k limit 1),
    (select nullif(btrim(p_custom_fields->>k), '')
       from legacy, lateral unnest(legacy.ids) k
      where p_custom_fields ? k limit 1),
    -- Never folded into a real source: "we did not ask" is its own answer.
    'Not Asked'
  )
$$;

create or replace function public.analytics_lead_sources(
  p_start date, p_end date, p_clubs text[] default null, p_attribution text default 'real'
)
returns table (
  source text, leads bigint, tours bigint, trials bigint, won bigint, lost bigint
)
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
               c.attribution_source, c.source, opp.position >= 2)
      end as src
    from opp
    left join public.ghl_contacts_v2 c on c.id = opp.contact_id
  )
  select src, count(*),
    -- REACHED at least this stage, not currently sitting in it.
    count(*) filter (where position >= 1),
    count(*) filter (where position >= 2),
    count(*) filter (where status = 'won'),
    count(*) filter (where status in ('lost', 'abandoned'))
  from joined group by src order by 2 desc
$$;

create or replace function public.analytics_lead_outcomes(
  p_start date, p_end date, p_clubs text[] default null, p_attribution text default 'real'
)
returns table (source text, not_interested bigint, day_passes bigint)
language sql
stable
as $$
  with c as (
    select c.id,
      (ni.contact_id is not null or coalesce(c.dnd, false)) as not_interested,
      ('guest' = any(c.tags) and not ('sale' = any(c.tags))) as day_pass,
      case when p_attribution = 'claimed'
        then public.analytics_lead_claimed_source(c.custom_fields)
        else public.analytics_lead_source_bucket(c.attribution_source, c.source, false)
      end as src
    from public.ghl_contacts_v2 c
    join public.ghl_locations l on l.id = c.location_id
    left join public.ghl_not_interested ni on ni.contact_id = c.id
    where c.created_at_ghl >= p_start and c.created_at_ghl < (p_end + 1)
      and (p_clubs is null or l.slug = any(p_clubs))
  )
  select src,
    count(*) filter (where not_interested),
    count(*) filter (where day_pass)
  from c group by src
  having count(*) filter (where not_interested) > 0
      or count(*) filter (where day_pass) > 0
  order by 2 desc
$$;

-- 158_lead_sources_match_ghl_funnel.sql
--
-- Lead Sources rebuilt to reconcile with GHL's own pipeline board.
--
-- THREE THINGS WERE WRONG.
--
-- 1. stage_id IS THE CURRENT STAGE, NOT A HISTORY. Counting "tours" as
--    opportunities whose stage IS Tour Booked found almost nothing, because
--    anything that progressed to Trial Started no longer sits there. GHL's
--    funnel means REACHED AT LEAST that stage, which is derivable from stage
--    position: both membership pipelines run New Lead(0) -> Tour Booked(1) ->
--    Trial Started(2), so position >= 1 has reached a tour.
--
-- 2. THE UNIT IS THE OPPORTUNITY, NOT THE CONTACT, and the date is the
--    opportunity's rather than the contact's. GHL's board counts cards.
--
-- 3. NOT INTERESTED IS A WORKFLOW, NOT A TAG. The 'not interested' tag exists at
--    Eugene and nowhere else -- 34 contacts against ~3,800 who finished the
--    "Not Interested Categorization" workflow (migration 157). DND counts too.
--
-- Salem, 1-27 August: 148 leads and 56 signed against GHL's own 148 and 56.
-- Tours and trials land within one of GHL's 93 and 85, the difference being
-- opportunities that moved between the sync and the reading.
--
-- Scoped to the MEMBERSHIP pipelines. PT, Swim and VIP are separate funnels with
-- their own stages, and pooling them would reconcile with nothing.
--
-- The return type gains day_pass and drops nothing, so the old signature has to
-- go first: CREATE OR REPLACE cannot change a function's OUT columns.
drop function if exists public.analytics_lead_sources(date, date, text[], text);

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
  day_pass bigint,
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
        -- position >= 2 is Trial Started: an unattributed contact who reached a
        -- trial walked in. See migration 156.
        else public.analytics_lead_source_bucket(
          c.attribution_source, c.source, opp.position >= 2)
      end as src,
      -- Finished the workflow, or asked not to be contacted.
      (ni.contact_id is not null or coalesce(c.dnd, false)) as not_interested,
      ('guest' = any(c.tags) and not ('sale' = any(c.tags))) as day_pass
    from opp
    left join public.ghl_contacts_v2 c on c.id = opp.contact_id
    left join public.ghl_not_interested ni on ni.contact_id = opp.contact_id
  )
  select
    src,
    count(*),
    -- REACHED at least this stage, not currently sitting in it.
    count(*) filter (where position >= 1),
    count(*) filter (where position >= 2),
    count(*) filter (where status = 'won'),
    count(*) filter (where not_interested),
    count(*) filter (where day_pass),
    count(*) filter (where status in ('lost', 'abandoned'))
  from joined
  group by src
  order by 2 desc
$$;

-- 162_lead_outcomes_combined.sql
--
-- Two changes to Lead Sources.
--
-- 1. NOT INTERESTED AND DAY PASS BECOME ONE OUTCOME.
--
--    They were two columns. They are one idea -- "came to us and did not enter
--    the funnel" -- and both delete the opportunity in GHL, so they behaved
--    identically everywhere it mattered.
--
--    COMBINED WITH OR OVER DISTINCT CONTACTS, NEVER BY ADDING THE TWO COLUMNS.
--    A contact can be both: a day pass who was later marked not interested is
--    one person, and summing would count them twice. The old columns are kept
--    in the return type so the parts are still inspectable, but the report
--    reads the combined figure.
--
-- 2. CLAIMED COVERAGE IS MEASURED, NOT ASSERTED.
--
--    The report carried a hardcoded "about 42%". That number was an average
--    over a period in which the question did not exist, which made a working
--    field look broken:
--
--      Jan 2026   1.5%      May 2026  69.2%
--      Apr 2026   7.5%      Aug 2026  80.5%
--
--    Marketing Source became mandatory in MAY 2026. A window inside that era
--    has ~80% coverage; a window spanning it does not, and the report must say
--    which it is looking at rather than quoting a constant. Coverage is
--    computed over the same population the funnel draws, so the note describes
--    what is on screen.
--
--    Two real gaps survive that correction and are NOT artefacts:
--      - Milwaukie sits at 7.5% while every other club is 52-89%.
--      - Within one monthly cohort, contacts who JOINED carry the field about
--        15 points less often than trials do, which points at something on the
--        sale path clearing it.

drop function if exists public.analytics_lead_outcomes(date, date, text[], text);

create or replace function public.analytics_lead_outcomes(
  p_start date,
  p_end date,
  p_clubs text[] default null,
  p_attribution text default 'real'
)
returns table (
  source text,
  outcomes bigint,
  not_interested bigint,
  day_passes bigint
)
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
    -- OR, not a sum: one person who is both is one outcome.
    count(*) filter (where not_interested or day_pass),
    count(*) filter (where not_interested),
    count(*) filter (where day_pass)
  from c
  group by src
  having count(*) filter (where not_interested or day_pass) > 0
  order by 2 desc
$$;

-- Coverage of the claimed field over the funnel's own population.
create or replace function public.analytics_lead_claimed_coverage(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (total bigint, answered bigint)
language sql
stable
as $$
  select
    count(*),
    count(*) filter (
      where public.analytics_lead_claimed_source(c.custom_fields) <> 'Not Asked'
    )
  from public.ghl_opportunities_v2 o
  join public.ghl_locations l on l.id = o.location_id
  join public.ghl_pipelines p on p.id = o.pipeline_id
  join public.ghl_contacts_v2 c on c.id = o.contact_id
  where p.name in ('Membership Pipeline', 'Standard Member Pipeline')
    and o.created_at_ghl >= p_start
    and o.created_at_ghl < (p_end + 1)
    and (p_clubs is null or l.slug = any(p_clubs))
$$;

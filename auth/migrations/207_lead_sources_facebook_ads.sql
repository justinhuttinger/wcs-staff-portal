-- 207_lead_sources_facebook_ads.sql
--
-- Lead Sources: which Facebook campaigns, ad sets and ads the Facebook leads
-- came from, with the same funnel as the main report.
--
-- SAME POPULATION AS analytics_lead_sources. Opportunities in the membership
-- pipelines by the opportunity's date, stages "reached at least", and the
-- Facebook bucket from analytics_lead_source_bucket -- so the rows here add up
-- to the Facebook row on the main report, never to a different number.
--
-- THREE SHAPES OF FACEBOOK ATTRIBUTION, ONE SET OF LABELS.
--
--   Lead Form ads      GHL's integration fills adId, campaign, utmMedium (the
--                      ad set NAME) and utmContent (the ad NAME).
--   HighLevel template utm_medium={{adset.name}}, utm_content={{ad.name}} -- the
--                      same keys, so the same labels. Portal ads carry this
--                      from #992 on.
--   Meta's automatic   utm_medium=paid, utm_term={{adset.id}},
--   parameters         utm_content={{ad.id}}. Only ids exist, so ids are shown
--                      (the report cannot invent a name it was never sent).
--
-- A lead with nothing recorded at a level says so ("No ad recorded") rather
-- than disappearing, so the rows still sum to the Facebook total.

create or replace function public.analytics_lead_facebook_ads(
  p_start date,
  p_end date,
  p_clubs text[] default null
)
returns table (
  campaign text, adset text, ad text, ad_id text,
  leads bigint, tours bigint, trials bigint, won bigint, lost bigint
)
language sql
stable
as $$
  with opp as (
    select o.id, o.contact_id, o.status, s.position
    from public.ghl_opportunities_v2 o
    join public.ghl_locations l on l.id = o.location_id
    join public.ghl_pipelines p on p.id = o.pipeline_id
    join public.ghl_pipeline_stages s on s.id = o.stage_id
    where p.name in ('Membership Pipeline', 'Standard Member Pipeline')
      and o.created_at_ghl >= p_start and o.created_at_ghl < (p_end + 1)
      and (p_clubs is null or l.slug = any(p_clubs))
  ),
  fb as (
    select opp.*, c.attribution_source as a
    from opp
    left join public.ghl_contacts_v2 c on c.id = opp.contact_id
    where public.analytics_lead_source_bucket(
            c.attribution_source, c.source, opp.position >= 2) = 'Facebook'
  )
  select
    coalesce(nullif(a->>'campaign', ''), nullif(a->>'utmCampaign', ''), 'No campaign recorded'),
    case
      when a->>'utmMedium' = 'paid' and a->>'utmTerm' ~ '^\d{10,}$' then a->>'utmTerm'
      else coalesce(nullif(a->>'utmMedium', ''), 'No ad set recorded')
    end,
    coalesce(nullif(a->>'utmContent', ''), a->>'adId', 'No ad recorded'),
    coalesce(a->>'adId', case when a->>'utmContent' ~ '^\d{10,}$' then a->>'utmContent' end),
    count(*),
    count(*) filter (where position >= 1),
    count(*) filter (where position >= 2),
    count(*) filter (where status = 'won'),
    count(*) filter (where status in ('lost', 'abandoned'))
  from fb
  group by 1, 2, 3, 4
  order by 5 desc
$$;

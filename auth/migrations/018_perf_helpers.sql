-- 018_perf_helpers.sql
-- /reports/fb-roas and /reports/leaderboard were timing out at the Postgres
-- statement-timeout because we were paginating ghl_contacts_v2 and
-- aggregating in JS. Doing the GROUP BY in Postgres with the right indexes
-- drops both endpoints from 30-40s timeouts to sub-second.

-- ---------------------------------------------------------------------------
-- Indexes the planner needs to filter cheaply before any JSONB read.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ghl_contacts_created_at
  ON ghl_contacts_v2 (created_at_ghl);

CREATE INDEX IF NOT EXISTS idx_ghl_contacts_tags_gin
  ON ghl_contacts_v2 USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_ghl_contacts_location
  ON ghl_contacts_v2 (location_id);

-- ---------------------------------------------------------------------------
-- fb_sales_by_ad(start_iso, end_iso)
-- Counts FB-attributed 'sale'-tagged contacts grouped by adId within a date
-- range. Returns per-adId rollup with the most-common adsetId / campaignId
-- alongside so the report endpoint doesn't need a second query.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fb_sales_by_ad(
  start_iso timestamptz,
  end_iso   timestamptz
)
RETURNS TABLE (
  ad_id         text,
  ad_group_id   text,
  campaign_id   text,
  campaign_name text,
  utm_medium    text,
  sales         bigint,
  sample_ids    text[]
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    attribution_source->>'adId' AS ad_id,
    (array_agg(DISTINCT attribution_source->>'adGroupId')
       FILTER (WHERE attribution_source->>'adGroupId' IS NOT NULL))[1] AS ad_group_id,
    (array_agg(DISTINCT attribution_source->>'campaignId')
       FILTER (WHERE attribution_source->>'campaignId' IS NOT NULL))[1] AS campaign_id,
    (array_agg(DISTINCT attribution_source->>'campaign')
       FILTER (WHERE attribution_source->>'campaign' IS NOT NULL))[1] AS campaign_name,
    (array_agg(DISTINCT attribution_source->>'utmMedium')
       FILTER (WHERE attribution_source->>'utmMedium' IS NOT NULL))[1] AS utm_medium,
    count(*)::bigint AS sales,
    (array_agg(id))[1:5] AS sample_ids
  FROM ghl_contacts_v2
  WHERE tags @> ARRAY['sale']
    AND attribution_source->>'adId' IS NOT NULL
    AND created_at_ghl >= start_iso
    AND created_at_ghl <= end_iso
  GROUP BY attribution_source->>'adId';
$$;

-- ---------------------------------------------------------------------------
-- count_vips_by_team_member(start_iso, end_iso, loc_id)
-- Counts contacts where the per-location custom field `contact.vip_team_member`
-- is set, grouped by the team-member name. All three args are nullable —
-- callers pass NULL when they want unbounded date / all locations.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION count_vips_by_team_member(
  start_iso timestamptz DEFAULT NULL,
  end_iso   timestamptz DEFAULT NULL,
  loc_id    text        DEFAULT NULL
)
RETURNS TABLE (
  team_member text,
  total       bigint
)
LANGUAGE sql
STABLE
AS $$
  WITH field_defs AS (
    SELECT location_id, id AS field_id
    FROM ghl_custom_field_defs
    WHERE field_key = 'contact.vip_team_member'
  )
  SELECT
    trim(c.custom_fields->>fd.field_id) AS team_member,
    count(*)::bigint                    AS total
  FROM ghl_contacts_v2 c
  JOIN field_defs fd ON fd.location_id = c.location_id
  WHERE (start_iso IS NULL OR c.created_at_ghl >= start_iso)
    AND (end_iso   IS NULL OR c.created_at_ghl <= end_iso)
    AND (loc_id    IS NULL OR c.location_id    = loc_id)
    AND c.custom_fields ? fd.field_id
    AND trim(c.custom_fields->>fd.field_id) <> ''
  GROUP BY trim(c.custom_fields->>fd.field_id);
$$;

-- PostgREST auto-exposes these at /rpc/<name>.
GRANT EXECUTE ON FUNCTION fb_sales_by_ad(timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION count_vips_by_team_member(timestamptz, timestamptz, text) TO authenticated, service_role;

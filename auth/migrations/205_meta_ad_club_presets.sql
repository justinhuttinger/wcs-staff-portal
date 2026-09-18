-- Per-club defaults for the multi-club ad launch (Ads Manager).
--
-- A launch writes the same ad set and ads into every selected club, so each
-- club needs its own Page, geo targeting, destination and token values. Those
-- change rarely, so they are stored once here rather than retyped per launch.
--
-- No Meta ad data is stored — only ids and settings an admin chose. The portal
-- DB is service-role only, so no RLS policies (see the portal's other tables).
create table if not exists meta_ad_club_presets (
  location_id    uuid primary key references locations(id) on delete cascade,
  campaign_id    text,               -- default target campaign for this club
  page_id        text,               -- Facebook Page the ads post as
  instagram_id   text,               -- IG account linked to that Page, if any
  link           text,               -- destination URL for link ads
  lead_form_id   text,               -- Instant Form on that Page, if used
  targeting      jsonb not null default '{}'::jsonb,  -- geo (+ radius) for this club
  tokens         jsonb not null default '{}'::jsonb,  -- {{club}} and friends
  updated_at     timestamptz not null default now(),
  updated_by     uuid references staff(id) on delete set null
);

comment on table meta_ad_club_presets is
  'Per-club Meta Ads defaults (Page, geo, link, form, token values) for multi-club launches.';

-- 223: Meta Instant Form leads (ghl-sync src/meta/leadSync.js).
--
-- Every lead from the Instant Forms our ads use, pulled from Meta's API
-- (needs leads_retrieval on the WCS Portal system user). Its reason to exist
-- is lead_id: ghl-sync's Meta Purchase (metaPurchase.js) looks up the join's
-- email / phone here and sends the lead id with the sale, which is the one
-- match key Meta ties straight back to the Instant Form lead and its ad.
--
-- GHL can't supply it: its Facebook integration keeps the ad and the form,
-- never the lead. Written by ghl-sync's service role only.

create table if not exists public.meta_leads (
  lead_id       text        primary key,
  form_id       text        not null,
  page_id       text,
  ad_id         text,
  campaign_id   text,
  created_time  timestamptz not null,
  email         text,                     -- lowercased
  phone         text,                     -- last 10 digits
  first_name    text,
  last_name     text,
  synced_at     timestamptz not null default now()
);

create index if not exists meta_leads_email on public.meta_leads (email) where email is not null;
create index if not exists meta_leads_phone on public.meta_leads (phone) where phone is not null;
create index if not exists meta_leads_form_time on public.meta_leads (form_id, created_time desc);

-- Service role only (portal-wide convention): RLS on, no policies.
alter table public.meta_leads enable row level security;

notify pgrst, 'reload schema';

-- 228: log of front-desk call button pages.
--
-- A member presses the wireless "press for staff" button, and WCS ABC on the
-- club's pager PC rings the DECT handsets through the phone base. Each press
-- (and each Admin test page) is reported after the fact to
-- POST /telephony/page-events (routes/telephony.js) and stored here. The API
-- is never in the paging path. Written by the auth API's service role only.

create table if not exists public.page_events (
  id            uuid primary key default gen_random_uuid(),
  club_number   text not null,              -- ABC club number of the pager PC
  occurred_at   timestamptz not null,       -- when the button was pressed (PC clock)
  source        text not null check (source in ('button', 'test')),
  action        text not null,              -- button action, e.g. 'single'
  targets       int[] not null default '{}',-- handsets asked to ring
  results       jsonb not null default '[]',-- [{ handset, ok, latencyMs, error }]
  result        text not null check (result in ('ok', 'partial', 'failed', 'suppressed')),
  button_ieee   text,                       -- Zigbee address of the button pressed
  button_name   text,                       -- its name in WCS ABC Admin
  battery       int,                        -- button battery %, when known
  linkquality   int,                        -- Zigbee signal 0-255, when known
  created_at    timestamptz not null default now()
);

-- "Pages at this club, most recent first."
create index if not exists page_events_club_time
  on public.page_events (club_number, occurred_at desc);

-- Service role only (portal-wide convention): RLS on, no policies.
alter table public.page_events enable row level security;

notify pgrst, 'reload schema';

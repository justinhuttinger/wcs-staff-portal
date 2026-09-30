-- 220: Meta Conversions API send log (ghl-sync src/abc/metaPurchase.js).
--
-- One row per server-side event sent to Meta, keyed on the same event_id Meta
-- dedupes on. For Purchase that is purchase_{member_id}_{agreement_number}, so
-- a new join is sent once, a failed send is retried on the next ABC sync cycle
-- (up to 5 attempts), and "did Meta get this sale" is a query, not a log dig.
-- Written by ghl-sync's service role only.

create table if not exists public.meta_capi_events (
  event_id       text        primary key,
  event_name     text        not null,          -- 'Purchase'
  club_number    text,
  abc_member_id  text,
  ghl_contact_id text,
  value          numeric,
  action_source  text,                          -- physical_store | system_generated
  event_time     timestamptz,                   -- what Meta was told
  match          text,                          -- "em=y ph=y fn=y ... fbc=n xid=n"
  attempts       integer     not null default 1,
  status         text        not null,          -- sent | failed
  error          text,
  meta_response  jsonb,
  attempted_at   timestamptz not null default now()
);

-- "What went to Meta lately", per club.
create index if not exists meta_capi_events_club_time
  on public.meta_capi_events (club_number, attempted_at desc);

-- Service role only (portal-wide convention): RLS on, no policies.
alter table public.meta_capi_events enable row level security;

notify pgrst, 'reload schema';

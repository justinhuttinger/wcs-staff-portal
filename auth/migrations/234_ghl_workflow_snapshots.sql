-- 234: GHL workflow snapshots. The Workflow Transfer tool (Marketing folder,
-- owner only) saves the target workflow here before it overwrites it, so any
-- push can be rolled back from the portal. A row is the workflow definition
-- plus its triggers exactly as GHL returned them.
--
-- Service role only (RLS on, no policies), like the rest of the portal DB.

create table if not exists public.ghl_workflow_snapshots (
  id               uuid primary key default gen_random_uuid(),
  location_id      text not null,
  club_slug        text not null,
  workflow_id      text not null,
  workflow_name    text not null default '',
  reason           text not null default 'pre_overwrite' check (reason in ('pre_overwrite', 'manual')),
  payload          jsonb not null,
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz not null default now()
);

create index if not exists ghl_workflow_snapshots_wf_idx
  on public.ghl_workflow_snapshots (location_id, workflow_id, created_at desc);
create index if not exists ghl_workflow_snapshots_created_idx
  on public.ghl_workflow_snapshots (created_at desc);

alter table public.ghl_workflow_snapshots enable row level security;

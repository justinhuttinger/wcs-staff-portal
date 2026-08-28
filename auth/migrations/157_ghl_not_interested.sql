-- 157_ghl_not_interested.sql
--
-- Contacts who finished the "Not Interested Categorization" workflow.
--
-- NOT A TAG. The first version of Lead Sources counted the 'not interested' tag
-- and found 34 contacts; the workflow has ~3,800. The tag is applied at one club
-- (Eugene) and nowhere else, so reading it as the signal understated
-- not-interested by roughly a hundredfold.
--
-- Workflow membership is in no sync and cannot be read on a report load: it is a
-- paginated POST per club against contacts/search using the UNDOCUMENTED
-- finishedWorkflows filter. So it is synced into this table and the report reads
-- the table. See auth/src/services/ghlNotInterestedSync.js.
--
-- Medford has no such workflow at all. That is recorded as a per-club sync state
-- rather than inferred from an empty result, because "nobody was marked not
-- interested" and "there is nothing here to mark them with" are different facts
-- and only one of them is about the staff.
create table if not exists public.ghl_not_interested (
  contact_id    text primary key,
  location_id   text not null,
  location_slug text,
  workflow_id   text not null,
  synced_at     timestamptz not null default now()
);

create index if not exists idx_ghl_not_interested_slug
  on public.ghl_not_interested (location_slug);

-- One row per club per run, so the report can tell "no workflow", "sync failed"
-- and "genuinely nobody" apart.
create table if not exists public.ghl_not_interested_sync (
  location_slug text primary key,
  workflow_id   text,
  workflow_name text,
  contacts      integer not null default 0,
  status        text not null,          -- ok | no_workflow | failed
  error         text,
  ran_at        timestamptz not null default now()
);

comment on table public.ghl_not_interested is
  'Contacts who FINISHED the Not Interested Categorization workflow in GHL. Synced from contacts/search with the undocumented finishedWorkflows filter; not derivable from any tag.';

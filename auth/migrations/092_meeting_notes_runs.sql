-- Idempotency + audit log for the meeting-notes job.
--
-- The job polls ClickUp hourly and must process each meeting Doc exactly once.
-- One row per ClickUp doc id records what was produced (notes Doc, prep Doc,
-- the calendar events they were attached to) and the run status, so a re-poll
-- skips already-done docs and a failed run can be retried.

create table if not exists meeting_notes_runs (
  clickup_doc_id      text primary key,
  meeting             text not null,
  meeting_date        date not null,
  status              text not null default 'pending',  -- pending|done|failed|skipped
  notes_doc_id        text,
  notes_doc_url       text,
  notes_event_id      text,
  prep_doc_id         text,
  prep_doc_url        text,
  prep_event_id       text,
  error               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table meeting_notes_runs is
  'One row per processed ClickUp notetaker Doc. Idempotency key for the meeting-notes job; see migration 092.';

create index if not exists meeting_notes_runs_meeting_date_idx
  on meeting_notes_runs (meeting, meeting_date desc);

-- Service-role only DB (portal convention: RLS on, no policy). See migr035.
alter table meeting_notes_runs enable row level security;

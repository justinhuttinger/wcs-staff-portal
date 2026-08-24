-- 116_operandio_meeting_goals.sql
-- Weekly meeting action plans (MC / PT Weekly Meeting) carried into each club's
-- Operandio knowledge article.
--
-- Supabase is the source of truth: the article is a pure render of the last N
-- weeks of these rows. The knowledge(id){update} mutation creates no version,
-- so there is no API-side undo — an article can only be rebuilt from here.

create table if not exists operandio_goal_entries (
  -- Operandio job instance id (operandio_api_jobs.id). Primary key so the
  -- 15-minute sync re-reading the same job is idempotent for free.
  job_id          text primary key,
  location_slug   text not null,
  kind            text not null check (kind in ('MC', 'PT')),
  job_date        date not null,
  week_start      date not null,          -- Monday on-or-before job_date
  submitted_at    timestamptz,
  submitted_by    text,
  -- Ordered array of non-empty, trimmed action plan strings. May be empty:
  -- a submission with nothing filled in is still evidence the meeting ran,
  -- but it is not rendered into the article.
  action_plans    jsonb not null default '[]'::jsonb,
  synced_at       timestamptz not null default now()
);

-- The render query: newest weeks first for one article.
create index if not exists operandio_goal_entries_article_idx
  on operandio_goal_entries (kind, location_slug, week_start desc);

create table if not exists operandio_goal_articles (
  kind               text not null check (kind in ('MC', 'PT')),
  location_slug      text not null,
  -- Resolved by exact title from Operandio and cached here. Title stays the
  -- authority; a mismatch on read-back re-resolves.
  article_id         text,
  article_title      text not null,
  -- sha256 of the last successfully published doc. Stops all 14 articles being
  -- rewritten every 15 minutes when nothing has changed.
  last_rendered_hash text,
  last_published_at  timestamptz,
  last_error         text,
  primary key (kind, location_slug)
);

-- Service-role only, matching every other table in this database.
alter table operandio_goal_entries  enable row level security;
alter table operandio_goal_articles enable row level security;

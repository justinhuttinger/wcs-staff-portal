-- NPS / member feedback system.
--
-- Two intake paths write into the same tables:
--   * invited  — a nightly ghl-sync job creates an nps_invites row per member
--                who hits a lifecycle milestone, tags them in GHL, and a GHL
--                workflow emails the tokenised link.
--   * walkup   — a QR poster in club, no invite and no member identity.
--
-- Trigger rules are DATA on nps_surveys, not code, so adding a "3 year" survey
-- is an admin action rather than a deploy.

create table if not exists nps_surveys (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text not null unique,
  title                text not null,
  intro                text,
  -- Ordered question list. Validated by auth/src/services/npsSchema.js.
  schema               jsonb not null default '[]'::jsonb,
  status               text not null default 'draft'
                         check (status in ('draft', 'active', 'paused')),
  trigger_type         text not null
                         check (trigger_type in ('tenure_days', 'tenure_months', 'status_change', 'walkup')),
  -- 30 for day-30, 6/12/24 for month anniversaries. Null for status_change/walkup.
  trigger_value        int,
  -- e.g. 'Cancelled'. Only meaningful for trigger_type = 'status_change'.
  trigger_status       text,
  -- Optional narrowing, e.g. {"club_numbers": ["30935"]}.
  audience_filter      jsonb not null default '{}'::jsonb,
  -- How many days back the nightly job re-checks, so one missed night self-heals.
  send_window_days     int  not null default 3,
  -- Global per-member suppression across ALL surveys, not just this one.
  resend_cooldown_days int  not null default 60,
  ghl_tag              text,
  ghl_field_key        text,
  expires_days         int  not null default 30,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table nps_surveys is
  'Survey definitions. The trigger rule lives here as data so new surveys need no deploy.';

create table if not exists nps_metrics (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  label       text not null,
  description text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Exists so metric_key is a PICKED value, never free text. 'cleanliness' in the
-- 6-month survey and 'cleanliness' in the 2-year survey must be the same string
-- to roll up together; a typo would silently split one metric into two
-- half-populated ones and nothing in the report would reveal it.
comment on table nps_metrics is
  'Controlled vocabulary for rating question metric_key values.';

create table if not exists nps_invites (
  id                  uuid primary key default gen_random_uuid(),
  survey_id           uuid not null references nps_surveys(id) on delete cascade,
  token               text not null unique,
  member_id           text not null,
  club_number         text not null,
  ghl_contact_id      text,
  -- Snapshots: the member may cancel, change email, or change name between the
  -- invite being created and the survey being answered.
  member_email        text not null,
  member_name         text,
  tenure_days         int,
  -- The date the trigger rule matched (begin_date + 30, the anniversary, or
  -- the cancellation date). Part of the idempotency key.
  trigger_date        date not null,
  status              text not null default 'pending'
                        check (status in ('pending', 'sent', 'opened', 'responded', 'failed', 'expired')),
  sent_at             timestamptz,
  ghl_tag_applied_at  timestamptz,
  ghl_error           text,
  opened_at           timestamptz,
  responded_at        timestamptz,
  expires_at          timestamptz,
  dry_run             boolean not null default false,
  created_at          timestamptz not null default now()
);

-- THE idempotency guard. A job rerun, an overlapping cron tick, or a replayed
-- back-window cannot produce a second invite for the same member+milestone.
create unique index if not exists nps_invites_survey_member_date_idx
  on nps_invites (survey_id, member_id, trigger_date);

-- The cooldown lookup is "any invite for these members since date X".
create index if not exists nps_invites_member_created_idx
  on nps_invites (member_id, created_at desc);

create index if not exists nps_invites_token_idx on nps_invites (token);

create table if not exists nps_responses (
  id            uuid primary key default gen_random_uuid(),
  -- Null for walk-up. Postgres allows many NULLs under a unique constraint, so
  -- this still guarantees one response per invite while allowing unlimited
  -- anonymous walk-up rows.
  invite_id     uuid unique references nps_invites(id) on delete set null,
  survey_id     uuid not null references nps_surveys(id) on delete cascade,
  member_id     text,
  club_number   text,
  source        text not null check (source in ('invited', 'walkup')),
  -- Denormalised from the 'nps' typed question for report speed.
  nps_score     int check (nps_score between 0 and 10),
  answers       jsonb not null default '{}'::jsonb,
  contact_name  text,
  contact_email text,
  ip_hash       text,
  user_agent    text,
  submitted_at  timestamptz not null default now()
);

create index if not exists nps_responses_survey_time_idx
  on nps_responses (survey_id, submitted_at desc);

create table if not exists nps_response_scores (
  id           uuid primary key default gen_random_uuid(),
  response_id  uuid not null references nps_responses(id) on delete cascade,
  survey_id    uuid not null references nps_surveys(id) on delete cascade,
  metric_key   text not null,
  score        int  not null,
  -- club_number, source and submitted_at are denormalised deliberately: it keeps
  -- every report query a single indexed scan with no joins, and all three are
  -- immutable once a response is submitted.
  club_number  text,
  source       text not null,
  submitted_at timestamptz not null
);

create index if not exists nps_response_scores_metric_club_time_idx
  on nps_response_scores (metric_key, club_number, submitted_at desc);

create table if not exists nps_club_qr (
  id          uuid primary key default gen_random_uuid(),
  club_number text not null,
  -- Opaque. Using the raw club number would let anyone edit the URL and dump
  -- one club's scores onto another's report. Rotatable because posters hang in
  -- public and a photographed URL cannot be un-shared.
  key         text not null unique,
  survey_id   uuid not null references nps_surveys(id) on delete cascade,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  rotated_at  timestamptz
);

create index if not exists nps_club_qr_key_idx on nps_club_qr (key) where active;

-- Portal DB is service-role only: enable RLS with no policy on every table.
alter table nps_surveys         enable row level security;
alter table nps_metrics         enable row level security;
alter table nps_invites         enable row level security;
alter table nps_responses       enable row level security;
alter table nps_response_scores enable row level security;
alter table nps_club_qr         enable row level security;

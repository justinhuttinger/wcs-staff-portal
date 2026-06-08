-- 030_operandio_job_events.sql
-- Phase 2 of Operandio reporting: per-job submission + overdue tracking.
--
-- Until now only daily/weekly location summaries (operandio_location_reports)
-- and scored audits (operandio_qa_reports) were parsed. Individual checklist
-- submissions and overdue notices were stashed raw in operandio_raw_emails.
-- This migration adds the two tables the webhook now parses those into, so the
-- Operational Compliance report can answer: who is doing the jobs, and what is
-- not getting done.
--
--   operandio_job_events      — one row per job instance occurrence
--                               (a submission OR an overdue notice)
--   operandio_task_completions — one row per task line inside a submission
--                               (task name, who completed it, when, status)
--
-- "Late" is NOT stored: it is derived at query time as a (location, job_name,
-- job_date) that has BOTH a 'submitted' and an 'overdue' event.

CREATE TABLE IF NOT EXISTS operandio_job_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_slug   text NOT NULL,
  job_name        text NOT NULL,           -- full name incl. schedule parenthetical
  event_type      text NOT NULL,           -- 'submitted' | 'overdue'
  job_date        date NOT NULL,           -- club-local (Pacific) date the job belongs to
  occurred_at     timestamptz,             -- when the email was received
  due_by          timestamptz,             -- overdue only
  steps_completed integer,                 -- submitted: # done; overdue: X of "X / Y"
  steps_total     integer,                 -- # of steps / tasks
  percent         integer,                 -- 0-100
  assigned_area   text,                    -- overdue only ("Front Desk", "multiple areas")
  submitted_by    text,                    -- submission headline completer (most rows)
  raw_email_id    uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- One submission and one overdue per job/location/day. SendGrid retries and
  -- repeat overdue reminders collapse onto the same row (latest wins on upsert).
  UNIQUE (location_slug, job_name, job_date, event_type)
);

CREATE INDEX IF NOT EXISTS idx_operandio_job_events_lookup
  ON operandio_job_events (location_slug, job_date, event_type);
CREATE INDEX IF NOT EXISTS idx_operandio_job_events_date
  ON operandio_job_events (job_date DESC);
CREATE INDEX IF NOT EXISTS idx_operandio_job_events_person
  ON operandio_job_events (submitted_by);

CREATE TABLE IF NOT EXISTS operandio_task_completions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_event_id  uuid NOT NULL REFERENCES operandio_job_events(id) ON DELETE CASCADE,
  location_slug text NOT NULL,
  job_name      text NOT NULL,
  job_date      date NOT NULL,
  step_n        integer,
  task_name     text NOT NULL,
  completed_by  text,                      -- person name (Operandio name, not portal staff)
  completed_at  timestamptz,
  status        text NOT NULL DEFAULT 'done', -- 'done' | 'skipped' | 'value'
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operandio_task_completions_event
  ON operandio_task_completions (job_event_id);
CREATE INDEX IF NOT EXISTS idx_operandio_task_completions_person
  ON operandio_task_completions (completed_by, job_date);
CREATE INDEX IF NOT EXISTS idx_operandio_task_completions_lookup
  ON operandio_task_completions (location_slug, job_date);

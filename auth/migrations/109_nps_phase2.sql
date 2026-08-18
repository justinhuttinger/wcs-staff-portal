-- NPS phase 2a: the metric vocabulary, test isolation, and the indexes the
-- report needs.

-- The controlled vocabulary every rating question points at. Deliberately
-- small: five metrics with full history beat twelve each answered by a
-- fraction of people. Adding one later is free; removing one is not.
insert into nps_metrics (key, label) values
  ('nps',              'Likelihood to recommend'),
  ('cleanliness',      'Cleanliness of the gym'),
  ('staff_positivity', 'Staff friendliness and helpfulness'),
  ('equipment',        'Equipment condition and availability'),
  ('value',            'Value for money')
on conflict (key) do nothing;

-- Manual test fires write real rows through the real code path. They must be
-- excludable everywhere the report reads, which includes nps_response_scores
-- directly — hence the denormalised copy, alongside the club_number/source/
-- submitted_at that are already denormalised there for the same reason.
alter table nps_invites         add column if not exists is_test boolean not null default false;
alter table nps_responses       add column if not exists is_test boolean not null default false;
alter table nps_response_scores add column if not exists is_test boolean not null default false;

-- The idempotency guard becomes partial so a test fire can repeat.
--
-- Real invites keep the guarantee that a job rerun, an overlapping cron tick or
-- a replayed back-window cannot double-send. Test rows are exempt BY
-- CONSTRUCTION rather than by a code path that has to remember to skip the
-- check, which is the version that rots.
drop index if exists nps_invites_survey_member_date_idx;
create unique index nps_invites_survey_member_date_idx
  on nps_invites (survey_id, member_id, trigger_date)
  where not is_test;

-- Serves "what do cancelling members think versus six-month members": the
-- report segments by survey. The existing (metric_key, club_number,
-- submitted_at desc) index serves the by-club view and stays.
create index if not exists nps_response_scores_survey_metric_time_idx
  on nps_response_scores (survey_id, metric_key, submitted_at desc);

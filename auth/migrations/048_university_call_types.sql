-- 048_university_call_types.sql
--
-- WCS University: add the call_type dimension + lead_source persona color, and
-- migrate the competency milestones from difficulty-keyed (roleplay_easy/medium/
-- hard) to call-type-keyed (roleplay_cold_lead / roleplay_mid_trial /
-- roleplay_winback / roleplay_new_member).
--
-- call_type is the situation the trainee calls into (cold lead, mid-trial
-- check-in, expired-trial winback, new-member onboarding). It changes the
-- lead's mindset, the rep's goal, and the grading rubric. difficulty stays as
-- persona resistance; lead_source (facebook/instagram/snapchat/...) is color.
--
-- This migration is idempotent.

BEGIN;

ALTER TABLE roleplay_sessions
  ADD COLUMN IF NOT EXISTS call_type   text NOT NULL DEFAULT 'cold_lead',
  ADD COLUMN IF NOT EXISTS lead_source text;

COMMENT ON COLUMN roleplay_sessions.call_type IS 'cold_lead | mid_trial | expired_trial | new_member — drives situation, rep goal, and grading rubric.';
COMMENT ON COLUMN roleplay_sessions.lead_source IS 'Persona color: facebook | instagram | snapchat | google | referral | walk_in.';

-- Replace the milestone config with call-type-keyed competencies. The single
-- row (id=true) is overwritten wholesale; the touch trigger stamps updated_at.
UPDATE milestone_config SET config = '{
  "pass_threshold_default": 80,
  "milestones": [
    { "key": "mod1",               "type": "curriculum", "required": true },
    { "key": "first_call_made",    "type": "curriculum", "required": true },
    { "key": "roleplay_cold_lead", "type": "competency", "required": true, "pass_threshold": 80 },
    { "key": "roleplay_mid_trial", "type": "competency", "required": true, "pass_threshold": 80 },
    { "key": "roleplay_winback",   "type": "competency", "required": true, "pass_threshold": 80 },
    { "key": "roleplay_new_member","type": "competency", "required": true, "pass_threshold": 80 },
    { "key": "objection_handling", "type": "competency", "required": true, "pass_threshold": 80 }
  ]
}'::jsonb
WHERE id = true;

COMMIT;

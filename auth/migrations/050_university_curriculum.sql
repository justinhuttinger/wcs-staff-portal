-- 050_university_curriculum.sql
--
-- WCS University guided course. Turns the flat milestone checklist into a
-- step-by-step training walkthrough: the trainee advances through ordered steps
-- (explore the platform, book an appointment, read scripts, find call lists,
-- learn grading, then graded practice calls), and graduates when done.
--
-- Step completion varies by type:
--   explore / info     -> trainee clicks Next (self-attested)
--   action_webhook     -> a GHL automation fires /progress/event (awards points)
--   graded_call        -> a graded practice call scoring >= pass_threshold (80)
--   graduation         -> auto when all prior steps are done; keep practicing after
--
-- university_curriculum is a single-row JSONB config (editable without redeploy,
-- like milestone_config). trainee_progress is per-trainee state, keyed by email.
--
-- Service-role-only (RLS on, no policy) per migration 035. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS university_curriculum (
  id          boolean PRIMARY KEY DEFAULT true,
  config      jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  CONSTRAINT university_curriculum_singleton CHECK (id = true)
);

DROP TRIGGER IF EXISTS trg_university_curriculum_updated_at ON university_curriculum;
CREATE TRIGGER trg_university_curriculum_updated_at
  BEFORE UPDATE ON university_curriculum
  FOR EACH ROW EXECUTE FUNCTION university_touch_updated_at();

CREATE TABLE IF NOT EXISTS trainee_progress (
  trainee_id      text PRIMARY KEY,             -- trainee email
  trainee_name    text,
  completed_steps jsonb NOT NULL DEFAULT '[]',  -- [{key, at, points, session_id?}]
  points          int NOT NULL DEFAULT 0,
  graduated       boolean NOT NULL DEFAULT false,
  graduated_at    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_trainee_progress_updated_at ON trainee_progress;
CREATE TRIGGER trg_trainee_progress_updated_at
  BEFORE UPDATE ON trainee_progress
  FOR EACH ROW EXECUTE FUNCTION university_touch_updated_at();

-- Seed the drafted course (Justin edits after publish). graded_call steps pass
-- at 80. event_key on the appointment step matches the GHL automation webhook.
INSERT INTO university_curriculum (id, config) VALUES (true, '{
  "pass_threshold": 80,
  "steps": [
    { "key": "explore", "type": "explore", "points": 10,
      "title": "Get the lay of the land",
      "body": "Before any calls, get familiar with your workspace. Click through your <b>Dashboard</b>, <b>Contacts</b>, <b>Calendar</b>, and <b>Conversations</b> so you know where everything lives. When you have looked around, come back here and hit <b>Next</b>." },
    { "key": "book_appt", "type": "action_webhook", "event_key": "appointment_made", "points": 25,
      "title": "Book your first appointment",
      "body": "Go to the calendar and book a practice appointment for the assigned contact. We will detect it automatically and award your points. (If it does not register, you can mark it done to continue.)" },
    { "key": "scripts", "type": "info", "points": 10,
      "title": "Know your scripts",
      "body": "Review the core call scripts below. More scripts live in the shared Scripts folder. You do not need to memorize them, but know where they are and the flow: open, discover, handle the objection, ask for the booking." },
    { "key": "call_lists", "type": "explore", "points": 10,
      "title": "Find your call list",
      "body": "Your daily call lists live under <b>Manual Actions</b>. Go find them now so you know where to pull leads from. Hit <b>Next</b> when you have located your list." },
    { "key": "grading", "type": "info", "points": 10,
      "title": "How your calls are graded",
      "body": "Every practice call is scored 0-100 on the rep''s performance only: rapport, discovery, objection handling, asking for the commitment, and how far you moved the lead. You need <b>80</b> to clear a graded step. You are encouraged to call as many times as you want, your best score counts." },
    { "key": "call_1", "type": "graded_call", "pass_threshold": 80, "points": 30,
      "title": "Practice call 1: warm lead",
      "body": "Time to call. Dial the practice line and run a real call with the prospect. Score <b>80 or higher</b> to advance. Did not hit it? Call again, you get unlimited attempts and your best score counts.",
      "next_hint": "Nice work. Next up: a tougher lead." },
    { "key": "call_2", "type": "graded_call", "pass_threshold": 80, "points": 30,
      "title": "Practice call 2",
      "body": "Make another practice call. Same bar: score <b>80+</b> to advance. Bring everything from call 1 plus a cleaner ask for the booking.",
      "next_hint": "Strong. One more to graduate." },
    { "key": "call_3", "type": "graded_call", "pass_threshold": 80, "points": 30,
      "title": "Practice call 3: graduation call",
      "body": "Last graded call. Score <b>80+</b> to graduate. Treat it like a real prospect, start to finish.",
      "next_hint": "" },
    { "key": "graduation", "type": "graduation", "points": 0,
      "title": "You graduated",
      "body": "You have completed WCS University. You are cleared to take live calls. Keep practicing any time, every call is still scored and saved so you can keep sharpening." }
  ]
}'::jsonb)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE university_curriculum ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainee_progress     ENABLE ROW LEVEL SECURITY;

COMMIT;

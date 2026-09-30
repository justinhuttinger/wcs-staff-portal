-- 218: WCS Save follow-up questions per cancel reason.
--
-- save_reasons.questions: what the member is asked after picking the reason,
--   e.g. "Too expensive" -> "What monthly price would have worked for you?".
--   [{ "id": "<uuid>", "label": "...", "required": true|false }, ...]
--   Free-text answers. Edited in Admin -> Save Offers -> Reasons; validated by
--   validateReason (services/saveOffersSchema.js). At most 5 per reason.
--
-- save_requests.reason_answers: what the member wrote, with the question text
--   as it read at the time (so editing a question later doesn't rewrite
--   history). [{ "id": "<question id>", "question": "...", "answer": "..." }]
--
-- The wcs-save Worker tolerates this migration being unapplied: it reads
-- questions only if the column exists and only writes answers when a reason
-- has questions.
alter table save_reasons
  add column if not exists questions jsonb not null default '[]'::jsonb;

alter table save_requests
  add column if not exists reason_answers jsonb;

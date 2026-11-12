-- A club can show only its own notes in the memo, never Main. Used for a club whose
-- front desk needs its own sheet instead of the company memo. Off for every club
-- unless set. Service role only. Idempotent: safe to re-run.

alter table memo_clubs add column if not exists notes_only boolean not null default false;

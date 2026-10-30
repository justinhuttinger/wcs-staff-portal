-- Sends each club's live memo to its iPad lock screens. club_memo_images holds the
-- image drawn when a memo is published or edited. memo_clubs records where each
-- club's image goes and what was last sent. The target is empty until set, so
-- nothing is sent for a club until someone sets it. normal_image_* is the club's
-- own lock screen image, saved before the first memo replaces it and put back
-- when a memo ends with nothing after it. Service role only.
-- Idempotent: safe to re-run.

create table if not exists club_memo_images (
  club_memo_id uuid primary key references club_memos(id) on delete cascade,
  image_base64 text not null,
  md5 text not null,
  updated_at timestamptz not null default now()
);
alter table club_memo_images enable row level security;

alter table memo_clubs add column if not exists ipad_target text;
alter table memo_clubs add column if not exists ipad_status text;
alter table memo_clubs add column if not exists ipad_error text;
alter table memo_clubs add column if not exists ipad_pushed_md5 text;
alter table memo_clubs add column if not exists ipad_pushed_at timestamptz;
alter table memo_clubs add column if not exists ipad_failed_md5 text;
alter table memo_clubs add column if not exists normal_saved_at timestamptz;
alter table memo_clubs add column if not exists normal_image_base64 text;
alter table memo_clubs add column if not exists normal_image_md5 text;

notify pgrst, 'reload schema';

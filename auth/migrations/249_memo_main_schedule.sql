-- Main gets its own show dates and goes live at every club by itself. Club notes
-- become separate: each set has its own dates and can run across months. An iPad
-- image now belongs to a combination of Main and notes (composition_key), so a date
-- can change what's on the iPads with nobody around. club_memo_images stays until
-- this has settled, for the code running during the deploy. Service role only.
-- Idempotent: safe to re-run.

alter table memo_editions add column if not exists starts_at timestamptz;
alter table memo_editions add column if not exists ends_at timestamptz;

update memo_editions e
set starts_at = least(
  e.ready_at,
  (select min(m.starts_at) from club_memos m where m.edition_id = e.id and m.status = 'published')
)
where e.status = 'ready' and e.starts_at is null;

create table if not exists memo_club_images (
  club_slug text not null,
  composition_key text not null,
  image_base64 text not null,
  md5 text not null,
  updated_at timestamptz not null default now(),
  primary key (club_slug, composition_key)
);
alter table memo_club_images enable row level security;

insert into memo_club_images (club_slug, composition_key, image_base64, md5, updated_at)
select m.club_slug,
       m.edition_id::text || '~' || case when jsonb_array_length(m.items) > 0 then m.id::text else '' end,
       i.image_base64, i.md5, i.updated_at
from club_memo_images i
join club_memos m on m.id = i.club_memo_id
on conflict (club_slug, composition_key) do nothing;

notify pgrst, 'reload schema';

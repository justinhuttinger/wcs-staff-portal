-- Monthly club memo. Company editors write one company section per month
-- (memo_editions); each club's managers add notes and publish that club's memo
-- themselves (club_memos). What's live is worked out from the dates at read
-- time, see lib/memoRules.js. API access is through the service role only.
--
-- memo_clubs is an explicit opt-in per club, so a club added to the registry
-- never appears in memos until someone turns it on.
--
-- Permissions: 'memos' = read your club's memo (the tile), seeded for everyone.
-- 'memos:company-edit' = write the company section, seeded for corporate and up
-- and grantable to anyone in the Roles grid. Writing club notes is a manager+
-- tier rule in the route. The legacy 'custom' role reads per-person custom_tiles.
-- Idempotent: safe to re-run.

create table if not exists memo_clubs (
  club_slug text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table memo_clubs enable row level security;

insert into memo_clubs (club_slug, enabled)
select s, true
from unnest(array['salem','keizer','eugene','springfield','clackamas','milwaukie','medford']) as s
on conflict (club_slug) do nothing;

create table if not exists memo_editions (
  id uuid primary key default gen_random_uuid(),
  month date not null unique,
  company_body text not null default '',
  status text not null default 'draft' check (status in ('draft', 'ready')),
  ready_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table memo_editions enable row level security;

create table if not exists club_memos (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references memo_editions(id) on delete cascade,
  club_slug text not null,
  notes text not null default '',
  lock_screen_text text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published')),
  starts_at timestamptz,
  ends_at timestamptz,
  published_at timestamptz,
  published_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (edition_id, club_slug)
);
alter table club_memos enable row level security;
create index if not exists club_memos_club_status_idx on club_memos (club_slug, status, starts_at desc);

insert into permission_catalog (perm_key, label, category, min_tier) values
  ('memos', 'Memos', 'Tools', 'team_member'),
  ('memos:company-edit', 'Memos - Edit Company Section', 'Tools', 'manager')
on conflict (perm_key) do nothing;

insert into role_tool_visibility (role, tool_key, visible)
select r.role, 'memos', true
from (values ('team_member'), ('front_desk'), ('personal_trainer'), ('lead'), ('manager'),
             ('marketing'), ('corporate'), ('director'), ('admin')) as r(role)
on conflict (role, tool_key) do nothing;

insert into role_tool_visibility (role, tool_key, visible)
select r.role, 'memos:company-edit', true
from (values ('corporate'), ('director'), ('admin')) as r(role)
on conflict (role, tool_key) do nothing;

notify pgrst, 'reload schema';

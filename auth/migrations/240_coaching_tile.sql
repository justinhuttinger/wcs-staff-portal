-- Coaching PR 3: the Coaching tile (trainer workspace).
--
-- 1. A catalog permission 'coaching' so the tile shows in the Roles grid and
--    the per-person overrides editor, and the API can gate on it
--    (requireTile('coaching') in routes/coaching.js and routes/exercises.js).
--    Seeded ON only for manager, director, corporate and admin. Front desk
--    staff and trainers share the team_member / lead roles (migration 010
--    merged front_desk and personal_trainer into team_member), so seeding
--    those roles would hand the tile to all front desk. Trainers get it per
--    person instead: Admin -> Roles & Permissions -> the per-person overrides
--    editor (staff_permission_overrides), which lists 'coaching' under Tools
--    via the catalog row below. A team_member/lead granted it that way is
--    scoped to their own clients (lib/coachingScope.js).
--    `do nothing` on conflict so a later admin toggle in the Roles grid is
--    never overwritten by a re-run.
-- 2. Client lifecycle on memberapp_members: active / archived, when someone
--    was upgraded to a client and by whom.
-- 3. Trainer-only client notes (Kahunas "Client Notes"). One note per client.
--
-- Idempotent. Depends on 185 (memberapp_members) and 239.

insert into permission_catalog (perm_key, label, category, min_tier) values
  ('coaching', 'Coaching', 'Tools', 'team_member')
on conflict (perm_key) do nothing;

insert into role_tool_visibility (role, tool_key, visible)
select r.role, 'coaching', true
from (values ('manager'), ('director'), ('corporate'), ('admin')) as r(role)
on conflict (role, tool_key) do nothing;

-- Archiving keeps programs and logs; the member drops back to tier 'basic',
-- which hides the Training tab in the member app.
alter table public.memberapp_members
  add column if not exists status text not null default 'active',
  add column if not exists archived_at timestamptz,
  add column if not exists upgraded_at timestamptz,
  add column if not exists upgraded_by text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'memberapp_members_status_check'
      and conrelid = 'public.memberapp_members'::regclass
  ) then
    alter table public.memberapp_members
      add constraint memberapp_members_status_check check (status in ('active', 'archived'));
  end if;
end $$;

-- Coaching lists clients by coach and by club.
create index if not exists memberapp_members_coach_idx
  on public.memberapp_members (coach_staff_id, status);
create index if not exists memberapp_members_club_idx
  on public.memberapp_members (club_number, status);

-- Staff-only. The member app never reads this table.
create table if not exists public.memberapp_client_notes (
  member_id   text not null,
  club_number text not null,
  body        text,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  primary key (member_id, club_number)
);
alter table public.memberapp_client_notes enable row level security;

notify pgrst, 'reload schema';

-- Hub v2: saved people the owner asks for things again and again (name, email
-- and the clubs they cover), and an owner per deliverable slot, so each club's
-- slot can be owed by a different person. Slot ownership moves from
-- hub_deliverables.person_id (kept, no longer used) to hub_slots.person_id.
-- Service role only. Idempotent.

create table if not exists hub_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_staff_id uuid not null references staff(id) on delete cascade,
  name text not null,
  email text not null,
  clubs text[] not null default '{}',
  created_at timestamptz not null default now()
);

create unique index if not exists hub_contacts_owner_email_idx on hub_contacts (owner_staff_id, lower(email));
alter table hub_contacts enable row level security;

alter table hub_task_people add column if not exists contact_id uuid references hub_contacts(id) on delete set null;
alter table hub_task_people add column if not exists clubs text[] not null default '{}';

alter table hub_slots add column if not exists person_id uuid references hub_task_people(id) on delete set null;
-- true when the owner picked (or cleared) this slot's owner by hand; automatic
-- assignment never touches those.
alter table hub_slots add column if not exists owner_manual boolean not null default false;
create index if not exists hub_slots_person_idx on hub_slots (person_id);

-- Existing slots keep the person their deliverable was owed by.
update hub_slots s
set person_id = d.person_id
from hub_deliverables d
where d.id = s.deliverable_id and s.person_id is null and d.person_id is not null;

-- People already on tasks cover the clubs of the slots they own, so automatic
-- assignment keeps those slots with them.
update hub_task_people p
set clubs = coalesce((select array_agg(distinct s.club) from hub_slots s where s.person_id = p.id and s.club is not null), '{}')
where p.clubs = '{}';

-- Everyone already on a task becomes a saved person (first name seen wins).
insert into hub_contacts (owner_staff_id, name, email)
select distinct on (t.owner_staff_id, lower(p.email)) t.owner_staff_id, p.name, lower(p.email)
from hub_task_people p
join hub_tasks t on t.id = p.task_id
order by t.owner_staff_id, lower(p.email), p.created_at
on conflict do nothing;

update hub_task_people p
set contact_id = c.id
from hub_tasks t, hub_contacts c
where t.id = p.task_id and c.owner_staff_id = t.owner_staff_id
  and lower(c.email) = lower(p.email) and p.contact_id is null;

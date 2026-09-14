-- 201: Operandio training, mirrored for reporting.
--
-- WHY A MIRROR AND NOT A LIVE READ
--
-- usersTrainingCourses(user: ID!) takes one user id. There is no bulk query, so
-- answering "is the company caught up" costs one API request per member of
-- staff -- 133 at the time of writing. That is fine on a schedule and not fine
-- on a report load, so operandioTrainingSync walks it in the background and the
-- report reads these tables. Same shape as the compliance sync (migration 076).
--
-- THE STAFF TABLE IS NOT OPTIONAL
--
-- The interesting finding on day one was not who is behind, it was who has
-- nothing assigned at all: 85 of 133 staff, and two entire clubs -- Clackamas
-- and Milwaukie -- with no training assignments whatsoever. A table of
-- assignments alone cannot say that, because the people concerned have no rows
-- in it. Storing the roster is what lets a club with nothing read as a gap
-- rather than as perfect compliance.

create table if not exists operandio_training_staff (
  user_id         text primary key,          -- Operandio user id
  full_name       text,
  email           text,
  user_status     text,                      -- 'active' etc, Operandio's own
  location_slugs  jsonb not null default '[]'::jsonb,
  group_names     jsonb not null default '[]'::jsonb,
  first_synced_at timestamptz not null default now(),
  synced_at       timestamptz not null default now()
);

comment on table operandio_training_staff is
  'Operandio user roster, mirrored so that staff with NO training assigned are countable. Without it a club with nothing assigned is indistinguishable from a club that has finished everything.';

create table if not exists operandio_training_assignments (
  id              text primary key,          -- UserTrainingCourse id
  user_id         text not null,
  course_id       text,
  course_name     text,
  course_type     text,                      -- 'training' | 'observation'
  course_inactive boolean not null default false,

  -- DERIVED, NOT REPORTED BY THE API. Operandio exposes no assigned date on
  -- UserTrainingCourse; this is decoded from the id, which is a Mongo ObjectId
  -- carrying its own creation timestamp. Verified against live data: dueAt
  -- minus this is exactly 7.00 days for every assignment of the course in use.
  -- Null where the id is not a decodable ObjectId.
  assigned_at     timestamptz,

  due_at          timestamptz,
  completed_at    timestamptz,
  percent_complete numeric,
  score_percent   numeric,

  -- complete | overdue | in_progress | not_started
  -- Recomputed on every sync because three of the four depend on "now".
  status          text not null default 'not_started',

  first_synced_at timestamptz not null default now(),
  synced_at       timestamptz not null default now()
);

comment on column operandio_training_assignments.assigned_at is
  'Decoded from the ObjectId id, not returned by the API. See lib/operandioApi.assignedAtFromId.';

create index if not exists idx_operandio_training_assign_user
  on operandio_training_assignments (user_id);
create index if not exists idx_operandio_training_assign_status
  on operandio_training_assignments (status);
create index if not exists idx_operandio_training_assign_course
  on operandio_training_assignments (course_id);

create table if not exists operandio_training_courses (
  id          text primary key,
  name        text,
  description text,
  type        text,
  inactive    boolean not null default false,
  synced_at   timestamptz not null default now()
);

create table if not exists operandio_training_sync_state (
  id                text primary key default 'singleton',
  last_run_at       timestamptz,
  last_success_at   timestamptz,
  last_error        text,
  staff_synced      int,
  assignments_synced int
);

-- Service-role only (portal backend); RLS on with no policies per convention.
alter table operandio_training_staff       enable row level security;
alter table operandio_training_assignments enable row level security;
alter table operandio_training_courses     enable row level security;
alter table operandio_training_sync_state  enable row level security;

-- ---------------------------------------------------------------------------
-- The tile.
--
-- Report visibility is the roles grid, entirely: a report is visible to a role
-- when role_tool_visibility carries `report:<key>` for it (migration 084 made
-- that the single source of truth and the frontend dropped its hardcoded
-- per-role defaults). So a new report that only lands in the catalogue is a
-- report nobody can see, including admins. Both halves are needed.
-- ---------------------------------------------------------------------------

insert into permission_catalog (perm_key, label, category, min_tier)
values ('report:training', 'Training', 'Reports', 'manager')
on conflict (perm_key) do nothing;

-- Manager and up, matching Compliance -- the other Operandio report and the
-- same audience. Not lead: this is staff performance, and a lead looking at
-- their own colleagues' outstanding training is a decision for Justin to make
-- in the Roles page rather than one seeded here.
insert into role_tool_visibility (role, tool_key, visible)
select r.role, 'report:training', true
from (values ('manager'), ('marketing'), ('corporate'), ('director'), ('admin')) as r(role)
on conflict (role, tool_key) do update set visible = true;

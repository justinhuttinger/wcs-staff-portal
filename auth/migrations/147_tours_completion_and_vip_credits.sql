-- 147: the completion half of a tour, and VIP credit as an immutable event.
--
-- ===========================================================================
-- TOURS
-- ===========================================================================
--
-- tour_intakes already models the tour lifecycle (received -> status -> outcome
-- -> completed_at/by), so this extends it rather than starting a second table
-- that would immediately disagree with it about what a tour is.
--
-- Three things were missing for reporting:
--   abc_member_id  the ABC id the portal product will send. tour_member is
--                  loose text and cannot be joined on, so without this a tour
--                  can never be followed through to a membership.
--   club_number    every analytics report keys on club number; location_id is
--                  a portal UUID and joins to none of them.
--   given_by_*     WHO GAVE THE TOUR is not who completed the record. A manager
--                  closing out a colleague's tour would otherwise take the
--                  credit -- the same confusion the Trainer report had between
--                  booking a Day One and servicing one.
--
-- ===========================================================================
-- VIP CREDITS
-- ===========================================================================
--
-- Credit lived ONLY in a GHL text field (contact.vip_team_member): free text,
-- hand-editable, and the sole record for anything before July 2026.
--
-- Measured before building: it is clean TODAY. All 39 distinct credited names
-- resolve to exactly one abc_employees row, covering all 426 credited contacts,
-- with zero ambiguity, and 367 of 367 widget-created VIPs agree with what
-- Supabase recorded at submission. Nothing has drifted. But nothing PREVENTS an
-- edit either, and nothing would say it happened.
--
-- So credit becomes an event, keyed on abc_employees.employee_id rather than a
-- name. NOT staff.id: only 12 of those 39 people have a portal login -- most
-- are floor staff -- so keying on the portal account would have silently
-- dropped two thirds of them.
--
-- Also found while measuring, both worth knowing and neither fixed here:
--   * 189 of 615 VIP contacts carry no credit at all, so any "VIPs by staffer"
--     report undercounts by a third until they are attributed.
--   * MILWAUKIE HAS NO VIP FIELDS CONFIGURED in GHL (44 cached fields against
--     ~90 everywhere else). VIPs there cannot be credited at all today.

alter table public.tour_intakes
  add column if not exists abc_member_id        text,
  add column if not exists club_number          text,
  add column if not exists given_by_employee_id text,
  add column if not exists given_by_name        text;

comment on column public.tour_intakes.given_by_employee_id is
  'abc_employees.employee_id of whoever GAVE the tour. completed_by is the portal account that closed the record, which is often someone else.';
comment on column public.tour_intakes.given_by_name is
  'Name as it stood when the tour was recorded. A snapshot, so a later rename does not silently rewrite history.';

create index if not exists tour_intakes_club_completed_idx
  on public.tour_intakes (club_number, completed_at);
create index if not exists tour_intakes_given_by_idx
  on public.tour_intakes (given_by_employee_id, completed_at);

-- Outcomes are data, not a CASE somewhere.
--
-- Deliberately NOT a foreign key on tour_intakes: a hard FK would make the
-- ingest endpoint reject an unknown outcome and LOSE the tour. The endpoint
-- validates against this list and returns 400 with the allowed values instead,
-- so a bad value fails loudly at the source while the tour is still in the
-- caller's hands.
create table if not exists public.tour_outcomes (
  outcome     text primary key,
  label       text not null,
  is_sale     boolean not null default false,
  sort_order  integer not null default 100
);

alter table public.tour_outcomes enable row level security;

insert into public.tour_outcomes (outcome, label, is_sale, sort_order) values
  ('joined',        'Joined',            true,  10),
  ('no_sale',       'No Sale',           false, 20),
  ('thinking',      'Thinking About It', false, 30),
  ('not_a_fit',     'Not a Fit',         false, 40),
  ('no_show',       'No Show',           false, 50),
  ('rescheduled',   'Rescheduled',       false, 60)
on conflict (outcome) do update
  set label = excluded.label, is_sale = excluded.is_sale, sort_order = excluded.sort_order;

comment on table public.tour_outcomes is
  'Allowed values for tour_intakes.outcome. The ingest endpoint validates against this and 400s on anything else; there is no FK, so a new outcome is a row rather than a deploy.';

update public.tour_intakes t
   set club_number = c.club_number
  from (values
    ('Salem','30935'),('Keizer','31599'),('Eugene','7655'),('Springfield','31598'),
    ('Clackamas','31600'),('Milwaukie','31601'),('Medford','32073')
  ) as c(name, club_number)
  join public.locations l on l.name = c.name
 where t.location_id = l.id and t.club_number is null;

create table if not exists public.vip_credits (
  id                uuid primary key default gen_random_uuid(),
  ghl_contact_id    text not null,
  ghl_location_id   text,
  club_number       text,
  employee_id       text,
  employee_name     text not null,
  -- widget       captured at submission by our own form; authoritative
  -- ghl_backfill reconstructed from the GHL field; historical, not observed
  -- manual       entered by hand later
  source            text not null default 'ghl_backfill',
  credited_at       timestamptz,
  recorded_at       timestamptz not null default now(),
  -- One credit per VIP contact, so a re-run of the backfill cannot inflate
  -- anybody's numbers.
  constraint vip_credits_contact_uniq unique (ghl_contact_id)
);

alter table public.vip_credits enable row level security;

create index if not exists vip_credits_employee_idx on public.vip_credits (employee_id, credited_at);
create index if not exists vip_credits_club_idx on public.vip_credits (club_number, credited_at);

comment on table public.vip_credits is
  'Immutable record of which employee gets credit for a VIP. Reports read this, never the mutable GHL text field. See vip_credit_drift for disagreement between the two.';

-- What GHL currently says, resolved to an employee id.
--
-- Joined through ghl_custom_field_cache rather than a hardcoded field id: the
-- ids differ per club (Salem gpdxWI9... vs Medford EXEpbfI...), so a baked-in id
-- would read the wrong field at six of the seven gyms.
create or replace view public.vip_credit_from_ghl as
with map as (
  select location_id, field_id
  from public.ghl_custom_field_cache
  where field_key = 'contact.vip_team_member'
),
emp as (
  -- One id per name. Verified unambiguous for every name currently in use.
  select distinct on (k) lower(regexp_replace(trim(full_name), '\s+', ' ', 'g')) as k,
         employee_id, club_number
  from public.abc_employees
  where full_name is not null and trim(full_name) <> ''
  order by k, employee_id
),
clubmap(ghl_location_id, club_number) as (
  select l.ghl_location_id, c.club_number
  from public.locations l
  join (values
    ('Salem','30935'),('Keizer','31599'),('Eugene','7655'),('Springfield','31598'),
    ('Clackamas','31600'),('Milwaukie','31601'),('Medford','32073')
  ) as c(name, club_number) on c.name = l.name
)
select
  c.id                                   as ghl_contact_id,
  c.location_id                          as ghl_location_id,
  cm.club_number,
  nullif(trim(c.custom_fields ->> m.field_id), '') as employee_name,
  emp.employee_id,
  c.created_at_ghl                       as credited_at
from public.ghl_contacts_v2 c
join map m on m.location_id = c.location_id
left join clubmap cm on cm.ghl_location_id = c.location_id
left join emp on emp.k = lower(regexp_replace(trim(c.custom_fields ->> m.field_id), '\s+', ' ', 'g'))
where c.custom_fields ? m.field_id
  and nullif(trim(c.custom_fields ->> m.field_id), '') is not null;

comment on view public.vip_credit_from_ghl is
  'Live read of the mutable GHL credit field, resolved to an employee id. Used to seed vip_credits and to detect drift; never read directly by a report.';

-- Seed the history. Marked ghl_backfill so nobody mistakes a reconstruction for
-- something observed at the time.
--
-- Backfilled 426 rows, every one with an employee id, across 39 employees.
insert into public.vip_credits
  (ghl_contact_id, ghl_location_id, club_number, employee_id, employee_name, source, credited_at)
select ghl_contact_id, ghl_location_id, club_number, employee_id, employee_name,
       'ghl_backfill', credited_at
from public.vip_credit_from_ghl
on conflict (ghl_contact_id) do nothing;

-- Where the immutable record and the live GHL field disagree.
--
-- The point is that this SURFACES a change rather than absorbing it. A row here
-- means somebody edited the field after the credit was recorded, and a check can
-- alert on it instead of the number quietly moving. Currently empty, which is
-- the healthy state.
create or replace view public.vip_credit_drift as
select
  v.ghl_contact_id,
  v.club_number,
  v.employee_name  as recorded_name,
  g.employee_name  as ghl_name_now,
  v.source,
  v.recorded_at
from public.vip_credits v
join public.vip_credit_from_ghl g on g.ghl_contact_id = v.ghl_contact_id
where lower(coalesce(g.employee_name, '')) is distinct from lower(coalesce(v.employee_name, ''));

comment on view public.vip_credit_drift is
  'VIP contacts whose GHL credit field no longer matches the credit we recorded. Empty is the healthy state; a row means somebody edited it after the fact.';

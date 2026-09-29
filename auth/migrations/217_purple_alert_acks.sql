-- 217: proof that front-desk staff acknowledged a PURPLE ABC member alert.
--
-- A purple staff-typed ABC alert ("Member Message Alert", colour Purple) is
-- serious. WCS ABC shows it as a blocking centre-screen box at check-in that
-- only closes once staff type their initials; each close is recorded here
-- (routes/memberAlerts.js POST /member-alerts/ack). Written by the auth API's
-- service role only.

create table if not exists public.purple_alert_acks (
  id               uuid primary key default gen_random_uuid(),
  club_number      text not null,              -- club the check-in happened at
  member_id        text not null,              -- ABC member id (32 hex)
  member_name      text,
  alert_id         text,                       -- ABC alertId, when ABC gives one
  alert_message    text not null,
  alert_note       text,
  initials         text not null,              -- typed by the staff member
  abc_staff_name   text,                       -- the logged-in ABC employee
  shown_at         timestamptz,                -- when the box appeared
  acknowledged_at  timestamptz not null default now()
);

-- "Who acknowledged what at this club, most recent first."
create index if not exists purple_alert_acks_club_time
  on public.purple_alert_acks (club_number, acknowledged_at desc);
-- "Every acknowledgement of this member's alert."
create index if not exists purple_alert_acks_member
  on public.purple_alert_acks (member_id);

-- Service role only (portal-wide convention): RLS on, no policies.
alter table public.purple_alert_acks enable row level security;

notify pgrst, 'reload schema';

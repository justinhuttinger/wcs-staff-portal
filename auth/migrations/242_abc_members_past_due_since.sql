-- 242: abc_members.past_due_since, so a one-sync past-due blip isn't pushed to GHL.
--
-- 2026-10-22 ~4 AM PT ABC reported isPastDue=true for ~190 members across
-- Keizer/Springfield/Eugene/Salem for a single sync (its overnight billing run),
-- then false again 30 minutes later. Reconcile wrote Past Due = Yes straight to
-- GHL and the past-due SMS workflow texted every one of them.
--
-- The trigger stamps when a member first turned past due and keeps that stamp
-- while they stay past due, whatever the upsert payload says. Reconcile only
-- pushes Past Due = Yes once the stamp is old enough (ghl-sync
-- PAST_DUE_CONFIRM_MINUTES).
--
-- Safe in either deploy order: ghl-sync treats a missing/null stamp as
-- confirmed, which is the old behaviour.

alter table public.abc_members
  add column if not exists past_due_since timestamptz;

create or replace function public.abc_members_stamp_past_due_since()
returns trigger
language plpgsql
as $$
begin
  if new.is_past_due is true then
    if tg_op = 'UPDATE' and old.is_past_due is true then
      -- new carries the old stamp unless the statement set it (the backfill below).
      new.past_due_since := coalesce(new.past_due_since, now());
    else
      new.past_due_since := now();
    end if;
  else
    new.past_due_since := null;
  end if;
  return new;
end;
$$;

drop trigger if exists abc_members_past_due_since on public.abc_members;
create trigger abc_members_past_due_since
  before insert or update on public.abc_members
  for each row execute function public.abc_members_stamp_past_due_since();

-- Members already past due are already Yes in GHL: backdate so they count as confirmed.
update public.abc_members
   set past_due_since = now() - interval '1 day'
 where is_past_due is true and past_due_since is null;

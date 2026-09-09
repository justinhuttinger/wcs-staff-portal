-- vip_credits has been frozen since the day it was created.
--
-- Migration 147 built the table and seeded it once, 426 rows marked
-- 'ghl_backfill', from the vip_credit_from_ghl view. Nothing has inserted a row
-- since: no application code writes to it (grep for 'vip_credits' finds reads
-- only), and the 'widget' source the table comment describes was never built.
--
-- Every Analytics report that counts VIPs reads this table, so all of them have
-- been reporting the state of the world on the day 147 was applied. A VIP
-- collected after that is invisible, which is why the current month shows zero
-- while the clubs are plainly collecting them. The KPI/Membership report was
-- unaffected and disagreed all along, because it counts GHL contacts live
-- through count_vips_by_team_member rather than reading this table.
--
-- The fix is a top-up on a schedule. vip_credit_from_ghl is a LIVE read of
-- ghl_contacts_v2.custom_fields, which ghl-sync keeps current, so re-running the
-- same insert picks up every newly credited contact. ON CONFLICT DO NOTHING
-- keeps the table immutable in the way 147 intended: an existing credit is
-- never rewritten, so a field edited after the fact still surfaces in
-- vip_credit_drift instead of being silently absorbed.
--
-- WHAT THIS DOES NOT FIX: credited_at is the CONTACT's GHL creation date, not
-- the moment the VIP field was filled. For a referral taken the normal way —
-- new person, contact created as they are referred — those are the same day. A
-- contact that already existed and is credited months later is dated to when
-- the contact was made, so it lands in an earlier month than the referral. The
-- date is kept as-is rather than switched to now(), because the 426 seeded rows
-- use that definition and two definitions of credited_at in one column would be
-- worse than one imperfect definition. recorded_at carries when we saw it.

create extension if not exists pg_cron;

-- 'ghl_sync' rather than reusing 'ghl_backfill': both are reconstructed from
-- the GHL field rather than observed at submission, but distinguishing the
-- one-time seed from the ongoing top-up is what lets anyone tell whether the
-- schedule is actually running.
create or replace function public.sync_vip_credits()
returns integer
language plpgsql
as $$
declare inserted int;
begin
  insert into public.vip_credits
    (ghl_contact_id, ghl_location_id, club_number, employee_id, employee_name, source, credited_at)
  select ghl_contact_id, ghl_location_id, club_number, employee_id, employee_name,
         'ghl_sync', credited_at
  from public.vip_credit_from_ghl
  on conflict (ghl_contact_id) do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

comment on function public.sync_vip_credits is
  'Adds VIP credits that appeared in GHL since the last run. Never rewrites an existing credit — see vip_credit_drift for fields edited after the fact.';

comment on column public.vip_credits.source is
  'widget = captured at submission by our own form (authoritative); ghl_backfill = the one-time seed in migration 147; ghl_sync = picked up later by sync_vip_credits(); manual = entered by hand.';

-- Idempotent: unschedule first so re-running this migration cannot leave two
-- jobs racing each other.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-vip-credits') then
    perform cron.unschedule('sync-vip-credits');
  end if;
end $$;

-- Hourly at :20. Hourly rather than nightly because these numbers are read
-- during the working day — a VIP collected this morning should count this
-- morning — and rather than every few minutes because the view scans the
-- contact table and nothing here is worth that.
select cron.schedule(
  'sync-vip-credits',
  '20 * * * *',
  $$select public.sync_vip_credits()$$
);

-- Catch up everything missed since 147 was applied, straight away, so the
-- reports are right before the first scheduled run rather than an hour later.
select public.sync_vip_credits();

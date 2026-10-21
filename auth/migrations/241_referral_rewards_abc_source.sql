-- 241: referral rewards from ABC sales + per-club reward amounts.
--
-- ABC agreements carry the referral staff key in at point of sale
-- (agreement.referringMemberId / referringMemberName / referringMemberHomeClub).
-- The sync dropped them; now they land on abc_members so the reconcile loop can
-- reward referrals that never went through the GHL VIP form.
--
-- APPLY BEFORE the ghl-sync deploy goes live: transformABCMember writes these
-- columns, so the abc_members upsert fails until they exist.

alter table public.abc_members
  add column if not exists referring_member_id        text,
  add column if not exists referring_member_name      text,
  add column if not exists referring_member_home_club text;

-- referral_rewards (created by ghl-sync/migrations/007):
--   source               where the referral came from: 'ghl' (VIP form field) | 'abc' (agreement)
--   original_amount      DUES invoice amount before the reward
--   new_amount           what it was adjusted to (0.00 for a free month)
--   abc_writeback_status VIP referral copied onto the new member's ABC profile:
--                        'noted' | 'not_needed' | 'error'
-- dues_status gains 'discounted' (amount off, e.g. Milwaukie's $50) next to 'zeroed'.
alter table public.referral_rewards
  add column if not exists source               text,
  add column if not exists original_amount      numeric(10,2),
  add column if not exists new_amount           numeric(10,2),
  add column if not exists abc_writeback_status text;

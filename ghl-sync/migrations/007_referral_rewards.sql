-- ghl-sync/migrations/007_referral_rewards.sql
-- Ledger of referral rewards: one row per referred new signup.
create table if not exists referral_rewards (
  id                      uuid primary key default gen_random_uuid(),
  run_id                  uuid,                    -- reconcile run that produced this row
  club_number             text not null,
  location_id             text,
  new_member_id           text not null,          -- ABC member id of the signup
  new_member_name         text,
  referrer_abc_id         text not null,          -- value of contact.referred_by_abc_id
  referrer_ghl_contact_id text,
  dues_invoice_due_date   date,                    -- the invoice we zeroed
  dues_status             text not null,           -- 'zeroed' | 'no_dues_invoice' | 'error'
  sms_status              text not null,           -- 'tagged' | 'skipped' | 'no_referrer_contact' | 'error'
  needs_review            boolean not null default false,
  resolved_at             timestamptz,
  resolved_by             text,
  dry_run                 boolean not null default false,
  error                   text,
  created_at              timestamptz not null default now()
);

-- Idempotency: one reward per new signup. Dry runs never write rows
-- (processReferralReward returns before recordReward when dryRun), so a plain
-- (non-partial) unique index is correct and works as the onConflict arbiter.
create unique index if not exists referral_rewards_new_member_uniq
  on referral_rewards (new_member_id);

create index if not exists referral_rewards_needs_review_idx
  on referral_rewards (needs_review) where needs_review = true;

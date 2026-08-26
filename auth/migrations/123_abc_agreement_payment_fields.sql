-- Capture four ABC agreement fields the sync already receives but never mapped.
-- Probed live against /rest/31601/members; all four are present on every
-- agreement object.
--
--   agreement_payment_method  Statement | Cash | EFT | Credit Card | null
--                             EFT is ACH — this is what "% on ACH" needs.
--   agreement_term            Open | Cash | Installment | Cash Open
--                             The real payment term. payment_frequency is only
--                             ever "Monthly" or null and is useless as a filter.
--   is_primary_member         false = a secondary/add-on member on someone
--                             else's agreement. Drives "Member Relationship".
--   is_non_member             ABC's own non-member flag.
--
-- All nullable: the sync backfills active members on its next full pull, and
-- scripts/backfill-abc-payment-fields.js catches inactive rows that the
-- incremental inactive pass would otherwise never revisit.

alter table public.abc_members
  add column if not exists agreement_payment_method text,
  add column if not exists agreement_term           text,
  add column if not exists is_primary_member        boolean,
  add column if not exists is_non_member            boolean;

comment on column public.abc_members.agreement_payment_method is
  'ABC agreement.agreementPaymentMethod. "EFT" is ACH.';
comment on column public.abc_members.agreement_term is
  'ABC agreement.term (Open/Cash/Installment/Cash Open). Prefer over payment_frequency.';
comment on column public.abc_members.is_primary_member is
  'ABC agreement.isPrimaryMember. false = secondary/add-on on another agreement.';

-- Reporting reads payment method inside a club + sign-date window.
create index if not exists idx_abc_members_payment_method
  on public.abc_members (club_number, agreement_payment_method)
  where agreement_payment_method is not null;

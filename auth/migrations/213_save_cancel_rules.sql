-- 213: WCS Save cancel rules per plan kind. The wcs-save Worker reads these to
-- work out what a member owes to cancel. plan_kind comes from the ABC agreement
-- term: Open = month_to_month, Installment = contract, Cash / Cash Open = prepaid.
create table if not exists save_cancel_rules (
  plan_kind text primary key check (plan_kind in ('month_to_month', 'contract', 'prepaid')),
  label text not null,
  -- If the next dues payment is this many days away or fewer, the member owes it to cancel.
  notice_days int not null default 0 check (notice_days between 0 and 90),
  -- Charged when cancelling before the contract end date (contract plans only).
  early_cancel_fee numeric(10,2) not null default 0 check (early_cancel_fee >= 0),
  -- Online cancel not allowed; the request goes to staff.
  send_to_staff boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table save_cancel_rules enable row level security;
insert into save_cancel_rules (plan_kind, label, notice_days, early_cancel_fee, send_to_staff) values
  ('month_to_month', 'Month to month', 15, 0, false),
  ('contract', '1-year contract', 15, 100, false),
  ('prepaid', 'Paid in full / comp', 0, 0, true)
on conflict (plan_kind) do nothing;

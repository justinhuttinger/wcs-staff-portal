-- ABC Members table — stores all members pulled from ABC Financial API
create table if not exists abc_members (
  id uuid primary key default gen_random_uuid(),
  member_id text not null,
  club_number text not null,
  first_name text,
  last_name text,
  email text,
  primary_phone text,
  mobile_phone text,
  barcode text,
  birth_date date,
  gender text,
  is_active boolean,
  member_status text,
  join_status text,
  member_status_date date,
  home_club text,
  total_check_in_count integer default 0,
  first_check_in_timestamp text,
  last_check_in_timestamp text,
  create_timestamp text,
  last_modified_timestamp text,
  agreement_number text,
  membership_type text,
  membership_type_abc_code text,
  payment_plan text,
  payment_frequency text,
  is_past_due boolean default false,
  down_payment numeric,
  next_due_amount numeric,
  projected_due_amount numeric,
  past_due_balance numeric,
  total_past_due_balance numeric,
  late_fee_amount numeric,
  since_date date,
  begin_date date,
  expiration_date date,
  next_billing_date date,
  renewal_date date,
  sign_date date,
  last_sync_at timestamptz default now(),
  unique(member_id, club_number)
);

-- Indexes for common queries
create index if not exists idx_abc_members_club on abc_members(club_number);
create index if not exists idx_abc_members_email on abc_members(email);
create index if not exists idx_abc_members_active on abc_members(club_number, is_active);

-- ABC Sync Run Log — records every intended or applied GHL change
create table if not exists abc_sync_run_log (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  run_at timestamptz default now(),
  club_number text,
  club_name text,
  dry_run boolean default true,
  ghl_contact_id text,
  ghl_contact_name text,
  ghl_contact_email text,
  abc_member_id text,
  action text,        -- 'add_tag', 'remove_tag', 'update_field', 'no_match'
  detail jsonb,       -- { tag: 'sale' } or { field: 'membershipType', from: null, to: 'Gold' }
  applied boolean default false,
  error text
);

create index if not exists idx_abc_sync_log_run on abc_sync_run_log(run_id);
create index if not exists idx_abc_sync_log_club on abc_sync_run_log(club_number);
create index if not exists idx_abc_sync_log_action on abc_sync_run_log(action);

-- Hub files in Google Drive: the owner's single "Hub Uploads" folder (by id),
-- and each file's Drive id and link. Files stored before this (or when Drive
-- was unavailable) keep storage_path in portal storage until moved.
-- Service role only. Idempotent.

create table if not exists hub_settings (
  owner_staff_id uuid primary key references staff(id) on delete cascade,
  drive_folder_id text,
  updated_at timestamptz not null default now()
);
alter table hub_settings enable row level security;

alter table hub_slot_items add column if not exists drive_file_id text;
alter table hub_slot_items add column if not exists drive_url text;
alter table hub_tray_items add column if not exists drive_file_id text;
alter table hub_tray_items add column if not exists drive_url text;

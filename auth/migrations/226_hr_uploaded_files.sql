-- 226_hr_uploaded_files.sql
-- Files a manager uploads to an employee's HR record (signed forms, doctor's
-- notes, scans). The bytes live in the private `hr-files` storage bucket, which
-- the route creates on first use; this table is the index.
--
-- Keyed on the Paychex worker_id rather than the employee's name, so a rename
-- or a shared name never attaches a file to the wrong person.
create table if not exists public.hr_uploaded_files (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null,
  employee_name text not null,
  location_slug text,
  title text,
  file_name text not null,
  content_type text not null,
  size_bytes integer not null,
  storage_path text not null,
  uploaded_by uuid references public.staff(id) on delete set null,
  uploaded_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists hr_uploaded_files_worker_idx
  on public.hr_uploaded_files (worker_id, created_at desc);

-- Service-role only: the portal API is the single reader and writer.
alter table public.hr_uploaded_files enable row level security;

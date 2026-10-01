-- 227_hr_uploaded_files_paychex.sql
-- Uploaded HR files are now also sent to the employee's Paychex record.
-- paychex_status: 'sent' | 'failed' | null (uploaded before this change).
alter table public.hr_uploaded_files add column if not exists paychex_document_id text;
alter table public.hr_uploaded_files add column if not exists paychex_status text;

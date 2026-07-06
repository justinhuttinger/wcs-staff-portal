-- 077_operandio_job_skip_reason.sql
--
-- Job-level skips from the Operandio API (JobSkipReason, e.g. 'closed' when
-- the club was closed that day). Skipped jobs count as completed on time in
-- compliance_status; skip_reason is kept so the UI can label them "Skipped".

alter table operandio_api_jobs add column if not exists skip_reason text;

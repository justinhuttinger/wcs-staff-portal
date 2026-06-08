-- 031: Operandio audit PDF backfill support.
-- pdf_path  = storage object path in the operandio-attachments bucket (null for
--             email-ingested rows).
-- source    = provenance of the row: 'email' (the SendGrid webhook, default) or
--             'pdf_backfill' (the one-time Downloads backfill). Lets the
--             backfill be idempotent and never overwrite live email rows.
alter table operandio_qa_reports
  add column if not exists pdf_path text,
  add column if not exists source text not null default 'email';

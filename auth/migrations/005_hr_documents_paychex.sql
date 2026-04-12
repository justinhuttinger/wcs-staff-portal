-- Add Paychex worker_id and short_reason fields to hr_documents
ALTER TABLE hr_documents ADD COLUMN IF NOT EXISTS worker_id TEXT;
ALTER TABLE hr_documents ADD COLUMN IF NOT EXISTS short_reason TEXT;

-- Add action_plan field to hr_documents
ALTER TABLE hr_documents ADD COLUMN IF NOT EXISTS action_plan TEXT;

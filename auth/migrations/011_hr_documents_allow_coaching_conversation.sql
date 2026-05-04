-- 011_hr_documents_allow_coaching_conversation.sql
-- Widen the hr_documents.reason CHECK constraint to match the route + UI,
-- which both already accept 'coaching_conversation' as a fourth valid
-- reason. Without this, POST /hr-documents with reason='coaching_conversation'
-- 500s with: new row violates check constraint "hr_documents_reason_check".
ALTER TABLE hr_documents DROP CONSTRAINT IF EXISTS hr_documents_reason_check;
ALTER TABLE hr_documents ADD CONSTRAINT hr_documents_reason_check
  CHECK (reason IN ('coaching_conversation', 'verbal_warning', 'written_warning', 'termination'));

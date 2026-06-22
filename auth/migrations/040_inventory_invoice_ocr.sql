-- 040_inventory_invoice_ocr.sql
-- Invoice OCR auto-restock: multi-page invoices, learned vendor->item aliases,
-- and parse/match bookkeeping. See 038_inventory.sql for the base model.

-- One row per uploaded page of an invoice (the invoice may span several photos).
CREATE TABLE IF NOT EXISTS inventory_invoice_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES inventory_invoices(id) ON DELETE CASCADE,
  file_link   text NOT NULL,
  file_name   text,
  page_no     integer,
  mime_type   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_invoice_files_invoice
  ON inventory_invoice_files(invoice_id);

-- Learned mapping: a vendor's product name/SKU on an invoice line -> catalog item.
-- Written when a user receives a confirmed match; consulted on future parses.
CREATE TABLE IF NOT EXISTS inventory_vendor_aliases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_number text,
  vendor      text NOT NULL,            -- normalized (lower, trimmed)
  alias_text  text NOT NULL,            -- normalized vendor product name/SKU
  upc         text,
  item_id     uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_number, vendor, alias_text)
);
CREATE INDEX IF NOT EXISTS idx_inventory_vendor_aliases_lookup
  ON inventory_vendor_aliases(club_number, vendor);

ALTER TABLE inventory_invoices
  ADD COLUMN IF NOT EXISTS parse_status text,        -- pending | parsed | error
  ADD COLUMN IF NOT EXISTS parsed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS parse_error  text;

ALTER TABLE inventory_invoice_items
  ADD COLUMN IF NOT EXISTS match_confidence numeric, -- 0..1; null once user-confirmed
  ADD COLUMN IF NOT EXISTS match_source     text;     -- upc | alias | fuzzy | manual

ALTER TABLE inventory_invoice_files  ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_vendor_aliases ENABLE ROW LEVEL SECURITY;

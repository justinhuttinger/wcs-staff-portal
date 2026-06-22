-- 041_inventory_vendor_sku.sql
-- Real vendor invoices (e.g. Sportlife) carry a stable per-vendor Item SKU but
-- no UPC. Capture the SKU on invoice lines and make it the primary learned-match
-- key in inventory_vendor_aliases. See 040_inventory_invoice_ocr.sql.

ALTER TABLE inventory_invoice_items
  ADD COLUMN IF NOT EXISTS vendor_sku text;

ALTER TABLE inventory_vendor_aliases
  ADD COLUMN IF NOT EXISTS vendor_sku text;

-- alias_text is now optional (a SKU-only alias has no text key).
ALTER TABLE inventory_vendor_aliases ALTER COLUMN alias_text DROP NOT NULL;

-- Replace the single table-level UNIQUE with two partial unique indexes:
-- SKU-keyed when a SKU exists, text-keyed otherwise.
ALTER TABLE inventory_vendor_aliases
  DROP CONSTRAINT IF EXISTS inventory_vendor_aliases_club_number_vendor_alias_text_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_vendor_aliases_sku
  ON inventory_vendor_aliases(club_number, vendor, vendor_sku) WHERE vendor_sku IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_vendor_aliases_text
  ON inventory_vendor_aliases(club_number, vendor, alias_text)
  WHERE vendor_sku IS NULL AND alias_text IS NOT NULL;

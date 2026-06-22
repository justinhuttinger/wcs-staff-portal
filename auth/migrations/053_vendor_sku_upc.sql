-- 053_vendor_sku_upc.sql
-- Vendor price-list lookup: maps a vendor's SKU to its UPC(s) so invoices that
-- print a SKU but no UPC (e.g. Sportlife) can be matched to ABC catalog items by
-- UPC. Also carries cost (EDLP per case) and the derived per-unit cost so item
-- cost basis can be seeded from the price list. Seeded via the Admin > Set Up >
-- Vendor Price List uploader. See 040/041 for the invoice OCR base.

CREATE TABLE IF NOT EXISTS vendor_sku_upc (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor        text NOT NULL,            -- normalized (lower, trimmed)
  sku           text NOT NULL,            -- vendor item/SKU number
  product_name  text,
  upc           text,                     -- case/pack UPC (digits only)
  unit_upc      text,                     -- individual-unit UPC (digits only)
  pack_size     integer NOT NULL DEFAULT 1,
  case_cost     numeric(12,4),            -- EDLP as given (per case)
  unit_cost     numeric(12,4),            -- case_cost / pack_size
  map_price     numeric(12,2),            -- MAP retail price (reference)
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor, sku)
);

-- Enrichment looks up by (vendor, sku); matching falls back to UPC lookups.
CREATE INDEX IF NOT EXISTS idx_vendor_sku_upc_vendor ON vendor_sku_upc(vendor);
CREATE INDEX IF NOT EXISTS idx_vendor_sku_upc_upc ON vendor_sku_upc(upc) WHERE upc IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_sku_upc_unit_upc ON vendor_sku_upc(unit_upc) WHERE unit_upc IS NOT NULL;

-- Service-role only, RLS on with no policy (migration 035 convention).
ALTER TABLE vendor_sku_upc ENABLE ROW LEVEL SECURITY;

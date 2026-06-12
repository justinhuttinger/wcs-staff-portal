-- 038_inventory.sql
-- Experimental "Inventory" tool. The ABC catalog (GET /{club}/clubs/items) is
-- the source of truth for WHAT can be sold and its sale price, but on-hand
-- quantities are tracked entirely in the portal (we intentionally do not use
-- ABC's inStock). POS sales (GET /{club}/clubs/transactions/pos) flow in via
-- sync and decrement stock; uploaded vendor invoices add stock and establish
-- unit COST so per-item profit margins can be computed.

-- One row per ABC catalog item per club.
CREATE TABLE IF NOT EXISTS inventory_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_number     text NOT NULL,
  sale_item_id    text NOT NULL,            -- ABC saleItemId
  item_name       text NOT NULL,
  item_type       text,                     -- ABC itemType
  product_type    text,                     -- ABC productType
  category        text,                     -- ABC itemCategoryName
  description     text,
  upc             text,
  abc_unit_price  numeric(12,2),            -- sale price from ABC catalog
  abc_in_stock    text,                     -- raw ABC value, reference only
  is_tracked      boolean NOT NULL DEFAULT true,
  qty_on_hand     numeric(12,2) NOT NULL DEFAULT 0,  -- maintained from movements
  last_unit_cost  numeric(12,4),            -- most recent received invoice cost
  avg_unit_cost   numeric(12,4),            -- moving average over received stock
  archived        boolean NOT NULL DEFAULT false,    -- gone from the ABC catalog
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_synced_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_number, sale_item_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_club ON inventory_items(club_number);
CREATE INDEX IF NOT EXISTS idx_inventory_items_upc ON inventory_items(upc) WHERE upc IS NOT NULL;

-- POS transactions synced from ABC (header row).
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_number     text NOT NULL,
  transaction_id  text NOT NULL,            -- ABC transactionId
  transaction_at  timestamptz NOT NULL,
  member_id       text,
  employee_id     text,
  receipt_number  text,
  station_name    text,
  is_return       boolean NOT NULL DEFAULT false,
  raw             jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_number, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_txn_club_at
  ON inventory_transactions(club_number, transaction_at DESC);

-- POS transaction line items.
CREATE TABLE IF NOT EXISTS inventory_transaction_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_pk    uuid NOT NULL REFERENCES inventory_transactions(id) ON DELETE CASCADE,
  club_number       text NOT NULL,
  line_no           integer NOT NULL,
  abc_item_id       text,                   -- ABC itemId on the sale line
  name              text,
  upc               text,
  inventory_type    text,
  profit_center     text,
  catalog           text,
  quantity          numeric(12,2) NOT NULL DEFAULT 0,
  unit_price        numeric(12,2),          -- actual sold-at price
  subtotal          numeric(12,2),
  tax               numeric(12,2),
  item_id           uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  unit_cost_at_sale numeric(12,4),          -- item cost snapshot when synced
  UNIQUE (transaction_pk, line_no)
);

CREATE INDEX IF NOT EXISTS idx_inventory_txn_items_item
  ON inventory_transaction_items(item_id) WHERE item_id IS NOT NULL;

-- Uploaded vendor invoices (file lives in Drive; line items below).
CREATE TABLE IF NOT EXISTS inventory_invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_number     text,                     -- null = corporate / multi-club
  vendor          text NOT NULL,
  invoice_number  text,
  invoice_date    date,
  total           numeric(12,2),
  file_link       text,
  file_name       text,
  notes           text,
  received_at     timestamptz,              -- when lines were applied to stock
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_invoices_date
  ON inventory_invoices(invoice_date DESC);

-- Invoice line items. `received` flips when the line is applied to stock
-- (creates a 'received' movement + updates the item's cost basis).
CREATE TABLE IF NOT EXISTS inventory_invoice_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES inventory_invoices(id) ON DELETE CASCADE,
  item_id     uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  description text,
  upc         text,
  quantity    numeric(12,2) NOT NULL,
  unit_cost   numeric(12,4) NOT NULL,
  received    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_invoice_items_invoice
  ON inventory_invoice_items(invoice_id);

-- Stock ledger — every change to qty_on_hand gets an audit row.
CREATE TABLE IF NOT EXISTS inventory_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  club_number     text NOT NULL,
  kind            text NOT NULL,            -- sale | return | received | adjustment | count
  qty_delta       numeric(12,2) NOT NULL,
  qty_after       numeric(12,2),
  unit_cost       numeric(12,4),
  unit_price      numeric(12,2),
  source          text,                     -- abc_pos | invoice | manual | mobile
  ref_id          text,                     -- transaction id / invoice id
  note            text,
  created_by      uuid,
  created_by_name text,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_item
  ON inventory_movements(item_id, occurred_at DESC);

-- Per-club, per-kind sync bookkeeping (kind: catalog | pos).
CREATE TABLE IF NOT EXISTS inventory_sync_state (
  club_number    text NOT NULL,
  kind           text NOT NULL,
  last_synced_at timestamptz,
  last_status    text,                      -- ok | error | running
  last_error     text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (club_number, kind)
);

-- Keep updated_at fresh.
CREATE OR REPLACE FUNCTION inventory_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_items_updated_at ON inventory_items;
CREATE TRIGGER trg_inventory_items_updated_at
  BEFORE UPDATE ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION inventory_touch_updated_at();

DROP TRIGGER IF EXISTS trg_inventory_invoices_updated_at ON inventory_invoices;
CREATE TRIGGER trg_inventory_invoices_updated_at
  BEFORE UPDATE ON inventory_invoices
  FOR EACH ROW EXECUTE FUNCTION inventory_touch_updated_at();

DROP TRIGGER IF EXISTS trg_inventory_sync_state_updated_at ON inventory_sync_state;
CREATE TRIGGER trg_inventory_sync_state_updated_at
  BEFORE UPDATE ON inventory_sync_state
  FOR EACH ROW EXECUTE FUNCTION inventory_touch_updated_at();

-- Portal access is 100% service-role; RLS on with no policies blocks any
-- stray anon/authenticated access (matches migration 035 convention).
ALTER TABLE inventory_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transaction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_invoices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_invoice_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements         ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_sync_state        ENABLE ROW LEVEL SECURITY;

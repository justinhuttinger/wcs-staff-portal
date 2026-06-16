-- 039_inventory_profit_center.sql
-- Restrict the Inventory tool to sellable retail goods.
--
-- ABC's POS catalog mixes real inventory (drinks, snacks, supplements, merch,
-- tanning) with non-stock line items (dues, enrollment/guest fees, day passes,
-- training, swim lessons, club-account payments). Only the retail goods are
-- physical stock we count and can oversell. We classify each catalog item by
-- its ABC "profit center", which arrives on POS sale lines.

ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS profit_center text;

CREATE INDEX IF NOT EXISTS idx_inventory_items_profit_center
  ON inventory_items(profit_center) WHERE profit_center IS NOT NULL;

-- Backfill profit_center on each catalog item from its POS sale lines (the
-- most recently synced line wins).
UPDATE inventory_items it
SET profit_center = sub.profit_center
FROM (
  SELECT DISTINCT ON (ti.item_id) ti.item_id, ti.profit_center
  FROM inventory_transaction_items ti
  WHERE ti.item_id IS NOT NULL AND ti.profit_center IS NOT NULL
  ORDER BY ti.item_id, ti.id DESC
) sub
WHERE it.id = sub.item_id
  AND it.profit_center IS DISTINCT FROM sub.profit_center;

-- Reset on-hand for items that are NOT sellable but had stock moved against
-- them by earlier syncs (e.g. dues/fees that went "negative"). These rows are
-- now hidden from the module, so their qty is meaningless — zero it so the
-- ledger isn't misleading if an item is ever reclassified.
UPDATE inventory_items
SET qty_on_hand = 0
WHERE qty_on_hand <> 0
  AND NOT (
    profit_center IN ('WCS Drinks','WCS Snacks','WCS Supplements','WCS Merchandise','WCS Tanning')
    OR (profit_center IS NULL AND category IN
        ('Drinks','Snacks','Supplements','Merchandise','Tanning','Tannning','Drinks & Accessories'))
  );

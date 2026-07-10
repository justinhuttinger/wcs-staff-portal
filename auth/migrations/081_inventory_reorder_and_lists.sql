-- 081_inventory_reorder_and_lists.sql
-- Two additions to the Inventory tool:
--
--  1. inventory_reorder_levels -- per-club, per-category reorder points. Until
--     now the "To Order" tab used a hardcoded { Drinks:12, Snacks:12,
--     Supplements:4 } constant in the frontend; this lets a manager tune the
--     point for each category at each club. A missing row = fall back to those
--     same defaults in code, so behaviour is unchanged until someone edits.
--
--  2. inventory_shopping_lists / _items -- presaved, per-club reorder checklists.
--     A list is a named set of catalog items; opening it shows each item's live
--     on-hand next to its category's reorder level so staff can eyeball what to
--     restock. Any inventory user (lead+) can create/manage lists.

-- --- 1. Reorder levels --------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_reorder_levels (
  club_number    text NOT NULL,
  category       text NOT NULL,
  reorder_point  numeric(12,2) NOT NULL,   -- on-hand at/below this -> "To Order"
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  PRIMARY KEY (club_number, category)
);

-- Seed the current hardcoded defaults for every club so the editor shows the
-- values already in effect. Uses the 7 WCS club numbers (utils/locationSlug).
INSERT INTO inventory_reorder_levels (club_number, category, reorder_point)
SELECT c.club_number, v.category, v.reorder_point
FROM (VALUES
  ('30935'),('31599'),('7655'),('31598'),('31600'),('31601'),('32073')
) AS c(club_number)
CROSS JOIN (VALUES
  ('Drinks', 12), ('Snacks', 12), ('Supplements', 4)
) AS v(category, reorder_point)
ON CONFLICT (club_number, category) DO NOTHING;

ALTER TABLE inventory_reorder_levels ENABLE ROW LEVEL SECURITY;

-- --- 2. Shopping lists --------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_shopping_lists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_number   text NOT NULL,
  name          text NOT NULL,
  created_by    text,                       -- staff id
  created_by_name text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shopping_lists_club ON inventory_shopping_lists(club_number);

CREATE TABLE IF NOT EXISTS inventory_shopping_list_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id            uuid NOT NULL REFERENCES inventory_shopping_lists(id) ON DELETE CASCADE,
  inventory_item_id  uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  added_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list_id, inventory_item_id)
);

CREATE INDEX IF NOT EXISTS idx_shopping_list_items_list ON inventory_shopping_list_items(list_id);

ALTER TABLE inventory_shopping_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_shopping_list_items ENABLE ROW LEVEL SECURITY;

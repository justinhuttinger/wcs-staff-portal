-- 179_till_cash_movements.sql
-- Cash moved in or out of a drawer, recorded in the portal instead of rung up
-- on the register.
--
-- Until now the ONLY way to tell the reconciler that cash left the drawer was
-- to ring the ABC "Cash Drop" POS item (UPC 'XXXCASHDROPXXX', see
-- 071_till_settings.sql). That works, but it is easy to skip and ABC books the
-- ring as a sale, so every drop also inflates the Revenue and POS Sales
-- reports. This table is the portal-side replacement: a lead pulls $200 for the
-- bank, taps it into the Till tile, and expected_close moves by $200 with no
-- phantom sale anywhere.
--
-- POS drops are NOT retired: aggregateCashByDay still counts drop-UPC lines, so
-- every historical day reconciles exactly as it did before, and a club that has
-- not switched over yet keeps working. Going forward staff use the tile only.
-- The Till report shows the two sources in separate columns so a day where
-- somebody did both is visible rather than silently double-counted.
--
--   expected_close = opening_float + cash_sales - cash_refunds - cash_drops
--                    - manual_out + manual_in
--
-- Rows are never deleted. A mistake is voided (voided_at + void_reason) and
-- stays on the record: this is a cash accountability trail, so who logged what
-- and who took it back both matter.

CREATE TABLE IF NOT EXISTS till_cash_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_number     text NOT NULL,
  location_slug   text NOT NULL,
  business_date   date NOT NULL,
  -- 'out' = cash leaving the drawer (bank drop, payout, to the safe).
  -- 'in'  = cash added to the drawer (change from the safe, float top-up).
  direction       text NOT NULL CHECK (direction IN ('out', 'in')),
  -- Constrained in the app (auth/src/lib/tillMovements.js) rather than by a
  -- CHECK, so adding a reason is a code change and not a migration.
  reason          text NOT NULL,
  -- Always a positive magnitude; `direction` carries the sign.
  amount          numeric(12,2) NOT NULL CHECK (amount > 0),
  note            text,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  voided_at       timestamptz,
  voided_by       uuid,
  voided_by_name  text,
  void_reason     text
);

-- The reconciler reads one club over a date range; the tile reads one club/day.
CREATE INDEX IF NOT EXISTS idx_till_cash_movements_club_date
  ON till_cash_movements(club_number, business_date);

ALTER TABLE till_cash_movements ENABLE ROW LEVEL SECURITY;

-- The Till tile itself. Lead and above: the people who actually open the
-- drawer. The Till REPORT stays manager+ (it is a variance report, gated in
-- routes/till.js), so a lead can log cash without seeing anyone's over/short.
--
-- The built-in 'custom' role is deliberately not seeded -- it reads per-person
-- staff.custom_tiles, so a row here would be inert. Grant it per person. Same
-- reasoning as 174_group_x_tiles.sql.
-- Idempotent: safe to re-run.

INSERT INTO permission_catalog (perm_key, label, category, min_tier) VALUES
  ('till', 'Till - Cash In/Out', 'Tools', 'lead')
ON CONFLICT (perm_key) DO NOTHING;

INSERT INTO role_tool_visibility (role, tool_key, visible)
SELECT r.role, 'till', true
FROM (VALUES
  ('lead'), ('manager'), ('marketing'), ('corporate'), ('director'), ('admin')
) AS r(role)
ON CONFLICT (role, tool_key) DO UPDATE SET visible = true;

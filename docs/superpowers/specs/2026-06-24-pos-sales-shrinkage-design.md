# POS Sales + Shrinkage Reports — Design

**Date:** 2026-06-24
**Branch:** `feat/pos-sales-shrinkage-reports`

## Goal

Move the financial views off the Inventory tool and into Reporting, and add a new
shrinkage/theft report. Two of the Inventory page's tabs (Sales, Employee Spend)
become one report under **Club Health** called **POS Sales**, which gains a third
sub-tab, **Shrinkage**, that surfaces physical-count variances to measure
misplacement and theft.

## Scope

### 1. Remove from `InventoryView.jsx`
- Drop the **Sales** tab (`tab='profit'`) and **Employee Spend** tab (`tab='employee'`).
- Remaining Inventory tabs: Inventory, To Order, Restock, Audit.

#### 1a. Strip price/cost/margin from the Items tab
Per the "financials only in Reporting" rule, the **Items** table loses its **Price**,
**Cost**, and **Margin** columns (headers + cells), and the admin consolidated-row
**Edit** (cost) button is removed — cost editing now lives only with the Audit tab.
Items tab keeps: Item, Category, UPC, On Hand, and the Adjust + History actions.
`canSeeFinancials` becomes unused once the Sales tab and Margin column are gone;
remove it (and `canSeeFinancialsFor` if orphaned). The `from`/`to` date state,
`QUICK_RANGES`/`quickRange`, the date-range filter row, `summary`/`salesSort`/
`empSpend` state, `cycleSalesSort`, and `displaySummary` all become dead once the
two tabs move — remove them. The `'profit'` case in the search-box gate goes too.

**Exceptions (stay on Inventory):** the **Audit** tab is unchanged — it is the
financial audit (negative-margin / no-cost flagging + Edit Cost), admin-only, and
explicitly kept on Inventory per the user's decision. The item **History** modal's
per-movement received-cost column also stays (it's a ledger drill-down, not the
catalog price display).
- Remove now-unused state/effects/render for those two tabs (`summary`, `salesSort`,
  `empSpend`, `displaySummary`, the profit/employee branches of the load effect,
  the profit/employee JSX, and the date-range filter row that was gated to those
  two tabs). The `from`/`to` state is no longer needed in InventoryView once these
  go (Audit/Items/Order/Restock don't use the date range), so remove it too.
- Backend `/inventory/summary` and `/inventory/employee-spend` endpoints are
  **unchanged** — only the UI consumer moves.

### 2. New report: **POS Sales** (`pos-sales`, Club Health group, manager+)
New component `portal/src/components/reports/PosSalesReport.jsx`, rendered by
`ReportingView` with the standard `{ startDate, endDate, locationSlug }` props and
the shell's date controls + location selector. Internally it has three sub-tabs:

- **Product Sales** — calls `getInventorySummary({ location_slug, from, to })`.
  Same table as the old Sales tab: Item / Units / Revenue / COGS / Profit / Margin,
  sortable, with the "no cost data" footnote.
- **Employee Spend** — calls `getInventoryEmployeeSpend({ location_slug, from, to })`.
  Same table + summary header as the old Employee Spend tab.
- **Shrinkage** — calls the new `getInventoryShrinkage` (below).

`locationSlug` from Reporting is `'all'` or a slug; map `'all'` → `''` when calling
the inventory endpoints (matches existing InventoryView behavior). `startDate`/
`endDate` are `YYYY-MM-DD`, same format the inventory endpoints already expect.

### 3. New backend endpoint: `GET /inventory/shrinkage` (manager+)
Query `inventory_movements` where `kind='count'` within `[from, to]` (on
`occurred_at`), filtered by `clubFilter(req)`, joined to `inventory_items`
(`item_name, upc, category, avg_unit_cost, last_unit_cost`).

Per count event compute:
- `expected` = `qty_after - qty_delta` (on-hand before the count)
- `counted` = `qty_after`
- `delta` = `qty_delta` (negative = missing/shrink, positive = found extra)
- `unit_cost` = `avg_unit_cost ?? last_unit_cost` (may be null)
- `impact` = `delta * unit_cost` ($; null when no cost on file)

Response:
```
{
  events: [{ id, item_id, item_name, item_upc, category, location_slug,
             created_by_name, occurred_at, expected, counted, delta,
             unit_cost, impact, note }],   // newest first
  by_employee: [{ name, events, net_units, shrink_value, found_value, net_value }],
  by_item:     [{ item_id, item_name, location_slug, events, net_units, net_value }],
  by_location: [{ location_slug, events, net_units, net_value }],
  totals: { events, shrink_value, found_value, net_value, no_cost_events }
}
```
- `shrink_value` = sum of negative `impact` (a negative number), `found_value` =
  sum of positive `impact`, `net_value` = sum of all `impact`.
- `no_cost_events` = count of events whose item has no cost (so the UI can flag
  that the $ figure understates reality, rather than implying $0 loss).

Add `getInventoryShrinkage(params)` to `portal/src/lib/api.js` →
`/inventory/shrinkage` + querystring (reuse `inventoryQs`).

### 4. Wire into `ReportingView.jsx`
- `ALL_REPORT_TILES`: add `{ key: 'pos-sales', label: 'POS Sales', desc: 'Retail, Staff & Shrinkage' }`.
- `REPORT_ICONS`: add a `pos-sales` SVG path (a cart/receipt outline).
- `REPORT_GROUPS` `health` group: append `'pos-sales'` to `reports`.
- `getReportTilesForRole`: add `'pos-sales'` to the `manager` allowlist (corp/
  admin/director already get all via default). Not added to `lead`.
- Render switch: `{activeReport === 'pos-sales' && <PosSalesReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />}`.
- POS Sales is NOT in the date-control-exclusion list and NOT in the
  kpis/audits/operations special-location list, so it gets the standard date
  range + location dropdown automatically. No change needed there.

## Shrinkage report UI (inside PosSalesReport)
- **Summary cards:** Net Variance $, Shrink $ (loss), Found $, # Count Events.
- **Sub-views / tables** (sortable):
  - **By Employee** — name, # counts, net units, shrink $, net $. The theft/
    accountability signal — who records the most loss. Sorted by shrink $ asc
    (biggest loss first).
  - **By Item** — item, club, net units, net $.
  - **Event log** — date, item, club, who, expected → counted, Δ units, $ impact,
    note. Newest first. Negative deltas in red.
- A banner when `no_cost_events > 0`: "N count events are on items with no cost on
  file — their dollar impact is not included."
- Negative `$`/units in red (`text-wcs-red`), positive in emerald, matching the
  existing report color language.

## Non-goals / YAGNI
- No DB migration (counts already log who/when/delta).
- No per-item "big loss" threshold flag (dollar ranking is enough for v1).
- No change to how counts are recorded; "adjustments" (Add stock) are excluded —
  only `kind='count'` is shrinkage.
- No CSV/PDF export in v1 unless the other reports' shared export is trivially
  reusable; not required by the request.

## Files touched
- `portal/src/components/InventoryView.jsx` (remove 2 tabs + dead code)
- `portal/src/components/reports/PosSalesReport.jsx` (new)
- `portal/src/components/ReportingView.jsx` (registry + render + role gate)
- `portal/src/lib/api.js` (add `getInventoryShrinkage`)
- `auth/src/routes/inventory.js` (add `GET /shrinkage`)

## Access
Manager and above (manager, director, corporate, admin). Custom roles get it only
if granted `pos-sales` in `custom_reports`. Leads and team members do not see it.

# Inventory: ABC Stock Push + Compliance Tab — Design

**Date:** 2026-06-25
**Branch:** `feat/inventory-abc-push-compliance`
**Author:** Justin + Claude

## Goal

Two additions to the existing Inventory tool:

1. **Push stock changes to ABC.** Every restock (add stock) and physical count
   (override) made in the portal is mirrored to ABC via the new `PUT Stock Level`
   endpoint, so ABC's `inStock` reflects what the teams are doing on the floor.
2. **Compliance tab** in the POS Sales report: a per-location scoreboard of how
   long it has been since each club last counted / restocked, so managers can see
   which teams are letting inventory counts slip.

The portal stays the source of truth for on-hand quantity; ABC is mirrored
**best-effort** (failures are flagged and retried, never block staff).

## Background (current state)

Two portal code paths change stock today, all in `auth/src/routes/inventory.js`,
each writing an `inventory_movements` ledger row:

| Path | Movement `kind` | Meaning |
|---|---|---|
| `POST /items/:id/adjust` with `qty_delta` | `adjustment` | add stock (restock) |
| `POST /items/:id/adjust` with `set_qty` | `count` | physical count (set exact) |
| `POST /invoices/:id/receive` (per line) | `received` | receive invoiced stock |
| POS sync (`inventorySync.js`) | `sale` / `return` | from ABC, **not** pushed back |

`inventory_items` already stores `sale_item_id` (= ABC `saleItemId`) and
`club_number`. ABC API auth lives in `auth/src/services/abcInventory.js`
(`ABC_BASE_URL`, `app_id` / `app_key` headers).

## Part 1 — Push restocks & counts to ABC

### ABC endpoint

```
PUT {ABC_BASE_URL}/{clubNumber}/club/items/{saleItemId}
Headers: app_id, app_key, Accept: application/json
Body: { action, quantity, [unitCost], [vendor], [reason], [notes] }
```

Note the path is `club/items` (singular) per the release notes, vs. the catalog
GET which is `clubs/items` (plural). Success → `status.message` "Sale Item updated
successfully."; failure → `status.messageCode` `API-CLU-ITM-0010` with detail in
`errorMessages[]`.

### Event → action mapping

| Portal event | `kind` | ABC `action` | `reason` | `quantity` |
|---|---|---|---|---|
| Manual add stock | `adjustment` | `add` | `Received` | the delta |
| Invoice receive (per line) | `received` | `add` | `Received` | line qty |
| Physical count | `count` | `override` | *(omitted)* | the counted total |

- **`add`** quantity must be a positive integer of 4 digits or fewer and non-zero
  (`API-CLU-ITM-0004` / `-0008`). We coerce to integer string; a non-integer or
  zero/negative delta is **skipped** (status `skipped`, no error).
- **`override`** quantity must be ≥ 0. ABC rejects an override equal to current
  `inStock` (`API-CLU-ITM-0007`) — we treat that specific code as **already
  synced** (success), not an error.
- **`reason`** for `add` must be one of `Received | Recovered | Transfer In`
  (`API-CLU-ITM-0011`). We send `Received`. For `override` we omit `reason`
  (the release notes only enumerate Add reasons); if ABC requires one we adjust
  after seeing the first real error.
- **`notes`** capped at 500 chars and stripped of ABC's banned characters
  (`# $ & * ( ) ` = { } : < > ? [ ] ; ' , /`). We send a short provenance note
  (e.g. `WCS Portal count by Jane D` sanitized).
- **`vendor`** sent only when known (invoice vendor). Omitted for counts/manual.

### unitCost — omit by default, env-flippable

Default: **omit `unitCost`** to avoid ABC's "must match a previously available
value" rule (`API-CLU-ITM-0005`). There is a real chance ABC won't accept a push
without it; rather than guess, we ship omitting it and **capture the exact ABC
error** so the first failures tell us definitively.

A single env flag makes the switch a config change, not a code change:

- `ABC_STOCK_PUSH_SEND_COST=1` → include `unitCost` = the item's
  `avg_unit_cost ?? last_unit_cost`, formatted to 2 decimals as a string.
- Unset/`0` (default) → omit `unitCost`.

### Best-effort + flag (the movement row is the queue)

The portal write commits first; the ABC PUT runs after, inline, and records its
result on the movement row. Migration **056** adds to `inventory_movements`:

| Column | Meaning |
|---|---|
| `abc_push_status` | `na` \| `pending` \| `synced` \| `failed` \| `skipped` |
| `abc_action` | `add` \| `override` (what we sent / would send) |
| `abc_push_error` | last ABC/transport error text (truncated) |
| `abc_push_attempts` | integer, bounded retry counter |
| `abc_pushed_at` | timestamptz of last attempt |

- POS-origin movements (`sale`/`return`) are inserted with `abc_push_status='na'`
  (they come *from* ABC; never pushed back).
- Stock-changing movements (`adjustment`/`count`/`received`) are inserted
  `pending`, then the inline push flips them to `synced` / `failed` / `skipped`.
  (Columns added by migration `056_inventory_abc_push.sql`.)
- Items with no `sale_item_id` → `skipped` (can't address ABC without it).

### Service: `auth/src/services/abcStockLevel.js`

Pure-ish module, ABC client injectable for tests:

- `buildStockBody({ action, quantity, unitCost, vendor, reason, notes })` — pure;
  applies the quantity/notes/cost rules above. Unit-tested.
- `classifyAbcResult(json)` → `{ ok, code, message, benign }` where `benign` is
  true for `API-CLU-ITM-0007` (override == current). Pure. Unit-tested.
- `putStockLevel(clubNumber, saleItemId, opts)` — performs the PUT, returns
  `{ status: 'synced'|'failed'|'skipped', code, error }`.
- `pushMovement(movementId)` — loads the movement + item, calls `putStockLevel`,
  writes the result columns back. Used inline and by the retry job.

### Wiring

In `inventory.js`, after each stock write succeeds, call `pushMovement` inline
(awaited but wrapped — its failure never throws out of the request). The response
gains a soft `abc_push` field (`{ status, error }`) so the UI can show a quiet
warning toast on `failed`; success is silent. Invoice receive pushes one movement
per applied line and returns an aggregate `abc_push` summary.

### Retry job

A node-cron entry in `inventorySync.js` (every ~15 min, opt-out
`INVENTORY_ABC_PUSH_DISABLED=1`) selects movements with
`abc_push_status='failed'` (or stuck `pending`) and `abc_push_attempts < 5`,
ordered oldest first, capped per run (e.g. 100), and re-runs `pushMovement`.
Bounded attempts prevent a permanently-rejecting row from looping forever; it
stays `failed` and visible.

## Part 2 — Compliance tab

### Endpoint: `GET /inventory/compliance`

`requireRole('manager')` (matches `/shrinkage` and `/summary`). Query:
`location_slug` (default all), `overdue_days` (default 30, clamped 1–365).

For each club with sellable inventory it returns:

```
{
  location_slug, club_number,
  last_count_at, days_since_count,
  last_restock_at, days_since_restock,
  tracked_items, never_counted_items,
  status            // 'ok' | 'overdue' | 'never'
}
```

- `last_count_at` = most recent `inventory_movements.occurred_at` where
  `kind='count'` for that club.
- `last_restock_at` = most recent where `kind in ('received','adjustment')`.
- `status` is driven by **count age** (the discipline being measured): `never`
  if the club has never counted, `overdue` if `days_since_count > overdue_days`,
  else `ok`. Restock is context only, never changes status.
- `never_counted_items` = sellable tracked items at the club with no `count`
  movement ever (helps a manager see scope).
- A corporate rollup row (`location_slug: 'all'`) summarizes worst-case /
  overdue count across clubs.

Data comes from `inventory_movements` joined to `inventory_items` for the
sellable filter; all 7 clubs are represented even if they have zero movements
(so an untouched club shows as `never`).

### Frontend

`portal/src/components/reports/PosSalesReport.jsx`:

- Add `{ key: 'compliance', label: 'Compliance' }` to `SUB_TABS`.
- New `getInventoryCompliance(params)` in `portal/src/lib/api.js`.
- Render a scoreboard table: Club · Last count · Days since · Last restock ·
  Tracked · Never counted · Status (green ✓ OK / yellow / red ✗ Overdue / grey
  Never). An "Overdue after N days" number input (default 30) refetches.
- Honors the report shell's location prop (a single-club view shows just that
  club; "All Locations" shows the 7-club board + rollup).

## Out of scope (YAGNI)

- Pulling ABC's `inStock` back into the portal to reconcile drift (portal stays
  authoritative; this is push-only).
- Pushing `subtract` actions (removals already flow through ABC POS).
- Per-item compliance drill-down (location scoreboard only for now).
- Configurable per-club cadence thresholds (one global `overdue_days` input).

## Testing

- **Unit (node --test):** `buildStockBody` (action/quantity/notes/cost rules,
  banned-char stripping, integer coercion, skip cases), `classifyAbcResult`
  (success, benign `-0007`, generic error envelope).
- **Manual:** with `ABC_STOCK_PUSH_*` against one club's real item — do an add,
  a count equal to current (expect benign), a count change; confirm the movement
  rows flip to `synced` and ABC `inStock` moves. Flip `ABC_STOCK_PUSH_SEND_COST`
  and compare. Verify the compliance board reflects the new count timestamps.

## Rollout

- Migration 056 applied to Supabase `ybopxxydsuwlbwxiuzve`.
- Auth service redeploy picks up the new routes, push wiring, and retry cron.
- No env required for default behavior; `ABC_STOCK_PUSH_SEND_COST=1` and
  `INVENTORY_ABC_PUSH_DISABLED=1` are optional toggles.
- Open PR; Justin merges (never auto-merge).

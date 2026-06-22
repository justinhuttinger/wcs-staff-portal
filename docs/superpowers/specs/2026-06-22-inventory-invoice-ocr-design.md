# Inventory Invoice OCR Auto-Restock — Design

Date: 2026-06-22
Branch: `worktree-inventory-invoice-ocr`
Status: Approved for implementation planning

## Problem

The inventory tool already supports vendor invoices as the cost basis for stock:
`POST /invoices` uploads a photo/PDF to Drive, and `POST /invoices/:id/receive`
applies each catalog-matched line to stock (writes a `received` movement, bumps
`qty_on_hand`, updates last + moving-average cost). The gap is that **every field
is typed by hand** — vendor, date, total, and each line (quantity, unit cost, and
the catalog-item match).

We want to snap or upload an invoice and have the line items, costs, and catalog
matches extracted automatically, then restock after a human confirm.

## Goals

- Upload or photograph an invoice (one or many pages) and auto-extract the header
  and line items.
- Auto-match each line to the club's ABC catalog item; surface confidence.
- Human reviews/corrects matches, then taps the existing **Receive** to restock.
- Track a multi-page order as a single invoice via its order number.
- Learn vendor product-name → catalog-item mappings so repeat invoices auto-match.

## Non-goals (YAGNI)

- No fully-automatic receive — stock only changes after the user confirms.
- No new LLM/vision vendor — reuse the existing Anthropic SDK + API key.
- No editing/creating the ABC catalog from this flow. Unmatched products must
  already exist in ABC (catalog remains ABC's source of truth).
- No stock **removals** via invoice (removals stay in ABC POS, per existing design).
- No matching done by the model — extraction is the model's job, matching is
  deterministic code.

## Key decisions (from brainstorm)

1. **Parse then confirm** — extraction never auto-receives; lines sit unreceived
   until the user taps Receive (reuses existing `/receive`).
2. **Review screen picks the match** — unmatched/low-confidence lines get a
   searchable catalog picker; confirmed matches are remembered per vendor.
3. **Order number is the invoice identity.** Order numbers are globally unique per
   order (same number across pages = same order). Uploading a page whose order
   number matches an existing invoice **attaches to that invoice** rather than
   creating a duplicate.
4. **Multiple pages per invoice.** One invoice owns many page files; pages can be
   added later.
5. **Fresh parse on re-upload.** Adding a page (even to a received invoice)
   re-parses all pages and regenerates the **unreceived** draft lines.
   **Already-received lines stay received and are never re-applied** — stock is
   never double-counted.

## Architecture

Server: `auth` service (Express), routes in `auth/src/routes/inventory.js`.
Vision: existing Anthropic SDK via a new thin helper (mirrors
`auth/src/mastermind/anthropic.js`). Default model: `claude-sonnet-4-6`.
Matching: new pure module `auth/src/services/inventoryMatch.js` (unit-testable).
Storage: Google Drive for page files (reuse existing upload logic), Supabase for
records.
Frontend: existing inventory invoice UI (desktop tile + mobile sheet, both via
`createPortal` to body per the established inventory pattern).

### Flow

1. **Upload/snap one or more pages** → `POST /invoices` (multipart, multiple files).
   Resolve-or-create the invoice by order number, store each page in
   `inventory_invoice_files`. (Order number may be unknown at upload time; it is
   backfilled by parse and the invoice re-keyed/merged if it then collides.)
2. **Parse all pages together** → `POST /invoices/:id/parse`. Sends every page
   image/PDF to Claude vision in one request, gets structured JSON, backfills the
   header, regenerates unreceived draft lines, runs the matcher.
3. **Match (code)** → per line: UPC exact → vendor-alias → normalized-name fuzzy →
   unmatched. Each line records `match_confidence` and `match_source`.
4. **Review + Receive** → user fixes matches in the invoice detail screen and taps
   the existing Receive. Confirming a match writes/updates a vendor alias.

## Data model — migration 040

New table — invoice pages:

```sql
CREATE TABLE inventory_invoice_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  uuid NOT NULL REFERENCES inventory_invoices(id) ON DELETE CASCADE,
  file_link   text NOT NULL,
  file_name   text,
  page_no     integer,
  mime_type   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_inventory_invoice_files_invoice ON inventory_invoice_files(invoice_id);
```

New table — learned vendor → catalog-item mappings:

```sql
CREATE TABLE inventory_vendor_aliases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_number text,
  vendor      text NOT NULL,           -- normalized (lower, trimmed)
  alias_text  text NOT NULL,           -- normalized vendor product name/SKU
  upc         text,
  item_id     uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_number, vendor, alias_text)
);
CREATE INDEX idx_inventory_vendor_aliases_lookup
  ON inventory_vendor_aliases(club_number, vendor);
```

Column additions:

```sql
ALTER TABLE inventory_invoices
  ADD COLUMN parse_status text,        -- pending | parsed | error
  ADD COLUMN parsed_at    timestamptz,
  ADD COLUMN parse_error  text;

ALTER TABLE inventory_invoice_items
  ADD COLUMN match_confidence numeric, -- 0..1; null once user-confirmed
  ADD COLUMN match_source     text;    -- upc | alias | fuzzy | manual
```

- Order number reuses the existing `inventory_invoices.invoice_number`.
- Existing `file_link`/`file_name` columns stay (back-compat, hold page 1); new
  uploads also write a row in `inventory_invoice_files`.
- Enable RLS on both new tables (no policy), per migration 035 convention.

## API endpoints (under `/inventory`, manager+)

- `POST /invoices` — **multiple files** (`upload.array`). Resolve-or-create by
  order number; store each page. Returns the invoice with its files.
- `POST /invoices/:id/parse` — vision-extract all pages, backfill header,
  regenerate unreceived draft lines, run matcher. Idempotent / re-runnable.
  Sets `parse_status`. Received lines are preserved.
- `POST /invoices/:id/files` — attach more page(s) later; auto-triggers re-parse.
- `DELETE /invoices/:id/files/:fileId` — remove a page; re-parse.
- `POST /invoices/:id/items`, `DELETE .../items/:lineId`, `DELETE /invoices/:id`
  — unchanged.
- `POST /invoices/:id/receive` — unchanged behavior, **plus** for each confirmed,
  matched line it upserts an `inventory_vendor_aliases` row
  (vendor + line description/upc → item_id).

## Extraction

One Anthropic `messages.create` call. System prompt instructs strict JSON output:

```json
{
  "vendor": "string|null",
  "order_number": "string|null",
  "invoice_date": "YYYY-MM-DD|null",
  "total": "number|null",
  "lines": [
    { "description": "string", "upc": "string|null",
      "quantity": "number", "unit_cost": "number|null",
      "line_total": "number|null" }
  ]
}
```

- Images sent as image content blocks; PDFs as document content blocks.
- `unit_cost` derived from `line_total / quantity` when only the line total is
  present.
- Tolerant of missing fields; never throws on partial data.
- Parse failures set `parse_status='error'` + `parse_error`; the invoice remains
  fully editable by hand (today's manual flow is the floor — never worse).

## Matching — `inventoryMatch.js` (pure, unit-tested)

Input: a parsed line + the club's sellable catalog + vendor aliases.
Resolution order, first hit wins:

1. **UPC exact** — line UPC equals a catalog item UPC (with leading-zero variants,
   matching the existing scanner's lookup). `match_source='upc'`, confidence 1.0.
2. **Vendor alias** — (club, vendor, normalized description/upc) hit in
   `inventory_vendor_aliases`. `match_source='alias'`, confidence 1.0.
3. **Fuzzy name** — normalized token-overlap / trigram similarity vs catalog item
   names; best score above a threshold. `match_source='fuzzy'`, confidence = score.
4. **Unmatched** — no `item_id`; surfaced for manual pick.

Normalization: lowercase, strip punctuation, collapse whitespace.

## UI

Invoice detail screen (desktop tile + mobile sheet, `createPortal` to body):

- **Page strip**: thumbnails of each page; "Add page" via camera (mobile) or file
  picker (desktop); delete page.
- **Parse state**: spinner while parsing; error banner with manual fallback.
- **Lines table**: per-line match picker (searchable catalog dropdown) +
  confidence pill (green confirmed/high, amber low, red unmatched); editable qty
  and unit cost.
- **Receive** button (existing) applies matched lines.

Camera capture on mobile uses `<input type="file" accept="image/*" capture>`.

## Error handling

- Vision unavailable / junk output → `parse_status='error'`; manual entry still works.
- No order number found → generate a placeholder (e.g. `AUTO-<timestamp>`); user
  can edit; if edited to collide with an existing invoice, merge.
- Re-parse never mutates received lines and never double-applies stock.
- Re-parse **replaces all unreceived draft lines** (the "fresh parse" semantic).
  Matching re-runs, so alias/UPC hits are restored automatically; a manual pick
  that was made but not yet received is re-derived from matching and may need
  re-confirming. Acceptable for v1 — confirmed (received) work is always safe.
- Drive upload failure → existing error path (unchanged).

## Testing

Unit:
- `inventoryMatch`: UPC (incl. leading-zero), alias hit, fuzzy above/below
  threshold, unmatched.
- Order-number resolve-or-create: new vs existing, placeholder generation.
- Re-parse: preserves received lines, regenerates only unreceived ones, no
  double-count.

Integration:
- `POST /invoices/:id/parse` with a **mocked** Anthropic client returning fixture
  JSON → asserts header backfill, draft lines created, matches assigned.
- `POST /invoices/:id/receive` upserts vendor aliases for confirmed matches.

## Rollout

- Migration 040 applied to Supabase project `ybopxxydsuwlbwxiuzve`.
- New env (optional): reuse `ANTHROPIC_API_KEY`; opt-out `INVENTORY_OCR_DISABLED=1`.
- Ships behind the existing manager+ gate on `/inventory`; no separate flag needed
  since parse is user-initiated and the manual flow remains intact.

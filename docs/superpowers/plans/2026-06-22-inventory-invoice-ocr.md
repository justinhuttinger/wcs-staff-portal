# Inventory Invoice OCR Auto-Restock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Snap/upload a vendor invoice (one or many pages), extract header + line items with Claude vision, auto-match each line to the ABC catalog, and restock on a human confirm.

**Architecture:** Extraction is the model's job (one Anthropic vision call over all pages → strict JSON). Matching is deterministic, pure, unit-tested code (UPC → vendor alias → fuzzy name). Persistence and the receive/restock machinery reuse the existing inventory invoice endpoints. Multi-page orders are grouped by order number; re-parse regenerates only unreceived lines.

**Tech Stack:** Node 20 / Express (`auth` service), `@anthropic-ai/sdk` (already a dep), Supabase (service-role), `multer` memoryStorage, React + Tailwind (`portal`), Node built-in test runner (`node --test`).

## Global Constraints

- Tests use Node's built-in runner: `const test = require('node:test')`, `const assert = require('node:assert/strict')`. Run a single file with `node --test path/to/file.test.js`. No jest/vitest.
- The `auth` router `/inventory` is already gated `authenticate` + `requireRole('manager')`. Do not add per-route auth.
- Portal DB access is 100% service-role via `supabaseAdmin`. New tables get RLS enabled, no policy (migration 035 convention).
- Reuse the existing Anthropic key resolution: `process.env.ANTHROPIC_API_KEY` (mirror `auth/src/mastermind/anthropic.js`). Opt-out env: `INVENTORY_OCR_DISABLED=1`.
- Never use em-dashes in user-facing copy.
- Stock is never changed without a user confirm; re-parse never mutates received lines and never double-applies stock.
- Vendor/club helpers already exist in `auth/src/routes/inventory.js`: `num`, `UUID_RE`, `SLUG_CLUB_MAP`, `CLUB_TO_SLUG`, `getAccessToken` (from `./googleBusiness`), `getUploadFolderId`, `decorateItem`, `fetchAllRows`. Reuse them.
- Migrations are applied to Supabase project `ybopxxydsuwlbwxiuzve`. The next free number is **040** (038 + 039 already applied).

---

## Task 1: Migration 040 — schema

**Files:**
- Create: `auth/migrations/040_inventory_invoice_ocr.sql`

**Interfaces:**
- Produces (DB): table `inventory_invoice_files`, table `inventory_vendor_aliases`, columns `inventory_invoices.parse_status|parsed_at|parse_error`, columns `inventory_invoice_items.match_confidence|match_source`.

- [ ] **Step 1: Write the migration SQL**

```sql
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
```

- [ ] **Step 2: Apply the migration**

During execution, apply via the Supabase MCP `apply_migration` tool (project `ybopxxydsuwlbwxiuzve`, name `040_inventory_invoice_ocr`) using the SQL above, OR `psql "$SUPABASE_DB_URL" -f auth/migrations/040_inventory_invoice_ocr.sql`.
Expected: success; `list_tables` shows the two new tables.

- [ ] **Step 3: Commit**

```bash
git add auth/migrations/040_inventory_invoice_ocr.sql
git commit -m "feat(inventory): migration 040 - invoice pages, vendor aliases, parse/match columns"
```

---

## Task 2: Order-number normalization (pure)

**Files:**
- Create: `auth/src/utils/inventoryInvoiceKey.js`
- Test: `auth/src/utils/inventoryInvoiceKey.test.js`

**Interfaces:**
- Produces: `normalizeOrderNumber(raw: string|null) => string|null` — uppercased, trimmed, internal whitespace collapsed, surrounding punctuation stripped; returns `null` for empty/nullish. `generatePlaceholderOrderNumber(nowIso: string) => string` — returns `AUTO-<digits>` derived from the ISO timestamp (no `Date.now()` inside, so it stays testable).

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeOrderNumber, generatePlaceholderOrderNumber } = require('./inventoryInvoiceKey')

test('normalizeOrderNumber: trims, uppercases, collapses whitespace', () => {
  assert.equal(normalizeOrderNumber('  po 12 345 '), 'PO 12 345')
  assert.equal(normalizeOrderNumber('inv-0099'), 'INV-0099')
})

test('normalizeOrderNumber: strips surrounding punctuation', () => {
  assert.equal(normalizeOrderNumber('#A1009.'), 'A1009')
})

test('normalizeOrderNumber: empty/nullish -> null', () => {
  for (const v of [null, undefined, '', '   ', '#']) assert.equal(normalizeOrderNumber(v), null)
})

test('generatePlaceholderOrderNumber: derives AUTO- key from iso, no wall clock', () => {
  const a = generatePlaceholderOrderNumber('2026-06-22T17:04:05.000Z')
  assert.match(a, /^AUTO-\d+$/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test auth/src/utils/inventoryInvoiceKey.test.js`
Expected: FAIL — Cannot find module './inventoryInvoiceKey'.

- [ ] **Step 3: Write the implementation**

```js
// Pure helpers for invoice order-number identity. Order numbers group the pages
// of one delivery into a single invoice; they are globally unique per order.

function normalizeOrderNumber(raw) {
  if (raw == null) return null
  const s = String(raw).replace(/\s+/g, ' ').trim().replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '').trim()
  return s ? s.toUpperCase() : null
}

function generatePlaceholderOrderNumber(nowIso) {
  const digits = String(nowIso || '').replace(/\D/g, '') || '0'
  return `AUTO-${digits}`
}

module.exports = { normalizeOrderNumber, generatePlaceholderOrderNumber }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test auth/src/utils/inventoryInvoiceKey.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add auth/src/utils/inventoryInvoiceKey.js auth/src/utils/inventoryInvoiceKey.test.js
git commit -m "feat(inventory): order-number normalization helper"
```

---

## Task 3: Line matcher (pure)

**Files:**
- Create: `auth/src/utils/inventoryMatch.js`
- Test: `auth/src/utils/inventoryMatch.test.js`

**Interfaces:**
- Consumes: catalog items shaped like `inventory_items` rows (`{ id, item_name, upc }`); vendor aliases shaped `{ alias_text, upc, item_id }` (alias_text already normalized).
- Produces:
  - `normalizeText(s) => string` — lowercased, punctuation→space, whitespace collapsed, trimmed.
  - `upcVariants(upc) => string[]` — the UPC plus leading-zero-stripped and zero-padded(12) variants, deduped, empties removed.
  - `matchLine(line, { items, aliases }) => { item_id: string|null, match_source: 'upc'|'alias'|'fuzzy'|null, match_confidence: number|null }` where `line = { description, upc }`. Resolution order: UPC exact (1.0) → alias (1.0) → fuzzy name above threshold 0.6 (score) → unmatched (null/null/null).

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeText, upcVariants, matchLine } = require('./inventoryMatch')

const items = [
  { id: 'i-shaker', item_name: 'WCS Shaker Bottle Black', upc: '195602030729' },
  { id: 'i-bar',    item_name: 'Chocolate Protein Bar 60g', upc: '0090210' },
]
const aliases = [{ alias_text: 'choc prot bar', upc: null, item_id: 'i-bar' }]

test('normalizeText lowercases and strips punctuation', () => {
  assert.equal(normalizeText('  WCS-Shaker (Black)! '), 'wcs shaker black')
})

test('upcVariants includes leading-zero and padded forms', () => {
  const v = upcVariants('90210')
  assert.ok(v.includes('90210'))
  assert.ok(v.includes('000000090210'))
})

test('matchLine: exact UPC wins with confidence 1', () => {
  const r = matchLine({ description: 'whatever', upc: '195602030729' }, { items, aliases })
  assert.deepEqual(r, { item_id: 'i-shaker', match_source: 'upc', match_confidence: 1 })
})

test('matchLine: UPC variant (leading zero) matches', () => {
  const r = matchLine({ description: 'bar', upc: '90210' }, { items, aliases })
  assert.equal(r.item_id, 'i-bar')
  assert.equal(r.match_source, 'upc')
})

test('matchLine: alias hit when no UPC', () => {
  const r = matchLine({ description: 'Choc Prot Bar', upc: null }, { items, aliases })
  assert.deepEqual(r, { item_id: 'i-bar', match_source: 'alias', match_confidence: 1 })
})

test('matchLine: fuzzy name above threshold', () => {
  const r = matchLine({ description: 'shaker bottle wcs black', upc: null }, { items, aliases: [] })
  assert.equal(r.item_id, 'i-shaker')
  assert.equal(r.match_source, 'fuzzy')
  assert.ok(r.match_confidence >= 0.6 && r.match_confidence <= 1)
})

test('matchLine: unmatched below threshold', () => {
  const r = matchLine({ description: 'garden hose 50ft', upc: null }, { items, aliases: [] })
  assert.deepEqual(r, { item_id: null, match_source: null, match_confidence: null })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test auth/src/utils/inventoryMatch.test.js`
Expected: FAIL — Cannot find module './inventoryMatch'.

- [ ] **Step 3: Write the implementation**

```js
// Deterministic invoice-line -> catalog-item matcher. Pure and unit-tested.
// Resolution order: UPC exact -> learned vendor alias -> fuzzy name -> unmatched.

const FUZZY_THRESHOLD = 0.6

function normalizeText(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function upcVariants(upc) {
  const base = String(upc || '').replace(/\D/g, '')
  if (!base) return []
  const set = new Set([base, base.replace(/^0+/, ''), base.padStart(12, '0')])
  set.delete('')
  return [...set]
}

// Jaccard token overlap — order-independent, cheap, good enough for product names.
function tokenScore(a, b) {
  const sa = new Set(normalizeText(a).split(' ').filter(Boolean))
  const sb = new Set(normalizeText(b).split(' ').filter(Boolean))
  if (!sa.size || !sb.size) return 0
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter++
  return inter / (sa.size + sb.size - inter)
}

function matchLine(line, { items = [], aliases = [] } = {}) {
  const miss = { item_id: null, match_source: null, match_confidence: null }

  // 1. UPC exact (with leading-zero/padded variants on both sides).
  const lineUpcs = new Set(upcVariants(line.upc))
  if (lineUpcs.size) {
    for (const it of items) {
      if (upcVariants(it.upc).some(v => lineUpcs.has(v))) {
        return { item_id: it.id, match_source: 'upc', match_confidence: 1 }
      }
    }
  }

  // 2. Vendor alias (alias_text already normalized; also allow UPC alias).
  const descNorm = normalizeText(line.description)
  for (const a of aliases) {
    if ((a.alias_text && a.alias_text === descNorm) ||
        (a.upc && lineUpcs.has(String(a.upc).replace(/\D/g, '')))) {
      return { item_id: a.item_id, match_source: 'alias', match_confidence: 1 }
    }
  }

  // 3. Fuzzy name.
  let best = miss, bestScore = 0
  for (const it of items) {
    const score = tokenScore(line.description, it.item_name)
    if (score > bestScore) { bestScore = score; best = { item_id: it.id, match_source: 'fuzzy', match_confidence: +score.toFixed(2) } }
  }
  return bestScore >= FUZZY_THRESHOLD ? best : miss
}

module.exports = { normalizeText, upcVariants, matchLine, FUZZY_THRESHOLD }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test auth/src/utils/inventoryMatch.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add auth/src/utils/inventoryMatch.js auth/src/utils/inventoryMatch.test.js
git commit -m "feat(inventory): deterministic invoice-line catalog matcher"
```

---

## Task 4: Vision extraction service

**Files:**
- Create: `auth/src/services/inventoryInvoiceParse.js`
- Test: `auth/src/services/inventoryInvoiceParse.test.js`

**Interfaces:**
- Consumes: `@anthropic-ai/sdk` (dep present); Drive file bytes via the page `file_link`.
- Produces:
  - `parseExtractionText(text: string) => { vendor, order_number, invoice_date, total, lines: Array<{ vendor_sku, description, upc, quantity, unit_cost, line_total }> }` — pure: parses model output (tolerates ```json fences and surrounding prose), coerces numbers via the existing `num` semantics, derives `unit_cost = line_total/quantity` when unit_cost is missing, drops lines with no description and no quantity, passes through `vendor_sku` (trimmed, else null). Throws `Error('No JSON object found')` only when there is no `{...}` at all. NOTE: filtering to product (Sale) rows and cleaning lot/exp text are the MODEL's job via the system prompt; the parser does not filter by row type.
  - `driveDownloadUrl(fileLink: string) => string|null` — pure: maps a `https://drive.google.com/file/d/<id>/view` link to the API download URL `https://www.googleapis.com/drive/v3/files/<id>?alt=media&supportsAllDrives=true`; returns null if no id.
  - `async extractFromPages(pages: Array<{ file_link, mime_type }>, { token, client }) => parsed` — fetches each page's bytes, builds an Anthropic message with image/document blocks, calls `client.messages.create`, returns `parseExtractionText(resp text)`. `client`/`token` are injected so tests pass a fake client.
  - `getClient() => Anthropic|null` and `EXTRACTION_MODEL = 'claude-sonnet-4-6'`.

- [ ] **Step 1: Write the failing test (pure parsers only)**

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseExtractionText, driveDownloadUrl } = require('./inventoryInvoiceParse')

test('parseExtractionText: parses fenced json, derives unit_cost, keeps vendor_sku', () => {
  const out = parseExtractionText('Here you go:\n```json\n' + JSON.stringify({
    vendor: 'Acme', order_number: 'PO-9', invoice_date: '2026-06-20', total: 50,
    lines: [{ vendor_sku: 'S1181001', description: 'Bars', upc: '12', quantity: 5, line_total: 25 }],
  }) + '\n```')
  assert.equal(out.vendor, 'Acme')
  assert.equal(out.order_number, 'PO-9')
  assert.equal(out.lines.length, 1)
  assert.equal(out.lines[0].vendor_sku, 'S1181001')
  assert.equal(out.lines[0].unit_cost, 5) // 25/5
})

test('parseExtractionText: drops empty lines, keeps unit_cost when given', () => {
  const out = parseExtractionText(JSON.stringify({
    lines: [
      { description: '', upc: null, quantity: null },
      { description: 'Shaker', quantity: 2, unit_cost: 3.5 },
    ],
  }))
  assert.equal(out.lines.length, 1)
  assert.equal(out.lines[0].unit_cost, 3.5)
})

test('parseExtractionText: no json -> throws', () => {
  assert.throws(() => parseExtractionText('sorry, cannot read this'), /No JSON object found/)
})

test('driveDownloadUrl: maps view link to alt=media', () => {
  assert.equal(
    driveDownloadUrl('https://drive.google.com/file/d/ABC123/view'),
    'https://www.googleapis.com/drive/v3/files/ABC123?alt=media&supportsAllDrives=true')
  assert.equal(driveDownloadUrl('https://example.com/x'), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test auth/src/services/inventoryInvoiceParse.test.js`
Expected: FAIL — Cannot find module './inventoryInvoiceParse'.

- [ ] **Step 3: Write the implementation**

```js
// Claude vision extraction for vendor invoices. The pure parsers are unit-tested;
// the network/SDK calls are thin and dependency-injected for testability.

const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk').Anthropic || require('@anthropic-ai/sdk')

const EXTRACTION_MODEL = 'claude-sonnet-4-6'
const apiKey = process.env.ANTHROPIC_API_KEY || process.env.MASTERMIND_ANTHROPIC_API_KEY

function getClient() { return apiKey ? new Anthropic({ apiKey }) : null }

const toNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null }

function parseExtractionText(text) {
  const s = String(text || '')
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : s
  const start = body.indexOf('{'); const end = body.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON object found')
  const obj = JSON.parse(body.slice(start, end + 1))
  const lines = (Array.isArray(obj.lines) ? obj.lines : []).map(l => {
    const quantity = toNum(l.quantity)
    const lineTotal = toNum(l.line_total)
    let unitCost = toNum(l.unit_cost)
    if (unitCost == null && lineTotal != null && quantity) unitCost = +(lineTotal / quantity).toFixed(4)
    return {
      vendor_sku: l.vendor_sku ? String(l.vendor_sku).trim().slice(0, 80) || null : null,
      description: l.description ? String(l.description).slice(0, 300) : '',
      upc: l.upc ? String(l.upc).replace(/\D/g, '') || null : null,
      quantity, unit_cost: unitCost, line_total: lineTotal,
    }
  }).filter(l => l.description || l.quantity != null)
  return {
    vendor: obj.vendor ? String(obj.vendor).slice(0, 200) : null,
    order_number: obj.order_number != null ? String(obj.order_number) : null,
    invoice_date: obj.invoice_date ? String(obj.invoice_date).slice(0, 10) : null,
    total: toNum(obj.total),
    lines,
  }
}

function driveDownloadUrl(fileLink) {
  const m = String(fileLink || '').match(/\/file\/d\/([^/]+)/)
  return m ? `https://www.googleapis.com/drive/v3/files/${m[1]}?alt=media&supportsAllDrives=true` : null
}

const SYSTEM = [
  'You read vendor invoices/packing slips for a retail store and return STRICT JSON only.',
  'Schema: {"vendor":string|null,"order_number":string|null,"invoice_date":"YYYY-MM-DD"|null,',
  '"total":number|null,"lines":[{"vendor_sku":string|null,"description":string,"upc":string|null,',
  '"quantity":number,"unit_cost":number|null,"line_total":number|null}]}.',
  'order_number is the order/PO number, usually top-right (e.g. labeled "Order #").',
  'total is the grand total, which may appear only on the LAST page.',
  'INCLUDE ONLY purchasable PRODUCT lines. OMIT any subtotal, discount, shipping, tax,',
  'or summary rows (e.g. rows whose Type is Subtotal/Discount/Shipping).',
  'vendor_sku is the vendor item/SKU number on the line (e.g. an "Item" column value like S1181001); null if none.',
  'description is the clean product name only; EXCLUDE trailing lot/expiration text',
  'such as "4 ea - Lot#: 510731049 ExpDate: Aug 1, 2027".',
  'Use the per-unit price for unit_cost; if only an extended/line total is shown, leave unit_cost null and set line_total.',
  'Do not invent values. Return ONLY the JSON object, no prose.',
  '',
  'Example: a line shown as',
  '"1  Sale  S1181001  Top Secret Nutrition Fireball L-Carnitine Liquid w/ Paradoxine 16oz Cherry',
  ' 4 ea - Lot#: 510731049 ExpDate: Aug 1, 2027   $14.61   4 ea   $58.44"',
  'becomes {"vendor_sku":"S1181001","description":"Top Secret Nutrition Fireball L-Carnitine Liquid w/ Paradoxine 16oz Cherry",',
  '"upc":null,"quantity":4,"unit_cost":14.61,"line_total":58.44}.',
  'A "Subtotal" or "Shipping Charge" row is NOT a product and must be omitted.',
].join('\n')

async function extractFromPages(pages, { token, client }) {
  const c = client || getClient()
  if (!c) throw new Error('Anthropic client not initialized (ANTHROPIC_API_KEY missing)')
  const content = []
  for (const p of pages) {
    const url = driveDownloadUrl(p.file_link)
    if (!url) continue
    const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + token } })
    const buf = Buffer.from(await resp.arrayBuffer())
    const b64 = buf.toString('base64')
    const mime = p.mime_type || 'image/jpeg'
    if (mime === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } })
    } else {
      content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: b64 } })
    }
  }
  content.push({ type: 'text', text: 'Extract this invoice as JSON.' })
  const resp = await c.messages.create({
    model: EXTRACTION_MODEL, max_tokens: 4096, system: SYSTEM,
    messages: [{ role: 'user', content }],
  })
  const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
  return parseExtractionText(text)
}

module.exports = { parseExtractionText, driveDownloadUrl, extractFromPages, getClient, EXTRACTION_MODEL }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test auth/src/services/inventoryInvoiceParse.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/inventoryInvoiceParse.js auth/src/services/inventoryInvoiceParse.test.js
git commit -m "feat(inventory): Claude vision invoice extraction service"
```

---

## Task 5: Multi-file upload + resolve-or-create by order number

**Files:**
- Modify: `auth/src/routes/inventory.js` (the `uploadSingle` helper + `POST /invoices` ~514-620, the Drive upload block, and `GET /invoices` ~524-544)

**Interfaces:**
- Consumes: `normalizeOrderNumber`, `generatePlaceholderOrderNumber` (Task 2).
- Produces: `POST /invoices` accepts `files` (1..n) and a single `file` (back-compat); resolves an existing invoice by normalized order number when provided, else creates one; writes each uploaded file to Drive and inserts an `inventory_invoice_files` row (plus mirrors page 1 into `inventory_invoices.file_link/file_name`). `GET /invoices` returns `files` and the new columns. A reusable internal `uploadBufferToDrive(buffer, originalname, mime, token, folderId) => { fileLink, fileName, mime }`.

- [ ] **Step 1: Add the require and a Drive-upload helper**

At the top requires, add:
```js
const { normalizeOrderNumber, generatePlaceholderOrderNumber } = require('../utils/inventoryInvoiceKey')
```

Refactor the existing inline Drive upload (currently inside `POST /invoices`) into a module-level helper placed just below `uploadSingle`:
```js
async function uploadBufferToDrive(buffer, originalname, mime, token, folderId) {
  const name = (originalname || 'invoice').replace(/[\r\n"]/g, '').slice(0, 200)
  const boundary = '----wcsInventoryUploadBoundary'
  const metadata = JSON.stringify({ name, parents: [folderId] })
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, 'utf8')
  const post = Buffer.from(`\r\n--${boundary}--`, 'utf8')
  const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: Buffer.concat([pre, buffer, post]),
  })
  const created = await up.json()
  if (created.error) { const e = new Error(created.error.message || 'Drive upload failed'); e.status = up.status || 500; throw e }
  await fetch(`https://www.googleapis.com/drive/v3/files/${created.id}/permissions?supportsAllDrives=true`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  }).catch(() => {})
  return { fileLink: `https://drive.google.com/file/d/${created.id}/view`, fileName: created.name, mime }
}

const ALLOWED_MIME = /^image\/(?!svg)|^application\/pdf$/
function uploadFiles(req, res, next) {
  upload.array('files', 12)(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE'
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'A file exceeds the 50 MB limit' : 'Upload failed' })
    }
    next()
  })
}
```

- [ ] **Step 2: Rewrite `POST /invoices` to multi-file + resolve-or-create**

Replace the handler signature `router.post('/invoices', uploadSingle, ...)` with `router.post('/invoices', uploadFiles, ...)` and the body with:
```js
router.post('/invoices', uploadFiles, async (req, res) => {
  try {
    const vendor = typeof req.body.vendor === 'string' ? req.body.vendor.trim() : ''
    if (!vendor) return res.status(400).json({ error: 'Vendor is required' })

    let clubNumber = null
    if (req.body.location_slug && req.body.location_slug !== 'all') {
      clubNumber = SLUG_CLUB_MAP[String(req.body.location_slug).toLowerCase()]
      if (!clubNumber) return res.status(400).json({ error: 'Unknown location' })
    }

    const files = req.files && req.files.length ? req.files : (req.file ? [req.file] : [])
    for (const f of files) {
      if (!ALLOWED_MIME.test(f.mimetype || '')) return res.status(400).json({ error: 'Only photo or PDF files are allowed' })
    }

    // Resolve-or-create by normalized order number.
    const orderNorm = normalizeOrderNumber(req.body.invoice_number)
    let invoice = null
    if (orderNorm) {
      const { data: existing } = await supabaseAdmin
        .from('inventory_invoices').select('*')
        .ilike('invoice_number', orderNorm).limit(1).maybeSingle()
      invoice = existing || null
    }
    if (!invoice) {
      const { data, error } = await supabaseAdmin.from('inventory_invoices').insert({
        club_number: clubNumber,
        vendor,
        invoice_number: orderNorm,
        invoice_date: req.body.invoice_date || null,
        total: num(req.body.total),
        notes: req.body.notes ? String(req.body.notes).slice(0, 2000) : null,
        parse_status: files.length ? 'pending' : null,
        created_by: req.staff.id,
        created_by_name: req.staff.display_name || req.staff.email || null,
      }).select().single()
      if (error) throw error
      invoice = data
    }

    // Upload each page to Drive + record it.
    if (files.length) {
      const folderId = await getUploadFolderId()
      if (!folderId) return res.status(400).json({ error: 'Invoice upload folder is not configured yet (set app_config key inventory_upload_folder_id or INVENTORY_UPLOAD_FOLDER_ID)' })
      const token = await getAccessToken()
      const { count: existingPages } = await supabaseAdmin
        .from('inventory_invoice_files').select('id', { count: 'exact', head: true }).eq('invoice_id', invoice.id)
      let pageNo = existingPages || 0
      for (const f of files) {
        try {
          const up = await uploadBufferToDrive(f.buffer, f.originalname, f.mimetype, token, folderId)
          pageNo++
          await supabaseAdmin.from('inventory_invoice_files').insert({
            invoice_id: invoice.id, file_link: up.fileLink, file_name: up.fileName, page_no: pageNo, mime_type: up.mime,
          })
          if (!invoice.file_link) {
            await supabaseAdmin.from('inventory_invoices').update({ file_link: up.fileLink, file_name: up.fileName }).eq('id', invoice.id)
            invoice.file_link = up.fileLink
          }
        } catch (e) { return res.status(e.status || 500).json({ error: e.message }) }
      }
    }

    const { data: full } = await supabaseAdmin
      .from('inventory_invoices').select('*, inventory_invoice_items(*), inventory_invoice_files(*)')
      .eq('id', invoice.id).single()
    res.status(201).json({ invoice: shapeInvoice(full) })
  } catch (err) {
    console.error('[Inventory] invoice create error:', err.message)
    res.status(500).json({ error: err.message })
  }
})
```

- [ ] **Step 3: Add a `shapeInvoice` helper and use it in `GET /invoices`**

Add near `decorateItem`:
```js
function shapeInvoice(inv) {
  if (!inv) return inv
  return {
    ...inv,
    location_slug: inv.club_number ? CLUB_TO_SLUG[inv.club_number] || null : null,
    items: inv.inventory_invoice_items || [],
    files: (inv.inventory_invoice_files || []).sort((a, b) => (a.page_no || 0) - (b.page_no || 0)),
    inventory_invoice_items: undefined,
    inventory_invoice_files: undefined,
  }
}
```
Update `GET /invoices` to `.select('*, inventory_invoice_items(*), inventory_invoice_files(*)')` and `invoices: (data || []).map(shapeInvoice)`.

- [ ] **Step 4: Manual verification**

Start auth locally is not used (per project convention — do not test recurring/server tasks locally). Instead verify by reading: confirm `node -e "require('./auth/src/routes/inventory.js')"` loads without throwing.
Run: `node -e "require('./auth/src/routes/inventory.js'); console.log('route module OK')"`
Expected: prints `route module OK` (no missing-require/syntax errors).

- [ ] **Step 5: Commit**

```bash
git add auth/src/routes/inventory.js
git commit -m "feat(inventory): multi-page invoice upload + resolve-or-create by order number"
```

---

## Task 6: Parse endpoint

**Files:**
- Modify: `auth/src/routes/inventory.js` (add `POST /invoices/:id/parse`; add requires)

**Interfaces:**
- Consumes: `extractFromPages`, `getClient` (Task 4); `matchLine` (Task 3); `isSellableItem`/catalog query helpers already in file; `getAccessToken`.
- Produces: `POST /invoices/:id/parse` → reads the invoice's pages, extracts via vision, backfills header fields that are still empty, deletes existing **unreceived** lines, inserts new draft lines with matches, sets `parse_status`/`parsed_at`/`parse_error`, returns the reshaped invoice. Honors `INVENTORY_OCR_DISABLED`.

- [ ] **Step 1: Add requires**

```js
const invoiceParse = require('../services/inventoryInvoiceParse')
const { matchLine } = require('../utils/inventoryMatch')
```

- [ ] **Step 2: Implement the endpoint** (place after `POST /invoices`)

```js
// POST /invoices/:id/parse — vision-extract all pages, backfill header, and
// regenerate UNRECEIVED draft lines with catalog matches. Received lines untouched.
router.post('/invoices/:id/parse', async (req, res) => {
  try {
    if (process.env.INVENTORY_OCR_DISABLED === '1') return res.status(503).json({ error: 'Invoice OCR is disabled' })
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid invoice id' })

    const { data: invoice } = await supabaseAdmin
      .from('inventory_invoices').select('*, inventory_invoice_files(*)').eq('id', req.params.id).maybeSingle()
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' })
    const pages = (invoice.inventory_invoice_files || []).sort((a, b) => (a.page_no || 0) - (b.page_no || 0))
    if (!pages.length) return res.status(400).json({ error: 'No pages to parse — upload a photo or PDF first' })

    let parsed
    try {
      const token = await getAccessToken()
      parsed = await invoiceParse.extractFromPages(pages, { token })
    } catch (e) {
      await supabaseAdmin.from('inventory_invoices').update({ parse_status: 'error', parse_error: e.message }).eq('id', invoice.id)
      return res.status(502).json({ error: 'Could not read the invoice: ' + e.message })
    }

    // Catalog for matching: this club, or every club for corporate invoices.
    const makeCat = () => {
      let q = supabaseAdmin.from('inventory_items').select('id,item_name,upc,club_number,category,profit_center').eq('archived', false)
      if (invoice.club_number) q = q.eq('club_number', invoice.club_number)
      return q.order('item_name')
    }
    const catalog = (await fetchAllRows(makeCat)).filter(isSellableItem)
    let aliasQ = supabaseAdmin
      .from('inventory_vendor_aliases').select('vendor_sku,alias_text,upc,item_id')
      .eq('vendor', String(parsed.vendor || invoice.vendor || '').toLowerCase().trim())
    aliasQ = invoice.club_number ? aliasQ.eq('club_number', invoice.club_number) : aliasQ.is('club_number', null)
    const { data: aliases } = await aliasQ

    // Drop existing unreceived lines, keep received ones.
    await supabaseAdmin.from('inventory_invoice_items').delete().eq('invoice_id', invoice.id).eq('received', false)

    const rows = parsed.lines
      .filter(l => l.quantity && l.quantity > 0)
      .map(l => {
        const m = matchLine({ description: l.description, upc: l.upc, vendor_sku: l.vendor_sku }, { items: catalog, aliases: aliases || [] })
        return {
          invoice_id: invoice.id, item_id: m.item_id, description: l.description || null, upc: l.upc,
          vendor_sku: l.vendor_sku || null,
          quantity: l.quantity, unit_cost: l.unit_cost != null ? l.unit_cost : 0,
          match_confidence: m.match_confidence, match_source: m.match_source,
        }
      })
    if (rows.length) await supabaseAdmin.from('inventory_invoice_items').insert(rows)

    await supabaseAdmin.from('inventory_invoices').update({
      vendor: invoice.vendor || parsed.vendor || invoice.vendor,
      invoice_number: invoice.invoice_number || normalizeOrderNumber(parsed.order_number),
      invoice_date: invoice.invoice_date || parsed.invoice_date || null,
      total: invoice.total != null ? invoice.total : parsed.total,
      parse_status: 'parsed', parsed_at: new Date().toISOString(), parse_error: null,
    }).eq('id', invoice.id)

    const { data: full } = await supabaseAdmin
      .from('inventory_invoices').select('*, inventory_invoice_items(*), inventory_invoice_files(*)').eq('id', invoice.id).single()
    res.json({ invoice: shapeInvoice(full), parsed_lines: rows.length })
  } catch (err) {
    console.error('[Inventory] parse error:', err.message)
    res.status(500).json({ error: err.message })
  }
})
```

- [ ] **Step 3: Verify module loads**

Run: `node -e "require('./auth/src/routes/inventory.js'); console.log('OK')"`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add auth/src/routes/inventory.js
git commit -m "feat(inventory): vision parse endpoint regenerates unreceived draft lines"
```

---

## Task 7: Page add/delete endpoints

**Files:**
- Modify: `auth/src/routes/inventory.js`

**Interfaces:**
- Produces: `POST /invoices/:id/files` (multipart `files`) appends pages then returns the reshaped invoice (caller re-parses); `DELETE /invoices/:id/files/:fileId` removes a page row.

- [ ] **Step 1: Implement both endpoints** (after the parse endpoint)

```js
// POST /invoices/:id/files — attach more page(s) to an existing invoice.
router.post('/invoices/:id/files', uploadFiles, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid invoice id' })
    const files = req.files && req.files.length ? req.files : (req.file ? [req.file] : [])
    if (!files.length) return res.status(400).json({ error: 'No files provided' })
    for (const f of files) if (!ALLOWED_MIME.test(f.mimetype || '')) return res.status(400).json({ error: 'Only photo or PDF files are allowed' })

    const { data: invoice } = await supabaseAdmin.from('inventory_invoices').select('*').eq('id', req.params.id).maybeSingle()
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' })

    const folderId = await getUploadFolderId()
    if (!folderId) return res.status(400).json({ error: 'Invoice upload folder is not configured yet' })
    const token = await getAccessToken()
    const { count } = await supabaseAdmin.from('inventory_invoice_files').select('id', { count: 'exact', head: true }).eq('invoice_id', invoice.id)
    let pageNo = count || 0
    for (const f of files) {
      const up = await uploadBufferToDrive(f.buffer, f.originalname, f.mimetype, token, folderId)
      pageNo++
      await supabaseAdmin.from('inventory_invoice_files').insert({
        invoice_id: invoice.id, file_link: up.fileLink, file_name: up.fileName, page_no: pageNo, mime_type: up.mime,
      })
    }
    const { data: full } = await supabaseAdmin
      .from('inventory_invoices').select('*, inventory_invoice_items(*), inventory_invoice_files(*)').eq('id', invoice.id).single()
    res.status(201).json({ invoice: shapeInvoice(full) })
  } catch (err) { res.status(err.status || 500).json({ error: err.message }) }
})

// DELETE /invoices/:id/files/:fileId — remove one page.
router.delete('/invoices/:id/files/:fileId', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.fileId)) return res.status(400).json({ error: 'Invalid file id' })
    const { data, error } = await supabaseAdmin
      .from('inventory_invoice_files').delete().eq('id', req.params.fileId).eq('invoice_id', req.params.id).select().maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Page not found' })
    res.json({ success: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})
```

- [ ] **Step 2: Verify module loads**

Run: `node -e "require('./auth/src/routes/inventory.js'); console.log('OK')"`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add auth/src/routes/inventory.js
git commit -m "feat(inventory): add/remove invoice page endpoints"
```

---

## Task 8: Receive writes vendor aliases

**Files:**
- Modify: `auth/src/routes/inventory.js` (the `POST /invoices/:id/receive` loop, ~697-736)

**Interfaces:**
- Consumes: `normalizeText`, `normalizeSku` from `inventoryMatch` (add to the require; `normalizeSku` is added in Task 15).
- Produces: after a line is received, upsert an `inventory_vendor_aliases` row. When the line has a `vendor_sku`, key on `(club_number, vendor, vendor_sku)` (conflict target `uq_inventory_vendor_aliases_sku`) so future invoices auto-match by SKU; otherwise key on `(club_number, vendor, alias_text=normalizeText(description))` (conflict target `uq_inventory_vendor_aliases_text`). Skips lines with neither a SKU nor a description.

- [ ] **Step 1: Extend the receive require**

Change the matcher require to:
```js
const { matchLine, normalizeText, normalizeSku } = require('../utils/inventoryMatch')
```

- [ ] **Step 2: Upsert alias inside the receive loop**

Immediately after the existing `await supabaseAdmin.from('inventory_invoice_items').update({ received: true })...` line, add:
```js
      const vendorNorm = String(invoice.vendor || '').toLowerCase().trim()
      const skuNorm = normalizeSku(line.vendor_sku)
      const aliasText = normalizeText(line.description)
      if (skuNorm) {
        await supabaseAdmin.from('inventory_vendor_aliases').upsert({
          club_number: item.club_number, vendor: vendorNorm,
          vendor_sku: skuNorm, alias_text: null, upc: line.upc || null,
          item_id: item.id, created_by: req.staff.id,
        }, { onConflict: 'club_number,vendor,vendor_sku' }).then(() => {}, () => {})
      } else if (aliasText) {
        await supabaseAdmin.from('inventory_vendor_aliases').upsert({
          club_number: item.club_number, vendor: vendorNorm,
          vendor_sku: null, alias_text: aliasText, upc: line.upc || null,
          item_id: item.id, created_by: req.staff.id,
        }, { onConflict: 'club_number,vendor,alias_text' }).then(() => {}, () => {})
      }
```
NOTE: partial-index conflict targets require the upsert's WHERE to be implied by the row values; supabase-js `onConflict` names the index columns. If PostgREST cannot infer the partial index, fall back to a select-then-insert/update for the alias (this write is best-effort and already wrapped to swallow errors, so a miss never blocks receiving).

- [ ] **Step 3: Verify module loads**

Run: `node -e "require('./auth/src/routes/inventory.js'); console.log('OK')"`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add auth/src/routes/inventory.js
git commit -m "feat(inventory): learn vendor->item aliases when receiving"
```

---

## Task 9: Frontend API client functions

**Files:**
- Modify: `portal/src/lib/api.js` (~777-800)

**Interfaces:**
- Produces: `createInventoryInvoice(fields, files)` accepts an array of files (back-compat with single file); `parseInventoryInvoice(invoiceId)`; `addInventoryInvoiceFiles(invoiceId, files)`; `deleteInventoryInvoiceFile(invoiceId, fileId)`.

- [ ] **Step 1: Update `createInventoryInvoice` for multiple files**

```js
export async function createInventoryInvoice(fields, files) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null && v !== '') fd.append(k, v)
  }
  const list = Array.isArray(files) ? files : (files ? [files] : [])
  for (const f of list) fd.append('files', f)
  return api('/inventory/invoices', { method: 'POST', body: fd })
}
```

- [ ] **Step 2: Add the new functions** (next to the other invoice helpers)

```js
export async function parseInventoryInvoice(invoiceId) {
  return api('/inventory/invoices/' + invoiceId + '/parse', { method: 'POST' })
}

export async function addInventoryInvoiceFiles(invoiceId, files) {
  const fd = new FormData()
  for (const f of (Array.isArray(files) ? files : [files])) fd.append('files', f)
  return api('/inventory/invoices/' + invoiceId + '/files', { method: 'POST', body: fd })
}

export async function deleteInventoryInvoiceFile(invoiceId, fileId) {
  return api('/inventory/invoices/' + invoiceId + '/files/' + fileId, { method: 'DELETE' })
}
```

- [ ] **Step 3: Verify the build**

Run: `cd portal && npm run build`
Expected: build succeeds (no import/syntax errors).

- [ ] **Step 4: Commit**

```bash
git add portal/src/lib/api.js
git commit -m "feat(inventory): api client for multi-file upload, parse, page mgmt"
```

---

## Task 10: InvoiceModal — multi-file capture + auto-parse on create

**Files:**
- Modify: `portal/src/components/InventoryView.jsx` (`InvoiceModal` ~290-345; imports ~5-7)

**Interfaces:**
- Consumes: `parseInventoryInvoice` (Task 9).
- Produces: the New Invoice modal accepts multiple files, and after creation (when files were attached) calls `parseInventoryInvoice` and hands the parsed invoice to `onCreated`, which opens it in `InvoiceDetail`.

- [ ] **Step 1: Add the import**

Add `parseInventoryInvoice` to the `../lib/api` import block.

- [ ] **Step 2: Multi-file state + input**

Change `const [file, setFile] = useState(null)` to `const [files, setFiles] = useState([])`.
Change the file input to:
```jsx
        <div>
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Invoice pages (PDF or photos — attach all pages)</span>
          <input type="file" accept="application/pdf,image/*" multiple
            onChange={e => setFiles(Array.from(e.target.files || []))} className="text-xs text-text-muted" />
          {files.length > 0 && <p className="text-[11px] text-text-muted mt-1">{files.length} page(s) selected</p>}
        </div>
```

- [ ] **Step 3: Parse after create**

In `save()`, change the create call and follow-up:
```js
      const res = await createInventoryInvoice({
        vendor: vendor.trim(),
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        total,
        notes,
        location_slug: slug === 'all' ? '' : slug,
      }, files)
      let invoice = res.invoice
      if (files.length) {
        try { const p = await parseInventoryInvoice(invoice.id); invoice = p.invoice } catch (_) { /* keep manual entry */ }
      }
      onCreated(invoice)
      onClose()
```
Also change the button label to reflect parsing: `{saving ? (files.length ? 'Reading invoice...' : 'Saving...') : 'Create Invoice'}`.

- [ ] **Step 4: Verify the build**

Run: `cd portal && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add portal/src/components/InventoryView.jsx
git commit -m "feat(inventory): new-invoice modal accepts multiple pages + auto-parses"
```

---

## Task 11: InvoiceDetail — pages strip, per-line match picker, confidence, re-parse

**Files:**
- Modify: `portal/src/components/InventoryView.jsx` (`InvoiceDetail` ~349-end of component; imports)

**Interfaces:**
- Consumes: `parseInventoryInvoice`, `addInventoryInvoiceFiles`, `deleteInventoryInvoiceFile` (Task 9); existing `ItemPicker`, `addInventoryInvoiceItem`, `deleteInventoryInvoiceItem`, `receiveInventoryInvoice`.
- Produces: detail modal shows a page thumbnail/link strip with add/remove + a "Re-read invoice" button; each unreceived line shows an inline `ItemPicker` to fix its match and a confidence pill; matched lines can be re-linked before Receive.

- [ ] **Step 1: Add imports**

Add `parseInventoryInvoice, addInventoryInvoiceFiles, deleteInventoryInvoiceFile` to the `../lib/api` import block.

- [ ] **Step 2: Add pages + parse state and handlers** (inside `InvoiceDetail`, after existing state)

```js
  const [files, setFiles] = useState(invoice.files || [])
  const [parsing, setParsing] = useState(false)

  async function reparse() {
    setParsing(true); setError('')
    try {
      const res = await parseInventoryInvoice(invoice.id)
      setLines(res.invoice.items || [])
      setFiles(res.invoice.files || [])
      onChanged()
    } catch (err) { setError(err.message) } finally { setParsing(false) }
  }

  async function addPages(fileList) {
    const list = Array.from(fileList || [])
    if (!list.length) return
    setParsing(true); setError('')
    try {
      await addInventoryInvoiceFiles(invoice.id, list)
      await reparse()
    } catch (err) { setError(err.message); setParsing(false) }
  }

  async function removePage(fileId) {
    try { await deleteInventoryInvoiceFile(invoice.id, fileId); setFiles(f => f.filter(x => x.id !== fileId)) }
    catch (err) { setError(err.message) }
  }

  // Re-link an existing line to a different catalog item before receiving.
  async function relink(line, itemId) {
    try {
      await deleteInventoryInvoiceItem(invoice.id, line.id)
      const res = await addInventoryInvoiceItem(invoice.id, {
        item_id: itemId, description: line.description, quantity: Number(line.quantity), unit_cost: Number(line.unit_cost),
      })
      setLines(l => l.map(x => x.id === line.id ? res.item : x)); onChanged()
    } catch (err) { setError(err.message) }
  }
```

- [ ] **Step 3: Render the pages strip** (just below the header meta `<div>` at ~408)

```jsx
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {files.map((f, i) => (
          <span key={f.id} className="inline-flex items-center gap-1 text-xs bg-bg border border-border rounded-full px-2 py-1">
            <a href={f.file_link} target="_blank" rel="noreferrer" className="text-wcs-red font-semibold hover:underline">Page {f.page_no || i + 1}</a>
            <button onClick={() => removePage(f.id)} className="text-text-muted hover:text-wcs-red" title="Remove page">×</button>
          </span>
        ))}
        <label className="text-xs font-semibold text-wcs-red cursor-pointer hover:underline">
          + Add page
          <input type="file" accept="application/pdf,image/*" capture="environment" multiple className="hidden"
            onChange={e => addPages(e.target.files)} />
        </label>
        <button onClick={reparse} disabled={parsing || !files.length} className={btnGhost}>
          {parsing ? 'Reading...' : 'Re-read invoice'}
        </button>
      </div>
```

- [ ] **Step 4: Add a confidence pill + inline picker in the lines table**

In the `<td>` for the item (the cell that currently shows name / "Not linked"), append for unreceived lines a confidence pill and a picker:
```jsx
                  {!l.received && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="min-w-[220px]"><ItemPicker items={items} value={l.item_id} onChange={(id) => id && relink(l, id)} /></div>
                      {l.match_source && (
                        <span className={`text-[10px] font-bold uppercase rounded-full px-1.5 py-0.5 border ${
                          l.match_confidence >= 0.85 ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                          : l.match_confidence >= 0.6 ? 'text-amber-700 bg-amber-50 border-amber-200'
                          : 'text-text-muted bg-bg border-border'}`}>
                          {l.match_source}{l.match_confidence != null ? ` ${Math.round(l.match_confidence * 100)}%` : ''}
                        </span>
                      )}
                    </div>
                  )}
```

- [ ] **Step 5: Verify the build**

Run: `cd portal && npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add portal/src/components/InventoryView.jsx
git commit -m "feat(inventory): invoice detail shows pages, match pickers, confidence, re-read"
```

---

## Task 12: Mobile camera capture

**Files:**
- Modify: `portal/src/mobile/components/MobileInventory.jsx`

**Interfaces:**
- Consumes: existing inventory API client (whichever invoice flow MobileInventory already renders).
- Produces: the mobile invoice add path offers a camera-capture file input (`capture="environment"`, `multiple`) wired to the same create+parse flow as Task 10.

- [ ] **Step 1: Inspect what MobileInventory renders for invoices**

Run: `grep -n "nvoice\|file\|capture\|createInventory\|parseInventory" portal/src/mobile/components/MobileInventory.jsx`
Expected: identifies whether MobileInventory has its own invoice add UI or reuses `InvoiceModal`. If it reuses `InvoiceModal` (Task 10 already added `capture` via the file input on detail; add `capture="environment"` to the InvoiceModal input too), this task is just adding `capture="environment"` to the InvoiceModal `<input type="file">` and verifying mobile. If MobileInventory has its own input, mirror Task 10's multi-file + parse logic there.

- [ ] **Step 2: Add `capture="environment"` to the InvoiceModal file input** (Task 10's input)

In `portal/src/components/InventoryView.jsx`, the InvoiceModal file input gains `capture="environment"`:
```jsx
          <input type="file" accept="application/pdf,image/*" multiple capture="environment"
            onChange={e => setFiles(Array.from(e.target.files || []))} className="text-xs text-text-muted" />
```
(`capture` is ignored on desktop browsers, so it is safe for the shared component.)

- [ ] **Step 3: If MobileInventory has a separate invoice add UI, wire it**

Apply the same multi-file + `createInventoryInvoice(fields, files)` + `parseInventoryInvoice` flow as Task 10, following MobileInventory's existing sheet/modal pattern (mobile sheets `createPortal` to body per the inventory mobile convention).

- [ ] **Step 4: Verify the build**

Run: `cd portal && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add portal/src/components/InventoryView.jsx portal/src/mobile/components/MobileInventory.jsx
git commit -m "feat(inventory): camera capture for invoice photos on mobile"
```

---

## Task 13: Full test sweep + docs

**Files:**
- Modify: `docs/superpowers/specs/2026-06-22-inventory-invoice-ocr-design.md` (mark shipped) — optional
- Verify: all new tests + frontend build

**Interfaces:** none.

- [ ] **Step 1: Run every new unit test**

Run: `node --test auth/src/utils/inventoryInvoiceKey.test.js auth/src/utils/inventoryMatch.test.js auth/src/services/inventoryInvoiceParse.test.js`
Expected: all pass, 0 failures.

- [ ] **Step 2: Verify route module + frontend build**

Run: `node -e "require('./auth/src/routes/inventory.js'); console.log('routes OK')" && cd portal && npm run build`
Expected: `routes OK` then a successful build.

- [ ] **Step 3: Confirm env + folder config notes**

Confirm in the PR description: requires `ANTHROPIC_API_KEY` on the auth service (already present for mastermind) and the existing `app_config.inventory_upload_folder_id` (or `INVENTORY_UPLOAD_FOLDER_ID`). Opt-out: `INVENTORY_OCR_DISABLED=1`.

- [ ] **Step 4: Commit any doc updates**

```bash
git add -A
git commit -m "docs(inventory): mark invoice OCR shipped; note env requirements"
```

---

## Revision R1 — real-invoice findings (Sportlife S454042, 2026-06-22)

A real vendor invoice showed: no UPCs, a stable vendor **Item SKU** per line, a
**Type** column (Sale/Subtotal/Discount/Shipping), and grand total on the last
page only. Tasks 4/6/8 above are already revised inline (vendor_sku capture,
Sale-only extraction, description cleaning, SKU-keyed aliases). Two new tasks
add the schema and matcher support. **Execution order:** run Task 14 then Task 15
BEFORE Task 4 (Task 6 consumes both).

## Task 14: Migration 041 — vendor SKU columns + alias index rework

**Files:**
- Create: `auth/migrations/041_inventory_vendor_sku.sql`

**Interfaces:**
- Produces (DB): `inventory_invoice_items.vendor_sku`, `inventory_vendor_aliases.vendor_sku`, `alias_text` made nullable, old table-level UNIQUE replaced by two partial unique indexes.

- [ ] **Step 1: Write the migration SQL**

```sql
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
```

- [ ] **Step 2: Commit** (controller applies the migration to Supabase separately)

```bash
git add auth/migrations/041_inventory_vendor_sku.sql
git commit -m "feat(inventory): migration 041 - vendor SKU columns + alias index rework"
```

---

## Task 15: Matcher — vendor SKU as primary key

**Files:**
- Modify: `auth/src/utils/inventoryMatch.js`
- Modify: `auth/src/utils/inventoryMatch.test.js`

**Interfaces:**
- Produces: `normalizeSku(s) => string|null` (uppercase, trim, collapse whitespace, strip surrounding non-alphanumerics; null when empty). `matchLine` now accepts `line.vendor_sku` and aliases carry `vendor_sku`; new resolution order: **SKU alias → UPC exact → text alias → fuzzy → unmatched**, with `match_source` adding `'sku'`. Existing behaviors and confidences are unchanged for lines without a SKU.

- [ ] **Step 1: Add failing tests** (append to `inventoryMatch.test.js`)

```js
const { normalizeSku } = require('./inventoryMatch')

test('normalizeSku: uppercases and trims, null on empty', () => {
  assert.equal(normalizeSku(' s1181001 '), 'S1181001')
  assert.equal(normalizeSku(''), null)
  assert.equal(normalizeSku(null), null)
})

test('matchLine: vendor SKU alias wins over fuzzy', () => {
  const skuAliases = [{ vendor_sku: 'S1181001', alias_text: null, upc: null, item_id: 'i-shaker' }]
  // description deliberately does NOT fuzzy-match the shaker
  const r = matchLine(
    { description: 'fireball lcarnitine cherry', upc: null, vendor_sku: 's1181001' },
    { items, aliases: skuAliases })
  assert.deepEqual(r, { item_id: 'i-shaker', match_source: 'sku', match_confidence: 1 })
})

test('matchLine: no SKU alias falls through to fuzzy', () => {
  const r = matchLine(
    { description: 'shaker bottle wcs black', upc: null, vendor_sku: 'S999' },
    { items, aliases: [] })
  assert.equal(r.item_id, 'i-shaker')
  assert.equal(r.match_source, 'fuzzy')
})
```

- [ ] **Step 2: Run tests, confirm the new ones FAIL**

Run: `node --test auth/src/utils/inventoryMatch.test.js`
Expected: the two new tests fail (`normalizeSku` undefined / `match_source` 'fuzzy' not 'sku').

- [ ] **Step 3: Implement**

Add `normalizeSku` and prepend the SKU-alias branch in `matchLine`:
```js
function normalizeSku(s) {
  const v = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '').trim()
  return v ? v.toUpperCase() : null
}
```
In `matchLine`, immediately after computing `const miss = {...}`, before the UPC step:
```js
  // 0. Vendor SKU alias — strongest signal (stable per-vendor, survives name changes).
  const skuNorm = normalizeSku(line.vendor_sku)
  if (skuNorm) {
    for (const a of aliases) {
      if (a.vendor_sku && normalizeSku(a.vendor_sku) === skuNorm) {
        return { item_id: a.item_id, match_source: 'sku', match_confidence: 1 }
      }
    }
  }
```
Export `normalizeSku` in `module.exports`.

- [ ] **Step 4: Run tests, confirm all pass**

Run: `node --test auth/src/utils/inventoryMatch.test.js`
Expected: all pass (the 8 existing + 3 new = 11), output pristine.

- [ ] **Step 5: Commit**

```bash
git add auth/src/utils/inventoryMatch.js auth/src/utils/inventoryMatch.test.js
git commit -m "feat(inventory): vendor SKU as primary matcher key"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** order-number grouping (T2,T5), multi-page (T1,T5,T7,T10,T11,T12), vision extraction (T4,T6), code matching incl. UPC/alias/fuzzy (T3,T6), learned aliases (T1,T8), review UI + confidence (T11), camera (T12), fresh-parse preserves received lines (T6), error fallback to manual (T6 sets parse_status='error', manual add unchanged), RLS (T1), opt-out env (T6,T13).
- **No supabase mock harness exists** in the repo, so route logic is verified by (a) thoroughly unit-testing the extracted pure modules and (b) module-load + build checks; per project convention server tasks are not run locally.
- **Type consistency:** `matchLine` returns `{ item_id, match_source, match_confidence }` used verbatim in T6 inserts and T11 pills; `shapeInvoice` returns `{ items, files }` consumed by T10/T11; `extractFromPages(pages, { token })` signature matches T6's call.

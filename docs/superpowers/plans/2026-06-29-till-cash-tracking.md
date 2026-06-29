# Till / Cash Tracking System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile daily cash drawers per club by comparing ABC POS cash-tender sales (auto) against Operandio drawer-count submissions (open + close), surfacing over/short, theft signals, and count compliance in a new Reporting "Till" report.

**Architecture:** Four independent phases, each its own PR off `master`. (1) Capture the per-line `payments` array the POS sync currently drops, into a new table, backfilled from the retained `raw` jsonb. (2) A pure reconciliation function + `/till/reconciliation` endpoint computing expected-vs-counted on read. (3) Parse two new Operandio drawer-count jobs through the existing `/operandio/webhook` pipeline into `till_counts`. (4) A manager+ "Till" report UI following the existing Reporting patterns.

**Tech Stack:** Node/Express (auth API), Supabase Postgres (service-role, RLS-enabled), React 19 + Vite + Tailwind (portal), `node --test` for unit tests, node-cron sync.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-29-till-cash-tracking-design.md` — read it first.
- **Standard float:** $100 default, stored per-club in `till_settings` (configurable). Bag-drop = everything above the float.
- **Physical-register filter:** `employee_id IS NOT NULL AND station_name <> 'ABC Transaction'`. Club identity always comes from the per-club endpoint, never `station_name`.
- **Drawer cash = cash tender only.** Card/check/account/writeoff tenders never affect the drawer.
- **Pacific time** for all day boundaries (reuse `pacificDate` / the Pacific-disguised-UTC helpers already in the codebase).
- **RLS:** every new public table gets `ENABLE ROW LEVEL SECURITY` with no policy (service-role only) — repo convention (see migration 035 sweep).
- **DB access is 100% service-role** via `supabaseAdmin`; the frontend never uses supabase-js.
- **Next migration number is `070`** (master tops out at `069_tour_push_subscriptions.sql`).
- **One PR per phase.** Justin merges fast; verify each sha is in `origin/master` before assuming it shipped. Separable follow-on work = its own new PR.
- **No alerts** (SMS/email) — explicitly out of scope.
- **No em-dashes** in any user-facing copy.
- Tests run with `node --test <file>` (no `test` npm script exists). Pure logic lives in `auth/src/lib/*.js` with a sibling `*.test.js`, fixtures in `auth/src/lib/__fixtures__/`.

---

## Phase 1 — Tender capture (foundation)

Persist the `items.item[].payments[]` array (currently discarded) so cash can be
separated from card. Backfill from the `raw` jsonb already stored on every
transaction. Branch: `feat/till-tender-capture`.

### Task 1.1: Tender-category normalizer (pure function)

**Files:**
- Create: `auth/src/lib/tenderCategory.js`
- Test: `auth/src/lib/tenderCategory.test.js`

**Interfaces:**
- Produces: `tenderCategory(paymentType: string) -> 'cash'|'card'|'check'|'account'|'writeoff'|'other'`

- [ ] **Step 1: Write the failing test**

```js
// auth/src/lib/tenderCategory.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const { tenderCategory } = require('./tenderCategory')

test('cash', () => assert.equal(tenderCategory('Cash'), 'cash'))
test('plain card brands', () => {
  assert.equal(tenderCategory('Visa'), 'card')
  assert.equal(tenderCategory('Master Card'), 'card')
  assert.equal(tenderCategory('American Express'), 'card')
})
test('masked card brands', () => {
  assert.equal(tenderCategory('Visa(xxxx6263)'), 'card')
  assert.equal(tenderCategory('Master Card(xxxx0508)'), 'card')
})
test('check / account / writeoff', () => {
  assert.equal(tenderCategory('Check'), 'check')
  assert.equal(tenderCategory('Club Account'), 'account')
  assert.equal(tenderCategory('Write Off'), 'writeoff')
})
test('unknown / empty -> other', () => {
  assert.equal(tenderCategory('Apple Pay'), 'other')
  assert.equal(tenderCategory(''), 'other')
  assert.equal(tenderCategory(null), 'other')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test auth/src/lib/tenderCategory.test.js`
Expected: FAIL — `Cannot find module './tenderCategory'`

- [ ] **Step 3: Write minimal implementation**

```js
// auth/src/lib/tenderCategory.js
// Normalize ABC's free-form paymentType strings into drawer-relevant buckets.
// Masked card forms look like "Visa(xxxx6263)" — strip the suffix before match.
function tenderCategory(paymentType) {
  const raw = String(paymentType || '').trim()
  if (!raw) return 'other'
  const base = raw.replace(/\(.*\)\s*$/, '').trim().toLowerCase()
  if (base === 'cash') return 'cash'
  if (base === 'check') return 'check'
  if (base === 'club account') return 'account'
  if (base === 'write off') return 'writeoff'
  if (['visa', 'master card', 'mastercard', 'american express', 'amex', 'discover'].includes(base)) return 'card'
  return 'other'
}

module.exports = { tenderCategory }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test auth/src/lib/tenderCategory.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add auth/src/lib/tenderCategory.js auth/src/lib/tenderCategory.test.js
git commit -m "feat(till): tender-category normalizer"
```

### Task 1.2: Payment extraction helper (pure function)

**Files:**
- Create: `auth/src/lib/posPayments.js`
- Test: `auth/src/lib/posPayments.test.js`

**Interfaces:**
- Consumes: `tenderCategory` from Task 1.1, `num` from `auth/src/services/abcInventory`
- Produces: `extractItemPayments(rawItem) -> Array<{ payment_type, payment_amount, payment_tax, tender_category }>`
  — tolerant of `payments` being absent, an object, or an array.

- [ ] **Step 1: Write the failing test**

```js
// auth/src/lib/posPayments.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const { extractItemPayments } = require('./posPayments')

test('array of payments', () => {
  const out = extractItemPayments({ payments: [
    { paymentType: 'Cash', paymentAmount: '2.62', paymentTax: '0.00' },
    { paymentType: 'Visa(xxxx6263)', paymentAmount: '10.00', paymentTax: '0.50' },
  ]})
  assert.equal(out.length, 2)
  assert.deepEqual(out[0], { payment_type: 'Cash', payment_amount: 2.62, payment_tax: 0, tender_category: 'cash' })
  assert.equal(out[1].tender_category, 'card')
})
test('single payment as object', () => {
  const out = extractItemPayments({ payments: { paymentType: 'Cash', paymentAmount: '5.00' } })
  assert.equal(out.length, 1)
  assert.equal(out[0].payment_amount, 5)
})
test('no payments key', () => assert.deepEqual(extractItemPayments({}), []))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test auth/src/lib/posPayments.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// auth/src/lib/posPayments.js
const { num } = require('../services/abcInventory')
const { tenderCategory } = require('./tenderCategory')

// A POS line's payments may be absent, a single object, or an array. Normalize
// to a flat array of typed rows.
function extractItemPayments(rawItem) {
  const p = rawItem && rawItem.payments
  const list = Array.isArray(p) ? p : (p && typeof p === 'object' ? [p] : [])
  return list.filter(Boolean).map(pay => ({
    payment_type: pay.paymentType || null,
    payment_amount: num(pay.paymentAmount),
    payment_tax: num(pay.paymentTax),
    tender_category: tenderCategory(pay.paymentType),
  }))
}

module.exports = { extractItemPayments }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test auth/src/lib/posPayments.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add auth/src/lib/posPayments.js auth/src/lib/posPayments.test.js
git commit -m "feat(till): POS line payment extraction helper"
```

### Task 1.3: Migration — inventory_transaction_payments

**Files:**
- Create: `auth/migrations/070_inventory_transaction_payments.sql`

**Interfaces:**
- Produces: table `inventory_transaction_payments` consumed by Tasks 1.4, 1.5, 2.3.

- [ ] **Step 1: Write the migration**

```sql
-- auth/migrations/070_inventory_transaction_payments.sql
-- Per-line POS payment tenders, dropped by the original sync mapper but
-- retained in inventory_transactions.raw. Enables cash-vs-card reconciliation
-- for the Till tracking system.
CREATE TABLE IF NOT EXISTS inventory_transaction_payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_pk   uuid NOT NULL REFERENCES inventory_transactions(id) ON DELETE CASCADE,
  club_number      text NOT NULL,
  line_no          integer NOT NULL,
  pay_no           integer NOT NULL,           -- index within the line's payments[]
  payment_type     text,                       -- raw ABC value, e.g. "Visa(xxxx6263)"
  payment_amount   numeric(12,2),
  payment_tax      numeric(12,2),
  tender_category  text NOT NULL,              -- cash|card|check|account|writeoff|other
  UNIQUE (transaction_pk, line_no, pay_no)
);

CREATE INDEX IF NOT EXISTS idx_inv_txn_pay_txn
  ON inventory_transaction_payments(transaction_pk);
CREATE INDEX IF NOT EXISTS idx_inv_txn_pay_club_tender
  ON inventory_transaction_payments(club_number, tender_category);

ALTER TABLE inventory_transaction_payments ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` (project `ybopxxydsuwlbwxiuzve`, name `070_inventory_transaction_payments`) using the file's contents, OR have Justin run it. Do NOT mark complete until applied.

- [ ] **Step 3: Verify the table exists**

Run (Supabase MCP `execute_sql`):
```sql
SELECT count(*) FROM inventory_transaction_payments;
```
Expected: `0` (table exists, empty).

- [ ] **Step 4: Commit**

```bash
git add auth/migrations/070_inventory_transaction_payments.sql
git commit -m "feat(till): migration 070 inventory_transaction_payments"
```

### Task 1.4: Persist payments during POS sync

**Files:**
- Modify: `auth/src/services/abcInventory.js` (`fetchPosTransactions` line-item map, ~line 124-135) — add `payments`
- Modify: `auth/src/services/inventorySync.js` (`syncPosForClub`, ~line 209-262) — insert payment rows

**Interfaces:**
- Consumes: `extractItemPayments` (Task 1.2)

- [ ] **Step 1: Carry payments through the fetcher**

In `auth/src/services/abcInventory.js`, inside the `.map(it => ({ ... }))` for items in `fetchPosTransactions`, add a field after `tax: num(it.tax),`:

```js
            tax: num(it.tax),
            payments: it.payments || null,   // raw; flattened at persist time
```

- [ ] **Step 2: Insert payment rows alongside line items**

In `auth/src/services/inventorySync.js`, at the top add the require:

```js
const { extractItemPayments } = require('../lib/posPayments')
```

Inside `syncPosForClub`, in the `t.items.forEach((it, idx) => { ... })` loop, after the `lineRows.push({...})` call, accumulate payment rows. First declare `const paymentRows = []` next to `const lineRows = []` (~line 209). Then after the `lineRows.push`:

```js
      extractItemPayments(it).forEach((pay, pIdx) => {
        paymentRows.push({
          transaction_pk: txnPk,
          club_number: clubNumber,
          line_no: idx,
          pay_no: pIdx,
          payment_type: pay.payment_type,
          payment_amount: pay.payment_amount,
          payment_tax: pay.payment_tax,
          tender_category: pay.tender_category,
        })
      })
```

Then after the existing `inventory_transaction_items` insert block (~line 253-256), add:

```js
    if (paymentRows.length) {
      const { error: payErr } = await supabaseAdmin
        .from('inventory_transaction_payments').insert(paymentRows)
      if (payErr) throw new Error('payments insert failed: ' + payErr.message)
    }
```

Note: `extractItemPayments` reads `it.payments`, which Step 1 now carries on each mapped item.

- [ ] **Step 3: Verify the service still loads**

Run: `node -e "require('./auth/src/services/inventorySync')" `
Expected: no output, exit 0 (module loads, requires resolve).

- [ ] **Step 4: Commit**

```bash
git add auth/src/services/abcInventory.js auth/src/services/inventorySync.js
git commit -m "feat(till): persist POS payment tenders during sync"
```

### Task 1.5: Backfill payments from raw jsonb

**Files:**
- Create: `auth/scripts/backfill-transaction-payments.js`

**Interfaces:**
- Consumes: `extractItemPayments` (Task 1.2), `supabaseAdmin`

- [ ] **Step 1: Write the backfill script**

```js
// auth/scripts/backfill-transaction-payments.js
// One-time backfill: read inventory_transactions.raw, flatten
// items.item[].payments[] into inventory_transaction_payments.
// Idempotent (ON CONFLICT skip). Usage: node scripts/backfill-transaction-payments.js [--dry-run]
require('dotenv').config()
const { supabaseAdmin } = require('../src/services/supabase')
const { extractItemPayments } = require('../src/lib/posPayments')

const DRY = process.argv.includes('--dry-run')
const PAGE = 500

function itemsOf(raw) {
  const it = raw && raw.items && raw.items.item
  return Array.isArray(it) ? it : (it ? [it] : [])
}

async function main() {
  let from = 0, scanned = 0, inserted = 0
  for (;;) {
    const { data, error } = await supabaseAdmin
      .from('inventory_transactions')
      .select('id, club_number, raw')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break

    const rows = []
    for (const t of data) {
      scanned++
      itemsOf(t.raw).forEach((it, lineNo) => {
        extractItemPayments(it).forEach((pay, pIdx) => {
          rows.push({
            transaction_pk: t.id, club_number: t.club_number,
            line_no: lineNo, pay_no: pIdx,
            payment_type: pay.payment_type, payment_amount: pay.payment_amount,
            payment_tax: pay.payment_tax, tender_category: pay.tender_category,
          })
        })
      })
    }
    if (rows.length && !DRY) {
      for (let i = 0; i < rows.length; i += 500) {
        const { error: e } = await supabaseAdmin
          .from('inventory_transaction_payments')
          .upsert(rows.slice(i, i + 500), { onConflict: 'transaction_pk,line_no,pay_no', ignoreDuplicates: true })
        if (e) throw e
      }
    }
    inserted += rows.length
    from += PAGE
    console.log(`scanned ${scanned} txns, ${inserted} payment rows${DRY ? ' (dry-run)' : ''}`)
  }
  console.log(`DONE — ${scanned} transactions, ${inserted} payment rows ${DRY ? '(dry-run, nothing written)' : 'written'}`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Dry-run**

Run: `cd auth && node scripts/backfill-transaction-payments.js --dry-run`
Expected: prints scanned/inserted counts, ends `DONE ... (dry-run, nothing written)`. Sanity-check the payment-row count is in the tens of thousands (>= transaction count).

- [ ] **Step 3: Live run**

Run: `cd auth && node scripts/backfill-transaction-payments.js`
Expected: ends `DONE ... written`.

- [ ] **Step 4: Verify cash totals are populated**

Run (Supabase MCP `execute_sql`):
```sql
SELECT tender_category, count(*), round(sum(payment_amount),2) total
FROM inventory_transaction_payments GROUP BY 1 ORDER BY 3 DESC NULLS LAST;
```
Expected: a `cash` row with a non-zero total (~$16k+ across history), plus `card`, `check`, `account`, `writeoff`.

- [ ] **Step 5: Commit, open PR**

```bash
git add auth/scripts/backfill-transaction-payments.js
git commit -m "feat(till): backfill transaction payments from raw jsonb"
git push -u origin feat/till-tender-capture
gh pr create --base master --title "Till Phase 1: capture POS payment tenders" --body "Persists items[].payments[] (cash vs card) into inventory_transaction_payments; backfilled from raw jsonb. Foundation for till reconciliation. 🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Phase 2 — Reconciliation engine

Pure daily reconciliation + a manager+ endpoint computing it on read. Branch:
`feat/till-reconciliation` (off master, after Phase 1 merges).

### Task 2.1: Migration — till_settings (per-club float + drop config)

**Files:**
- Create: `auth/migrations/071_till_settings.sql`

**Interfaces:**
- Produces: table `till_settings` consumed by Tasks 2.4, 2.5.

- [ ] **Step 1: Write the migration**

```sql
-- auth/migrations/071_till_settings.sql
-- Per-club till configuration. standard_float is the par the drawer resets to
-- each night; drop_upc is the UPC sentinel of the ABC "Cash Drop" POS item so
-- the reconciler can treat that line as a drawer reduction instead of a sale.
-- VERIFIED 2026-06-29 test ring: the Cash Drop item carries upc 'XXXCASHDROPXXX'
-- (catalog "Company", so the same UPC appears at all 7 clubs) under the shared
-- 'MISC. ITEMS' profit center — hence we key on UPC, NOT profit center.
CREATE TABLE IF NOT EXISTS till_settings (
  club_number       text PRIMARY KEY,
  standard_float    numeric(12,2) NOT NULL DEFAULT 100,
  drop_upc          text NOT NULL DEFAULT 'XXXCASHDROPXXX',
  active            boolean NOT NULL DEFAULT true,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

INSERT INTO till_settings (club_number, standard_float)
VALUES ('30935',100),('31599',100),('7655',100),('31598',100),
       ('31600',100),('31601',100),('32073',100)
ON CONFLICT (club_number) DO NOTHING;

ALTER TABLE till_settings ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply** via Supabase MCP `apply_migration` (name `071_till_settings`).

- [ ] **Step 3: Verify**

Run: `SELECT club_number, standard_float FROM till_settings ORDER BY 1;`
Expected: 7 rows, all `100.00`.

- [ ] **Step 4: Commit**

```bash
git add auth/migrations/071_till_settings.sql
git commit -m "feat(till): migration 071 till_settings"
```

### Task 2.2: Reconciliation function (pure)

**Files:**
- Create: `auth/src/lib/tillReconcile.js`
- Test: `auth/src/lib/tillReconcile.test.js`

**Interfaces:**
- Produces: `reconcileDay(input) -> result` where
  `input = { standardFloat, openingCount|null, closingCount|null, cashSales, cashRefunds, cashDrops }`
  and `result = { openingFloat, expectedClose, countedClose|null, overShort|null, bagDrop|null, floatVariance|null, status }`.
  `status ∈ 'complete' | 'missing_open' | 'missing_close' | 'missing_both'`.

- [ ] **Step 1: Write the failing test**

```js
// auth/src/lib/tillReconcile.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const { reconcileDay } = require('./tillReconcile')

test('balanced day', () => {
  const r = reconcileDay({ standardFloat: 100, openingCount: 100, closingCount: 250,
    cashSales: 160, cashRefunds: 10, cashDrops: 0 })
  assert.equal(r.expectedClose, 250)      // 100 + 160 - 10 - 0
  assert.equal(r.overShort, 0)            // 250 - 250
  assert.equal(r.bagDrop, 150)            // 250 - 100 par
  assert.equal(r.floatVariance, 0)        // opening 100 vs par 100
  assert.equal(r.status, 'complete')
})
test('short drawer', () => {
  const r = reconcileDay({ standardFloat: 100, openingCount: 100, closingCount: 230,
    cashSales: 160, cashRefunds: 10, cashDrops: 0 })
  assert.equal(r.overShort, -20)          // 230 - 250
})
test('drop accounted for', () => {
  const r = reconcileDay({ standardFloat: 100, openingCount: 100, closingCount: 100,
    cashSales: 160, cashRefunds: 0, cashDrops: 160 })
  assert.equal(r.expectedClose, 100)
  assert.equal(r.overShort, 0)
  assert.equal(r.bagDrop, 0)
})
test('opening float drift flagged', () => {
  const r = reconcileDay({ standardFloat: 100, openingCount: 80, closingCount: 240,
    cashSales: 160, cashRefunds: 0, cashDrops: 0 })
  assert.equal(r.floatVariance, -20)      // someone left 80 not 100
  assert.equal(r.expectedClose, 240)      // uses actual opening 80
  assert.equal(r.overShort, 0)
})
test('missing close', () => {
  const r = reconcileDay({ standardFloat: 100, openingCount: 100, closingCount: null,
    cashSales: 50, cashRefunds: 0, cashDrops: 0 })
  assert.equal(r.countedClose, null)
  assert.equal(r.overShort, null)
  assert.equal(r.status, 'missing_close')
})
test('missing open falls back to par', () => {
  const r = reconcileDay({ standardFloat: 100, openingCount: null, closingCount: 260,
    cashSales: 160, cashRefunds: 0, cashDrops: 0 })
  assert.equal(r.openingFloat, 100)       // assume par when not counted
  assert.equal(r.floatVariance, null)     // unknown
  assert.equal(r.overShort, 0)
  assert.equal(r.status, 'missing_open')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test auth/src/lib/tillReconcile.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// auth/src/lib/tillReconcile.js
// Pure daily till reconciliation. All inputs are dollars (numbers); counts may
// be null when the Operandio submission is missing.
//
//   expectedClose = openingFloat + cashSales - cashRefunds - cashDrops
//   overShort     = countedClose - expectedClose
//   bagDrop       = countedClose - standardFloat   (cash pulled to deposit)
//   floatVariance = openingCount - standardFloat   (overnight drift; null if no AM count)
//
// When the AM count is missing we assume the drawer was left at par.
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

function reconcileDay({ standardFloat, openingCount, closingCount, cashSales = 0, cashRefunds = 0, cashDrops = 0 }) {
  const par = Number(standardFloat) || 0
  const hasOpen = openingCount != null
  const hasClose = closingCount != null
  const openingFloat = hasOpen ? Number(openingCount) : par
  const expectedClose = r2(openingFloat + Number(cashSales) - Number(cashRefunds) - Number(cashDrops))
  const countedClose = hasClose ? Number(closingCount) : null
  const overShort = hasClose ? r2(countedClose - expectedClose) : null
  const bagDrop = hasClose ? r2(countedClose - par) : null
  const floatVariance = hasOpen ? r2(openingFloat - par) : null

  let status = 'complete'
  if (!hasOpen && !hasClose) status = 'missing_both'
  else if (!hasOpen) status = 'missing_open'
  else if (!hasClose) status = 'missing_close'

  return { openingFloat, expectedClose, countedClose, overShort, bagDrop, floatVariance, status }
}

module.exports = { reconcileDay }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test auth/src/lib/tillReconcile.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add auth/src/lib/tillReconcile.js auth/src/lib/tillReconcile.test.js
git commit -m "feat(till): pure daily reconciliation function"
```

### Task 2.3: Cash-movement aggregation query (per club/day)

**Files:**
- Create: `auth/src/lib/tillCashMovements.js`
- Test: `auth/src/lib/tillCashMovements.test.js`

**Interfaces:**
- Consumes: `supabaseAdmin`, `till_settings.drop_upc`
- Produces: `aggregateCashByDay(supabaseAdmin, { clubNumber, fromUtc, toUtc, dropUpc }) -> Map<businessDate, { cashSales, cashRefunds, cashDrops }>`
- Also exports pure `classifyCashLine({ tender_category, is_return, upc, amount }, dropUpc) -> { sales, refunds, drops }` for unit testing the bucketing.

> **Drop keying (verified against the 2026-06-29 test ring):** a cash drop comes
> through as a POSITIVE cash tender on a `sale=true` line, identical to a cash sale
> except its UPC is the sentinel `XXXCASHDROPXXX` (the item sits under the shared
> `MISC. ITEMS` profit center, so profit center is NOT a usable key). Match drops
> by UPC and subtract them.

- [ ] **Step 1: Write the failing test (pure classifier only)**

```js
// auth/src/lib/tillCashMovements.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const { classifyCashLine } = require('./tillCashMovements')

const DROP = 'XXXCASHDROPXXX'
test('cash sale', () => {
  assert.deepEqual(classifyCashLine({ tender_category: 'cash', is_return: false, upc: '810113510286', amount: 5 }, DROP),
    { sales: 5, refunds: 0, drops: 0 })
})
test('cash refund', () => {
  assert.deepEqual(classifyCashLine({ tender_category: 'cash', is_return: true, upc: '810113510286', amount: 5 }, DROP),
    { sales: 0, refunds: 5, drops: 0 })
})
test('cash drop item (matched by UPC sentinel)', () => {
  assert.deepEqual(classifyCashLine({ tender_category: 'cash', is_return: false, upc: 'XXXCASHDROPXXX', amount: 200 }, DROP),
    { sales: 0, refunds: 0, drops: 200 })
})
test('card sale ignored', () => {
  assert.deepEqual(classifyCashLine({ tender_category: 'card', is_return: false, upc: '810113510286', amount: 5 }, DROP),
    { sales: 0, refunds: 0, drops: 0 })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test auth/src/lib/tillCashMovements.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```js
// auth/src/lib/tillCashMovements.js
// Aggregate physical-register CASH movements per Pacific business day for a club.
// Only cash tenders matter to a drawer. A line whose UPC is the club's configured
// drop sentinel is a drawer reduction (cash pulled), not a sale.
//
// inventory_transaction_payments has a real FK to inventory_transactions but NOT
// to inventory_transaction_items (both key on transaction_pk; the line link is the
// composite (transaction_pk, line_no), which PostgREST cannot embed). So we pull
// the cash payment rows with their parent transaction in one query, then fetch the
// line UPCs for those transactions in a second query and join in JS by
// (transaction_pk, line_no).

function classifyCashLine({ tender_category, is_return, upc, amount }, dropUpc) {
  const out = { sales: 0, refunds: 0, drops: 0 }
  if (tender_category !== 'cash') return out
  const amt = Number(amount) || 0
  if (dropUpc && upc && String(upc).trim() === String(dropUpc).trim()) {
    out.drops = amt          // cash physically pulled from the drawer
  } else if (is_return) {
    out.refunds = amt
  } else {
    out.sales = amt
  }
  return out
}

// pacificDate reused from operandioJobs to keep day-bucketing consistent.
const { pacificDate } = require('./operandioJobs')

async function aggregateCashByDay(supabaseAdmin, { clubNumber, fromUtc, toUtc, dropUpc }) {
  // 1) Cash payment rows + parent transaction (real FK embed).
  const { data: pays, error } = await supabaseAdmin
    .from('inventory_transaction_payments')
    .select('transaction_pk, line_no, payment_amount, tender_category, inventory_transactions!inner(transaction_at, employee_id, station_name, is_return)')
    .eq('club_number', clubNumber)
    .eq('tender_category', 'cash')
    .gte('inventory_transactions.transaction_at', fromUtc.toISOString())
    .lte('inventory_transactions.transaction_at', toUtc.toISOString())
  if (error) throw new Error('cash aggregate failed: ' + error.message)
  if (!pays || pays.length === 0) return new Map()

  // 2) UPCs for those transactions' lines, keyed (transaction_pk|line_no).
  const txnPks = [...new Set(pays.map(p => p.transaction_pk))]
  const upcByLine = new Map()
  for (let i = 0; i < txnPks.length; i += 200) {
    const { data: items, error: iErr } = await supabaseAdmin
      .from('inventory_transaction_items')
      .select('transaction_pk, line_no, upc')
      .in('transaction_pk', txnPks.slice(i, i + 200))
    if (iErr) throw new Error('cash aggregate line lookup failed: ' + iErr.message)
    for (const it of items || []) upcByLine.set(`${it.transaction_pk}|${it.line_no}`, it.upc)
  }

  // 3) Classify + bucket by Pacific day.
  const byDay = new Map()
  for (const p of pays) {
    const txn = p.inventory_transactions
    if (!txn || !txn.employee_id || txn.station_name === 'ABC Transaction') continue // physical register only
    const day = pacificDate(txn.transaction_at)
    if (!day) continue
    const c = classifyCashLine({
      tender_category: p.tender_category, is_return: txn.is_return,
      upc: upcByLine.get(`${p.transaction_pk}|${p.line_no}`),
      amount: p.payment_amount,
    }, dropUpc)
    const cur = byDay.get(day) || { cashSales: 0, cashRefunds: 0, cashDrops: 0 }
    cur.cashSales += c.sales; cur.cashRefunds += c.refunds; cur.cashDrops += c.drops
    byDay.set(day, cur)
  }
  return byDay
}

module.exports = { classifyCashLine, aggregateCashByDay }
```

- [ ] **Step 4: Run unit test + a live spot check**

Run: `node --test auth/src/lib/tillCashMovements.test.js`
Expected: PASS (4 tests).

Then live-verify the aggregation shape against one club/day with a quick scratch script or Supabase query comparing the function's cashSales for Salem last week to:
```sql
SELECT round(sum(p.payment_amount),2)
FROM inventory_transaction_payments p
JOIN inventory_transactions t ON t.id = p.transaction_pk
WHERE p.club_number='30935' AND p.tender_category='cash'
  AND t.employee_id IS NOT NULL AND t.station_name <> 'ABC Transaction'
  AND t.is_return = false
  AND t.transaction_at >= now() - interval '7 days';
```
Expected: function `cashSales` summed over the 7 days ≈ this number.

- [ ] **Step 5: Commit**

```bash
git add auth/src/lib/tillCashMovements.js auth/src/lib/tillCashMovements.test.js
git commit -m "feat(till): cash-movement aggregation per club/day"
```

### Task 2.4: Cash Drop item — DONE (verified 2026-06-29)

The ABC "Cash Drop" POS item already exists and was test-rung at Salem on
2026-06-29. Verified payload: `name="Cash Drop"`, `upc="XXXCASHDROPXXX"`,
`catalog="Company"` (so the same UPC at all 7 clubs), `profitCenter="MISC. ITEMS"`
(shared bucket — NOT a usable key), `sale="true"`, and a POSITIVE
`payments:[{paymentType:"Cash", paymentAmount:"1.00"}]`. The sentinel UPC
`XXXCASHDROPXXX` maps to exactly one item ("Cash Drop") and nothing else.

No work here: `drop_upc` already defaults to `'XXXCASHDROPXXX'` in the migration
(Task 2.1), so no config UPDATE is needed. The reconciler subtracts these lines
(Task 2.3 `classifyCashLine`).

- [ ] **Step 1: Confirm the sentinel is still unique** (sanity, Supabase MCP):
```sql
SELECT upc, count(DISTINCT name) AS names FROM inventory_transaction_items
WHERE upc='XXXCASHDROPXXX' GROUP BY upc;
```
Expected: one row, `names = 1`.

> Note: the test ring's payment row is NULL in prod today only because prod runs
> pre-Phase-1 sync code. Once Phase 1 (PR #396) deploys, drops capture the cash
> tender automatically; the raw payload already proves the shape. Drops are rare
> (Justin), so the parallel fact that they inflate Revenue/POS Sales reports by the
> drop amount is accepted for now (no report exclusion in this phase).

### Task 2.5: /till/reconciliation endpoint

**Files:**
- Create: `auth/src/routes/till.js`
- Modify: `auth/src/index.js` (register the router — match how other routers mount)

**Interfaces:**
- Consumes: `reconcileDay` (2.2), `aggregateCashByDay` (2.3), `till_counts` (Phase 3 — endpoint tolerates its absence by treating counts as null until Phase 3 ships), `parseLocationSlugParam`/`SLUG_CLUB_MAP`, `requireRole`
- Produces: `GET /till/reconciliation?location_slug=&from=YYYY-MM-DD&to=YYYY-MM-DD` → `{ rows: [{ club_number, location_slug, business_date, openingFloat, cashSales, cashRefunds, cashDrops, expectedClose, countedClose, overShort, bagDrop, floatVariance, status, openBy, closeBy }] }`

- [ ] **Step 1: Write the router**

```js
// auth/src/routes/till.js
// Till / cash reconciliation. Manager+ (cash variance is sensitive).
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { parseLocationSlugParam, SLUG_CLUB_MAP } = require('../utils/locationSlug')
const { reconcileDay } = require('../lib/tillReconcile')
const { aggregateCashByDay } = require('../lib/tillCashMovements')

const CLUB_TO_SLUG = Object.fromEntries(Object.entries(SLUG_CLUB_MAP).map(([s, c]) => [c, s]))
const router = Router()
router.use(authenticate)
router.use(requireRole('manager'))

// Parse YYYY-MM-DD as a Pacific-day boundary window. We widen by a day on each
// side in UTC terms so the cash query captures the full Pacific days, then bucket
// precisely by pacificDate inside aggregateCashByDay.
function utcWindow(fromStr, toStr) {
  const from = new Date(`${fromStr}T00:00:00-08:00`)
  const to = new Date(`${toStr}T23:59:59-07:00`)
  return { from, to }
}

router.get('/reconciliation', async (req, res) => {
  try {
    const parsed = parseLocationSlugParam(req.query.location_slug)
    if (parsed.invalid) return res.status(400).json({ error: `Unknown location: ${parsed.invalid}` })
    const from = String(req.query.from || '').slice(0, 10)
    const to = String(req.query.to || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
      return res.status(400).json({ error: 'from and to (YYYY-MM-DD) are required' })

    const clubs = parsed.slugs.map(s => SLUG_CLUB_MAP[s]).filter(Boolean)
    const { from: fromUtc, to: toUtc } = utcWindow(from, to)

    // Settings (float + drop UPC sentinel) per club.
    const { data: settings } = await supabaseAdmin
      .from('till_settings').select('club_number, standard_float, drop_upc')
      .in('club_number', clubs)
    const settingByClub = new Map((settings || []).map(s => [s.club_number, s]))

    // Counts per club/day (open/close). Tolerate the table not existing yet.
    let counts = []
    try {
      const { data } = await supabaseAdmin
        .from('till_counts')
        .select('club_number, business_date, count_type, counted_amount, employee_name')
        .in('club_number', clubs).gte('business_date', from).lte('business_date', to)
      counts = data || []
    } catch { counts = [] }
    const countKey = (club, date, type) => `${club}|${date}|${type}`
    const countMap = new Map(counts.map(c => [countKey(c.club_number, c.business_date, c.count_type), c]))

    const rows = []
    for (const club of clubs) {
      const setting = settingByClub.get(club) || { standard_float: 100, drop_upc: 'XXXCASHDROPXXX' }
      const byDay = await aggregateCashByDay(supabaseAdmin, {
        clubNumber: club, fromUtc, toUtc, dropUpc: setting.drop_upc,
      })
      // Union of days that have cash activity OR a count submission.
      const days = new Set(byDay.keys())
      counts.filter(c => c.club_number === club).forEach(c => days.add(c.business_date))
      for (const date of [...days].sort()) {
        const cash = byDay.get(date) || { cashSales: 0, cashRefunds: 0, cashDrops: 0 }
        const open = countMap.get(countKey(club, date, 'open'))
        const close = countMap.get(countKey(club, date, 'close'))
        const rec = reconcileDay({
          standardFloat: Number(setting.standard_float),
          openingCount: open ? Number(open.counted_amount) : null,
          closingCount: close ? Number(close.counted_amount) : null,
          cashSales: cash.cashSales, cashRefunds: cash.cashRefunds, cashDrops: cash.cashDrops,
        })
        rows.push({
          club_number: club, location_slug: CLUB_TO_SLUG[club], business_date: date,
          cashSales: Math.round(cash.cashSales * 100) / 100,
          cashRefunds: Math.round(cash.cashRefunds * 100) / 100,
          cashDrops: Math.round(cash.cashDrops * 100) / 100,
          ...rec,
          openBy: open?.employee_name || null, closeBy: close?.employee_name || null,
        })
      }
    }
    res.json({ rows })
  } catch (err) {
    console.error('[till] reconciliation failed:', err.message)
    res.status(500).json({ error: 'reconciliation failed' })
  }
})

module.exports = router
```

- [ ] **Step 2: Register the router**

In `auth/src/index.js`, find where routers mount (e.g. `app.use('/inventory', require('./routes/inventory'))`) and add alongside:

```js
app.use('/till', require('./routes/till'))
```

- [ ] **Step 3: Verify it loads + responds**

Run: `node -e "require('./auth/src/routes/till')"` → exit 0.
Then start the auth API locally (or rely on the existing dev process) and hit:
`GET /till/reconciliation?location_slug=salem&from=<7 days ago>&to=<today>` with a manager token.
Expected: `200` JSON with a `rows` array; cash numbers match Task 2.3's spot check; counts null until Phase 3.

- [ ] **Step 4: Commit, open PR**

```bash
git add auth/src/routes/till.js auth/src/index.js
git commit -m "feat(till): reconciliation endpoint"
git push -u origin feat/till-reconciliation
gh pr create --base master --title "Till Phase 2: reconciliation engine + endpoint" --body "Pure daily reconcile + /till/reconciliation (manager+). Cash drops via configurable ABC profit center. 🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Phase 3 — Operandio drawer-count capture

Two Operandio jobs (open + close) parsed into `till_counts` through the existing
webhook. Branch: `feat/till-operandio-counts`.

### Task 3.1: Migration — till_counts

**Files:**
- Create: `auth/migrations/072_till_counts.sql`

- [ ] **Step 1: Write the migration**

```sql
-- auth/migrations/072_till_counts.sql
-- Physical drawer counts parsed from Operandio "Drawer Open/Close Count" jobs.
CREATE TABLE IF NOT EXISTS till_counts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_number          text NOT NULL,
  location_slug        text NOT NULL,
  business_date        date NOT NULL,
  count_type           text NOT NULL CHECK (count_type IN ('open','close')),
  counted_amount       numeric(12,2) NOT NULL,
  denominations        jsonb,
  employee_name        text,
  counted_at           timestamptz,
  operandio_instance_id text,
  source               text NOT NULL DEFAULT 'operandio',
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_number, business_date, count_type)
);
CREATE INDEX IF NOT EXISTS idx_till_counts_club_date ON till_counts(club_number, business_date);
ALTER TABLE till_counts ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply** via Supabase MCP (`072_till_counts`).
- [ ] **Step 3: Verify** `SELECT count(*) FROM till_counts;` → `0`.
- [ ] **Step 4: Commit**

```bash
git add auth/migrations/072_till_counts.sql
git commit -m "feat(till): migration 072 till_counts"
```

### Task 3.2: Create Operandio jobs + capture a real sample (manual)

**Files:**
- Create: `auth/src/lib/__fixtures__/till-open-count.html` and `till-close-count.html`

- [ ] **Step 1 (Justin):** In Operandio, create two jobs per club: "Drawer Open Count" and "Drawer Close Count", each with a single money/number task "Cash total in drawer" (plus optional denomination number tasks).

- [ ] **Step 2 (Justin):** Submit one test "Drawer Close Count" (and one open) so the notification emails hit the existing SendGrid inbound-parse address.

- [ ] **Step 3:** Pull the captured raw email from `operandio_raw_emails` (it will fall through there because no parser matches yet):
```sql
SELECT id, subject, left(html, 200) FROM operandio_raw_emails
WHERE subject ILIKE '%Drawer%Count%' ORDER BY created_at DESC LIMIT 5;
```
Save the full `html` of one open and one close submission into the fixture files above. These anchor the parser test.

- [ ] **Step 4: Commit the fixtures**

```bash
git add auth/src/lib/__fixtures__/till-open-count.html auth/src/lib/__fixtures__/till-close-count.html
git commit -m "test(till): drawer-count email fixtures"
```

### Task 3.3: Drawer-count parser (against the fixture)

**Files:**
- Create: `auth/src/lib/tillCountParse.js`
- Test: `auth/src/lib/tillCountParse.test.js`

**Interfaces:**
- Consumes: `parseSubmissionSubject`, `parseSubmissionItems`, `parseStamp`, `pacificDate` from `operandioJobs`
- Produces: `classifyTillCount({ subject, html, receivedAt }) -> { location_slug, count_type, counted_amount, denominations, employee_name, counted_at, business_date } | null`

- [ ] **Step 1: Write the failing test** (uses the captured fixtures, so the asserted amount must match what Justin entered — set EXPECTED_* after reading the fixture)

```js
// auth/src/lib/tillCountParse.test.js
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { classifyTillCount } = require('./tillCountParse')

const closeHtml = fs.readFileSync(path.join(__dirname, '__fixtures__/till-close-count.html'), 'utf8')

test('parses a close count', () => {
  const out = classifyTillCount({
    subject: 'Drawer Close Count (Jun 29) submitted at Salem',
    html: closeHtml, receivedAt: '2026-06-29T23:30:00Z',
  })
  assert.equal(out.location_slug, 'salem')
  assert.equal(out.count_type, 'close')
  assert.equal(typeof out.counted_amount, 'number')
  assert.ok(out.counted_amount > 0)        // tighten to the exact entered value once fixture is in hand
  assert.equal(out.business_date, '2026-06-29')
})
test('non-drawer submission ignored', () => {
  assert.equal(classifyTillCount({ subject: 'Front Desk Open submitted at Salem', html: '<div></div>' }), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test auth/src/lib/tillCountParse.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```js
// auth/src/lib/tillCountParse.js
// Parse an Operandio "Drawer Open/Close Count" submission into a till_counts row.
// Reuses the proven submission HTML task-row parser; pulls the money value out of
// the count task. Subject form: "Drawer <Open|Close> Count (Jun 29) submitted at <Location>".
const { parseSubmissionSubject, parseSubmissionItems, parseStamp, pacificDate } = require('./operandioJobs')

const money = (s) => {
  if (s == null) return null
  const m = String(s).replace(/[, ]/g, '').match(/-?\d+(\.\d{1,2})?/)
  return m ? parseFloat(m[0]) : null
}

function classifyTillCount({ subject, html, receivedAt }) {
  const sub = parseSubmissionSubject(subject)
  if (!sub) return null
  const name = sub.jobName.toLowerCase()
  if (!/drawer/.test(name) || !/count/.test(name)) return null
  const count_type = /close|pm|end/.test(name) ? 'close' : (/open|am|start/.test(name) ? 'open' : null)
  if (!count_type) return null

  const items = parseSubmissionItems(html) || []
  // The cash-total task: prefer a task whose name mentions cash/total/drawer and
  // whose status cell carried a numeric value. parseSubmissionItems tags numeric
  // entries status='value' but does not return the number, so re-extract here.
  let counted_amount = null
  const denominations = {}
  for (const it of items) {
    const valMatch = extractRowValue(html, it.n)
    const tn = (it.task || '').toLowerCase()
    if (/cash|total|drawer|count/.test(tn) && counted_amount == null) counted_amount = money(valMatch)
    if (valMatch != null) denominations[it.task] = money(valMatch)
  }
  // Fallback: if no labeled total, sum any numeric rows.
  if (counted_amount == null) {
    const nums = Object.values(denominations).filter(v => typeof v === 'number')
    counted_amount = nums.length ? nums.reduce((a, b) => a + b, 0) : null
  }
  if (counted_amount == null) return null

  const latest = items.map(i => i.at_iso).filter(Boolean).sort().pop()
  const byCount = {}; let primary = null, primaryN = 0
  for (const it of items) { if (!it.by) continue; byCount[it.by] = (byCount[it.by] || 0) + 1
    if (byCount[it.by] > primaryN) { primaryN = byCount[it.by]; primary = it.by } }

  return {
    location_slug: sub.locationSlug,
    count_type,
    counted_amount,
    denominations: Object.keys(denominations).length ? denominations : null,
    employee_name: primary,
    counted_at: latest || (receivedAt ? new Date(receivedAt).toISOString() : null),
    business_date: pacificDate(latest || receivedAt),
  }
}

// Extract the numeric value shown in a row's status cell. Operandio renders a
// number-field answer inside the status cell following the numbered task block.
function extractRowValue(html, n) {
  const block = (html || '').split(/(?=<div style="background-color:#f3f3f3;[^"]*">\d{1,3}<\/div>)/)
    .find(b => new RegExp(`>${n}<\\/div>`).test(b))
  if (!block) return null
  // Look for "$1,234.56" or a bare number in a span after the task cell.
  const m = block.match(/\$?\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*<\/span>/)
  return m ? m[1] : null
}

module.exports = { classifyTillCount, extractRowValue }
```

> NOTE for implementer: `extractRowValue`'s regex targets the value cell in the
> submission HTML. The exact markup is only knowable from the Task 3.2 fixture —
> adjust the regex against the real sample and tighten the test's
> `counted_amount` assertion to the exact value Justin entered. This is the same
> fixture-first approach used for the audit PDF parser.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test auth/src/lib/tillCountParse.test.js`
Expected: PASS (2 tests). If the amount extraction misses, fix `extractRowValue` against the fixture markup until it returns the entered value.

- [ ] **Step 5: Commit**

```bash
git add auth/src/lib/tillCountParse.js auth/src/lib/tillCountParse.test.js
git commit -m "feat(till): drawer-count submission parser"
```

### Task 3.4: Wire parser into the Operandio webhook

**Files:**
- Modify: `auth/src/routes/operandio.js` (the webhook handler — add a branch before the existing summary/job parse)

**Interfaces:**
- Consumes: `classifyTillCount` (3.3), `SLUG_CLUB_MAP`

- [ ] **Step 1: Locate the webhook branch order**

Read `auth/src/routes/operandio.js` and find where `classifyJobEmail` / the audit + summary parses run inside `POST /webhook`. The till branch must run BEFORE the generic job parse (a drawer count is also a "submission", so it would otherwise be stored as a generic job event — that's harmless but we want the till row too; persist BOTH or short-circuit. Persist the till row, then `return` so it is not double-counted as a generic checklist).

- [ ] **Step 2: Add the till branch**

At the top of the file add:
```js
const { classifyTillCount } = require('../lib/tillCountParse')
const { SLUG_CLUB_MAP } = require('../utils/locationSlug')
```

Inside the webhook handler, after the raw email is staged and `subject/html/receivedAt` are in scope, before the generic `classifyJobEmail` call, add:

```js
    const till = classifyTillCount({ subject, html, receivedAt })
    if (till) {
      const clubNumber = SLUG_CLUB_MAP[till.location_slug]
      if (clubNumber) {
        const { error: tcErr } = await supabaseAdmin.from('till_counts').upsert({
          club_number: clubNumber,
          location_slug: till.location_slug,
          business_date: till.business_date,
          count_type: till.count_type,
          counted_amount: till.counted_amount,
          denominations: till.denominations,
          employee_name: till.employee_name,
          counted_at: till.counted_at,
          operandio_instance_id: instanceId || null,
        }, { onConflict: 'club_number,business_date,count_type' })
        if (tcErr) console.error('[operandio] till_counts upsert failed:', tcErr.message)
      }
      return res.json({ ok: true, kind: 'till_count', count_type: till.count_type })
    }
```

> NOTE: `instanceId` may not be in scope here — if the existing handler computes
> it later, pass `null` (the column is nullable) or hoist its derivation above
> this branch. Match the variable names actually used in the handler.

- [ ] **Step 3: Verify the route loads**

Run: `node -e "require('./auth/src/routes/operandio')"` → exit 0.

- [ ] **Step 4: End-to-end verify**

Re-submit (or re-send) the test close count. Then:
```sql
SELECT club_number, business_date, count_type, counted_amount, employee_name FROM till_counts ORDER BY created_at DESC LIMIT 5;
```
Expected: a row with the amount Justin entered. Then re-hit `/till/reconciliation` for that club/day and confirm `countedClose` and `overShort` are now populated.

- [ ] **Step 5: Commit, open PR**

```bash
git add auth/src/routes/operandio.js
git commit -m "feat(till): ingest drawer counts via operandio webhook"
git push -u origin feat/till-operandio-counts
gh pr create --base master --title "Till Phase 3: Operandio drawer-count capture" --body "Two drawer-count jobs parsed into till_counts via the existing webhook; reconciliation now shows counted vs expected. 🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Phase 4 — Till report UI (Reporting, manager+)

Branch: `feat/till-report-ui`. Follows the existing Reporting patterns
(`ReportingView.jsx` registry, location pills, date presets, `ReportBlock`/
`StatBlock` one-block style — mirror `PosSalesReport.jsx`).

### Task 4.1: API client method

**Files:**
- Modify: `portal/src/lib/api.js` (add a `till` fetch alongside the inventory/report methods)

- [ ] **Step 1: Add the client method**

Find the existing report fetchers in `portal/src/lib/api.js` and add (matching their auth-header/signature style):

```js
export async function fetchTillReconciliation({ locationSlug, from, to }) {
  const qs = new URLSearchParams({ location_slug: locationSlug || 'all', from, to })
  return apiGet(`/till/reconciliation?${qs.toString()}`)   // use whatever the file's GET helper is named
}
```

> Match the file's actual request helper (`apiGet`/`authedFetch`/etc.) and export style. Read 3-4 neighboring functions first.

- [ ] **Step 2: Verify build**

Run: `cd portal && npx vite build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add portal/src/lib/api.js
git commit -m "feat(till): api client for reconciliation"
```

### Task 4.2: TillReport component (daily + by-employee + compliance tabs)

**Files:**
- Create: `portal/src/components/reports/TillReport.jsx`

**Interfaces:**
- Consumes: `fetchTillReconciliation` (4.1); receives `{ locationSlug, from, to }` props like sibling reports (read `PosSalesReport.jsx` for the exact prop contract + shared primitives).

- [ ] **Step 1: Write the component**

Model structure on `PosSalesReport.jsx` (same imports for `ReportBlock`/`StatBlock`, same loading/empty handling, same currency formatting helper). Three sub-tabs:

```jsx
// portal/src/components/reports/TillReport.jsx
import { useEffect, useState, useMemo } from 'react'
import { fetchTillReconciliation } from '../../lib/api'
// import the SAME block/format primitives PosSalesReport uses:
// import { ReportBlock, StatBlock } from './StatBlock'  // match real path

const money = (n) => (n == null ? '--' : `$${Number(n).toFixed(2)}`)
const TABS = [{ key: 'daily', label: 'Daily' }, { key: 'employee', label: 'By Employee' }, { key: 'compliance', label: 'Compliance' }]

export default function TillReport({ locationSlug, from, to }) {
  const [rows, setRows] = useState([])
  const [tab, setTab] = useState('daily')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true); setError(null)
    fetchTillReconciliation({ locationSlug, from, to })
      .then(d => { if (alive) setRows(d.rows || []) })
      .catch(e => { if (alive) setError(e.message || 'Failed to load') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [locationSlug, from, to])

  const byEmployee = useMemo(() => {
    const m = new Map()
    for (const r of rows) {
      if (r.closeBy && r.overShort != null) {
        const cur = m.get(r.closeBy) || { name: r.closeBy, days: 0, overShort: 0 }
        cur.days++; cur.overShort += r.overShort; m.set(r.closeBy, cur)
      }
    }
    return [...m.values()].sort((a, b) => a.overShort - b.overShort)
  }, [rows])

  if (loading) return <div className="p-4 text-sm text-gray-500">Loading till data...</div>
  if (error) return <div className="p-4 text-sm text-red-600">{error}</div>
  if (!rows.length) return <div className="p-4 text-sm text-gray-500">No till activity for this range.</div>

  const shortPill = (v) => {
    if (v == null) return <span className="text-gray-400">--</span>
    const cls = v === 0 ? 'bg-green-100 text-green-700' : v < 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
    return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{v > 0 ? '+' : ''}{money(v)}</span>
  }
  const statusChip = (s) => {
    const map = { complete: ['Counted', 'bg-green-100 text-green-700'], missing_close: ['No close', 'bg-red-100 text-red-700'],
      missing_open: ['No open', 'bg-amber-100 text-amber-700'], missing_both: ['Missing', 'bg-red-100 text-red-700'] }
    const [label, cls] = map[s] || [s, 'bg-gray-100 text-gray-600']
    return <span className={`px-2 py-0.5 rounded text-xs ${cls}`}>{label}</span>
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded text-sm ${tab === t.key ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'daily' && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="py-2 pr-3">Date</th><th>Loc</th><th className="text-right">Float</th>
              <th className="text-right">Cash Sales</th><th className="text-right">Refunds</th><th className="text-right">Drops</th>
              <th className="text-right">Expected</th><th className="text-right">Counted</th><th className="text-right">Over/Short</th>
              <th className="text-right">Bag Drop</th><th>Status</th><th>Closed By</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2 pr-3">{r.business_date}</td><td>{r.location_slug}</td>
                  <td className={`text-right ${r.floatVariance ? 'text-red-600' : ''}`}>{money(r.openingFloat)}</td>
                  <td className="text-right">{money(r.cashSales)}</td><td className="text-right">{money(r.cashRefunds)}</td>
                  <td className="text-right">{money(r.cashDrops)}</td><td className="text-right">{money(r.expectedClose)}</td>
                  <td className="text-right">{money(r.countedClose)}</td><td className="text-right">{shortPill(r.overShort)}</td>
                  <td className="text-right">{money(r.bagDrop)}</td><td>{statusChip(r.status)}</td><td>{r.closeBy || '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'employee' && (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-gray-500 border-b">
            <th className="py-2">Employee</th><th className="text-right">Days</th><th className="text-right">Cumulative Over/Short</th>
          </tr></thead>
          <tbody>{byEmployee.map((e, i) => (
            <tr key={i} className="border-b last:border-0"><td className="py-2">{e.name}</td>
              <td className="text-right">{e.days}</td><td className="text-right">{shortPill(Math.round(e.overShort * 100) / 100)}</td></tr>
          ))}</tbody>
        </table>
      )}

      {tab === 'compliance' && (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-gray-500 border-b">
            <th className="py-2">Date</th><th>Loc</th><th>Open</th><th>Close</th><th>Status</th>
          </tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0"><td className="py-2">{r.business_date}</td><td>{r.location_slug}</td>
              <td>{r.openBy || '--'}</td><td>{r.closeBy || '--'}</td><td>{statusChip(r.status)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}
```

> Replace the inline `<table>`/Tailwind with the shared `ReportBlock`/`StatBlock`
> primitives if `PosSalesReport.jsx` uses them, to match the one-block house style.

- [ ] **Step 2: Verify build**

Run: `cd portal && npx vite build`
Expected: build succeeds (no unresolved imports — confirm the block primitive import path).

- [ ] **Step 3: Commit**

```bash
git add portal/src/components/reports/TillReport.jsx
git commit -m "feat(till): Till report component"
```

### Task 4.3: Register the report (registry + role + render)

**Files:**
- Modify: `portal/src/components/ReportingView.jsx` (registry array ~line 56-76, render switch, role map)

**Interfaces:**
- Consumes: `TillReport` (4.2)

- [ ] **Step 1: Add the registry entry**

In the report registry array in `ReportingView.jsx` (after `pos-sales`), add:

```js
  { key: 'till', label: 'Till', desc: 'Cash Drawer Reconciliation' },
```

- [ ] **Step 2: Gate it manager+ and place it in the Club Health group**

Match how `pos-sales` is gated (manager+) and grouped — replicate that exact wiring for `till` (role map entry + group membership).

- [ ] **Step 3: Render it**

In the report render switch/map, import and render `TillReport` for `key === 'till'`, passing the same `{ locationSlug, from, to }` props the sibling reports receive:

```jsx
import TillReport from './reports/TillReport'
// ...
{active === 'till' && <TillReport locationSlug={locationSlug} from={from} to={to} />}
```

> Match the file's actual prop names for selected location + date range.

- [ ] **Step 4: Verify build + manual smoke**

Run: `cd portal && npx vite build` → succeeds.
Manual: log in as manager, open Reporting → Till, confirm the daily table renders, the three tabs switch, over/short pills color correctly, and a club with a counted close shows a non-null over/short.

- [ ] **Step 5: Commit, open PR**

```bash
git add portal/src/components/ReportingView.jsx
git commit -m "feat(till): register Till report in Reporting"
git push -u origin feat/till-report-ui
gh pr create --base master --title "Till Phase 4: Till report UI" --body "Manager+ Till report: daily reconciliation, by-employee over/short, count compliance. 🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-Review

**Spec coverage:**
- Tender capture (spec Phase 1) → Tasks 1.1-1.5 ✓
- Physical-register filter → encoded in Task 2.3 (`employee_id IS NOT NULL AND station_name <> 'ABC Transaction'`) ✓
- Reconciliation formula → Task 2.2 (pure, tested) + 2.3 (cash aggregation) + 2.5 (endpoint) ✓
- `till_settings` $100 par per club → Task 2.1 ✓
- Cash Drop POS item + test-ring verification → Task 2.4 ✓
- Operandio drawer-count capture (open + close) → Tasks 3.1-3.4 ✓
- `till_counts` schema with denominations jsonb (optional) → Task 3.1 ✓
- Reuse existing webhook pipeline → Task 3.4 ✓
- Till report UI: daily / by-employee / compliance → Tasks 4.1-4.3 ✓
- Alerts excluded → confirmed absent ✓
- One PR per phase, RLS, Pacific time, migration 070+ → Global Constraints + per-phase PR steps ✓

**Placeholder scan:** No "TBD"/"add error handling"-style gaps; the two fixture-dependent spots (drawer-count value regex in 3.3, drop payload sign in 2.4) are explicitly called out as verify-against-real-data steps with concrete starting code, which is the honest state given the data isn't observable until the Operandio jobs and ABC item exist.

**Type consistency:** `tenderCategory` → `extractItemPayments` → payment rows → `aggregateCashByDay`/`classifyCashLine` → `reconcileDay` field names (`cashSales`/`cashRefunds`/`cashDrops`, `openingCount`/`closingCount`, `overShort`/`bagDrop`/`floatVariance`/`status`) are consistent across Tasks 2.2, 2.3, 2.5 and the UI in 4.2. `count_type` values `'open'|'close'` consistent across 3.1, 3.3, 3.4, 2.5.

## Open items carried into implementation (verify against real data)
1. Confirm `employee_id IS NOT NULL AND station_name <> 'ABC Transaction'` cleanly isolates register sales across all 7 clubs (Task 2.3 Step 4).
2. Confirm Cash Drop payload sign/tender via Justin's test ring before trusting `classifyCashLine` (Task 2.4).
3. Confirm the drawer-count submission HTML value markup; tighten `extractRowValue` + the parser test to the exact entered amount (Tasks 3.2-3.3).
4. Confirm the composite payment→line join in PostgREST or use the documented batched-map fallback (Task 2.3 Step 3 NOTE).

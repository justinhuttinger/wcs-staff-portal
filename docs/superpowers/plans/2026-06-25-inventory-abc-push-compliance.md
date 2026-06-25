# Inventory: ABC Stock Push + Compliance Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror every portal restock/count to ABC via `PUT Stock Level` (best-effort, flagged + retried), and add a per-location Compliance scoreboard to the POS Sales report.

**Architecture:** A new injectable ABC client module (`abcStockLevel.js`) with pure body-building and result-classification helpers. The three stock-write endpoints in `inventory.js` call `pushMovement` inline after the portal write commits; the `inventory_movements` row carries the push status and doubles as the retry queue. A node-cron job in `inventorySync.js` retries failed/stuck pushes. A new `/inventory/compliance` endpoint backs a 4th sub-tab in `PosSalesReport.jsx`.

**Tech Stack:** Node/Express (auth service), `node:test`/`node:assert` unit tests (run with `node --test`), Supabase Postgres (migrations via Supabase MCP `apply_migration` on project `ybopxxydsuwlbwxiuzve`), React + Vite (portal frontend).

## Global Constraints

- ABC PUT path is `club/items` (singular): `PUT {ABC_BASE_URL}/{clubNumber}/club/items/{saleItemId}`. ABC auth headers `app_id` / `app_key` / `Accept: application/json` come from the same env as `auth/src/services/abcInventory.js`.
- `unitCost` is **omitted by default**; included only when `ABC_STOCK_PUSH_SEND_COST=1`, formatted as a 2-decimal string of `avg_unit_cost ?? last_unit_cost`.
- `add` quantity: positive integer, ≤4 digits, non-zero. `override` quantity: integer ≥0. Non-integer/zero/negative `add` deltas are **skipped** (status `skipped`, no error).
- `reason`: `add` → `Received` (only `Received`/`Recovered`/`Transfer In` are valid). `override` → omit `reason`.
- `notes`: ≤500 chars, strip banned chars `# $ & * ( ) ` = { } : < > ? [ ] ; ' , /`.
- Override equal to ABC's current stock returns `API-CLU-ITM-0007` — treat as **benign success** (`synced`), not an error.
- Retry job: opt-out `INVENTORY_ABC_PUSH_DISABLED=1`; max 5 attempts/movement; ≤100 movements/run.
- New migration file: `auth/migrations/056_inventory_abc_push.sql` (highest existing is 055).
- Compliance endpoint and POS Sales financial endpoints are `requireRole('manager')`. Portal DB access is service-role; new tables/columns keep RLS conventions (no new tables here, only columns).
- Never use em-dashes in user-facing copy. Copy buttons (n/a here). Open a PR; never auto-merge.

---

### Task 1: Migration — ABC push columns on `inventory_movements`

**Files:**
- Create: `auth/migrations/056_inventory_abc_push.sql`

**Interfaces:**
- Produces: columns `abc_push_status` (text), `abc_action` (text), `abc_push_error` (text), `abc_push_attempts` (int default 0), `abc_pushed_at` (timestamptz) on `public.inventory_movements`; partial index on `(abc_push_status)` for the retry scan.

- [ ] **Step 1: Write the migration SQL**

```sql
-- 056_inventory_abc_push.sql
-- Best-effort mirror of portal stock changes to ABC PUT Stock Level. Each
-- stock-changing movement carries its own push status; this row IS the retry
-- queue. POS-origin movements are inserted with abc_push_status='na'.
alter table public.inventory_movements
  add column if not exists abc_push_status   text,            -- na|pending|synced|failed|skipped
  add column if not exists abc_action        text,            -- add|override
  add column if not exists abc_push_error     text,
  add column if not exists abc_push_attempts  integer not null default 0,
  add column if not exists abc_pushed_at      timestamptz;

-- The retry job scans for failed/stuck-pending rows; index just those.
create index if not exists inventory_movements_abc_push_pending_idx
  on public.inventory_movements (abc_push_status)
  where abc_push_status in ('pending', 'failed');
```

- [ ] **Step 2: Apply via Supabase MCP**

Apply the file's SQL with `mcp__supabase__apply_migration` (name `inventory_abc_push`, project `ybopxxydsuwlbwxiuzve`).
Expected: success, no error.

- [ ] **Step 3: Verify columns exist**

Run `mcp__supabase__execute_sql`:
```sql
select column_name from information_schema.columns
where table_name = 'inventory_movements' and column_name like 'abc_%' order by 1;
```
Expected: 5 rows — `abc_action, abc_push_attempts, abc_push_error, abc_pushed_at, abc_push_status`.

- [ ] **Step 4: Commit**

```bash
git add auth/migrations/056_inventory_abc_push.sql
git commit -m "feat(inventory): migration 056 — ABC push status columns on movements"
```

---

### Task 2: Pure helpers — `buildStockBody` + `classifyAbcResult`

**Files:**
- Create: `auth/src/services/abcStockLevel.js`
- Test: `auth/src/services/abcStockLevel.test.js`

**Interfaces:**
- Produces:
  - `buildStockBody({ action, quantity, unitCost, vendor, reason, notes })` → `{ ok: boolean, body?: object, skipReason?: string }`. Pure. Applies all Global Constraints (quantity rules, notes sanitize, cost inclusion gated on the `unitCost` arg being a finite number, reason omission for override). Returns `ok:false` with `skipReason` for a non-integer/zero/negative `add` quantity.
  - `sanitizeNotes(s)` → string (≤500, banned chars stripped). Pure helper used by `buildStockBody`.
  - `classifyAbcResult(json)` → `{ ok: boolean, code: string|null, message: string|null, benign: boolean }`. Pure. `benign` is true when the only error code is `API-CLU-ITM-0007` (override == current).
- Consumes: nothing (no I/O in this task).

- [ ] **Step 1: Write the failing tests**

```js
// auth/src/services/abcStockLevel.test.js
const test = require('node:test')
const assert = require('node:assert')
const { buildStockBody, sanitizeNotes, classifyAbcResult } = require('./abcStockLevel')

test('buildStockBody: add maps reason Received, integer string quantity, no cost by default', () => {
  const r = buildStockBody({ action: 'add', quantity: 10, vendor: 'Bear Vending', notes: 'restock' })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.body, { action: 'add', quantity: '10', vendor: 'Bear Vending', reason: 'Received', notes: 'restock' })
})

test('buildStockBody: override omits reason and accepts zero', () => {
  const r = buildStockBody({ action: 'override', quantity: 0 })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.body.action, 'override')
  assert.strictEqual(r.body.quantity, '0')
  assert.ok(!('reason' in r.body))
})

test('buildStockBody: includes unitCost only when a finite number is passed', () => {
  const r = buildStockBody({ action: 'add', quantity: 3, unitCost: 9 })
  assert.strictEqual(r.body.unitCost, '9.00')
  const r2 = buildStockBody({ action: 'add', quantity: 3 })
  assert.ok(!('unitCost' in r2.body))
})

test('buildStockBody: skips non-integer / zero / negative add quantity', () => {
  assert.strictEqual(buildStockBody({ action: 'add', quantity: 1.5 }).ok, false)
  assert.strictEqual(buildStockBody({ action: 'add', quantity: 0 }).ok, false)
  assert.strictEqual(buildStockBody({ action: 'add', quantity: -2 }).ok, false)
})

test('sanitizeNotes: strips banned chars and caps length', () => {
  assert.strictEqual(sanitizeNotes('count by Jane (D) #1'), 'count by Jane D 1')
  assert.strictEqual(sanitizeNotes('x'.repeat(600)).length, 500)
})

test('classifyAbcResult: success', () => {
  const r = classifyAbcResult({ status: { message: 'Sale Item updated successfully.', messageCode: 'API-CLU-ITM-0000' } })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.benign, false)
})

test('classifyAbcResult: override-equals-current is benign', () => {
  const r = classifyAbcResult({ status: { messageCode: 'API-CLU-ITM-0010' }, errorMessages: [{ message: 'New quantity cannot be the same as In Stock for Overrides', messageCode: 'API-CLU-ITM-0007' }] })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.benign, true)
  assert.strictEqual(r.code, 'API-CLU-ITM-0007')
})

test('classifyAbcResult: real error is not benign', () => {
  const r = classifyAbcResult({ status: { messageCode: 'API-CLU-ITM-0010' }, errorMessages: [{ message: 'The unit cost is incorrect.', messageCode: 'API-CLU-ITM-0005' }] })
  assert.strictEqual(r.benign, false)
  assert.strictEqual(r.code, 'API-CLU-ITM-0005')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/services/abcStockLevel.test.js` (from `auth/`)
Expected: FAIL — `Cannot find module './abcStockLevel'`.

- [ ] **Step 3: Write the pure helpers**

```js
// auth/src/services/abcStockLevel.js
// ABC Financial "PUT Stock Level" client for the Inventory tool. Mirrors portal
// restocks (action=add) and physical counts (action=override) to ABC so its
// inStock reflects the floor. unitCost is omitted by default (ABC requires it to
// match a previously-available value or it rejects the whole PUT); set
// ABC_STOCK_PUSH_SEND_COST=1 to include it.

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest'
const ABC_APP_ID = process.env.ABC_APP_ID
const ABC_APP_KEY = process.env.ABC_APP_KEY

// ABC bans these characters in notes (API-CLU-ITM-0009).
const BANNED_NOTES_CHARS = /[#$&*()`={}:<>?\[\];'’,/\\]/g

function sanitizeNotes(s) {
  if (!s) return ''
  return String(s).replace(BANNED_NOTES_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, 500)
}

// Build the PUT body, applying ABC's validation rules. Returns { ok:false,
// skipReason } when the value cannot legally be sent (so the caller marks the
// movement 'skipped' rather than attempting a doomed request).
function buildStockBody({ action, quantity, unitCost, vendor, reason, notes }) {
  if (action !== 'add' && action !== 'override') return { ok: false, skipReason: `bad action ${action}` }
  const q = Number(quantity)
  if (!Number.isFinite(q)) return { ok: false, skipReason: 'non-numeric quantity' }
  if (action === 'add') {
    if (!Number.isInteger(q) || q <= 0) return { ok: false, skipReason: 'add quantity must be a positive integer' }
    if (q > 9999) return { ok: false, skipReason: 'add quantity exceeds 4 digits' }
  } else { // override
    if (q < 0) return { ok: false, skipReason: 'override quantity must be >= 0' }
  }
  const body = { action, quantity: String(Math.trunc(q)) }
  if (Number.isFinite(Number(unitCost))) body.unitCost = Number(unitCost).toFixed(2)
  if (vendor) body.vendor = String(vendor).slice(0, 100)
  if (action === 'add') body.reason = reason || 'Received' // override: no reason
  const n = sanitizeNotes(notes)
  if (n) body.notes = n
  return { ok: true, body }
}

// Parse an ABC response envelope. benign=true means "ABC declined but it's a
// no-op we can treat as already-synced" (override equals current stock).
function classifyAbcResult(json) {
  const code = json?.status?.messageCode || null
  if (code && code !== 'API-CLU-ITM-0010' && /-0000$/.test(code)) {
    return { ok: true, code, message: json?.status?.message || null, benign: false }
  }
  const errs = Array.isArray(json?.errorMessages) ? json.errorMessages : []
  if (errs.length === 0 && (!code || /-0000$/.test(code))) {
    return { ok: true, code, message: json?.status?.message || null, benign: false }
  }
  const first = errs[0] || {}
  const errCode = first.messageCode || code
  return {
    ok: false,
    code: errCode || null,
    message: first.message || json?.status?.message || null,
    benign: errCode === 'API-CLU-ITM-0007',
  }
}

module.exports = { buildStockBody, sanitizeNotes, classifyAbcResult, ABC_BASE_URL, ABC_APP_ID, ABC_APP_KEY }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/services/abcStockLevel.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/abcStockLevel.js src/services/abcStockLevel.test.js
git commit -m "feat(inventory): ABC stock-level body builder + result classifier (pure, tested)"
```

---

### Task 3: `putStockLevel` + `pushMovement` (ABC I/O + DB write-back)

**Files:**
- Modify: `auth/src/services/abcStockLevel.js`
- Test: `auth/src/services/abcStockLevel.test.js` (add tests with an injected fetch + Supabase stub)

**Interfaces:**
- Consumes: `buildStockBody`, `classifyAbcResult` (Task 2); `supabaseAdmin` from `./supabase`.
- Produces:
  - `putStockLevel(clubNumber, saleItemId, opts, deps = {})` → `{ status: 'synced'|'failed'|'skipped', code, error }`. `deps.fetchImpl` defaults to global `fetch` (injectable for tests). Performs the PUT; `opts` is the `buildStockBody` arg set.
  - `pushMovement(movementId, deps = {})` → same result shape. Loads the movement + its item, derives `{ action, quantity, vendor, reason, notes, unitCost? }`, calls `putStockLevel`, and writes `abc_push_status` / `abc_action` / `abc_push_error` / `abc_push_attempts` (incremented) / `abc_pushed_at` back onto the row. `deps.db` defaults to `supabaseAdmin`. Returns `{ status:'skipped' }` when the item has no `sale_item_id`.

- [ ] **Step 1: Write failing tests (injected fetch + db stub)**

```js
// append to auth/src/services/abcStockLevel.test.js
const { putStockLevel } = require('./abcStockLevel')

function fakeFetch(responseJson, ok = true) {
  return async () => ({ ok, status: ok ? 200 : 400, json: async () => responseJson, text: async () => JSON.stringify(responseJson) })
}

test('putStockLevel: success → synced', async () => {
  const r = await putStockLevel('1234', 'SALE1', { action: 'add', quantity: 5 }, {
    fetchImpl: fakeFetch({ status: { message: 'Sale Item updated successfully.', messageCode: 'API-CLU-ITM-0000' } }),
  })
  assert.strictEqual(r.status, 'synced')
})

test('putStockLevel: benign override → synced', async () => {
  const r = await putStockLevel('1234', 'SALE1', { action: 'override', quantity: 2 }, {
    fetchImpl: fakeFetch({ status: { messageCode: 'API-CLU-ITM-0010' }, errorMessages: [{ messageCode: 'API-CLU-ITM-0007', message: 'same as in stock' }] }, false),
  })
  assert.strictEqual(r.status, 'synced')
})

test('putStockLevel: real error → failed with code', async () => {
  const r = await putStockLevel('1234', 'SALE1', { action: 'add', quantity: 5 }, {
    fetchImpl: fakeFetch({ status: { messageCode: 'API-CLU-ITM-0010' }, errorMessages: [{ messageCode: 'API-CLU-ITM-0005', message: 'The unit cost is incorrect.' }] }, false),
  })
  assert.strictEqual(r.status, 'failed')
  assert.strictEqual(r.code, 'API-CLU-ITM-0005')
})

test('putStockLevel: unsendable value → skipped (no fetch call)', async () => {
  let called = false
  const r = await putStockLevel('1234', 'SALE1', { action: 'add', quantity: 0 }, {
    fetchImpl: async () => { called = true; return { ok: true, json: async () => ({}) } },
  })
  assert.strictEqual(r.status, 'skipped')
  assert.strictEqual(called, false)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test src/services/abcStockLevel.test.js`
Expected: FAIL — `putStockLevel is not a function`.

- [ ] **Step 3: Implement `putStockLevel` and `pushMovement`**

Add to `abcStockLevel.js` (before `module.exports`, and extend the export list):

```js
const { supabaseAdmin } = require('./supabase')

function abcHeaders() {
  if (!ABC_APP_ID || !ABC_APP_KEY) throw new Error('ABC_APP_ID and ABC_APP_KEY must be set')
  return { app_id: ABC_APP_ID, app_key: ABC_APP_KEY, Accept: 'application/json', 'Content-Type': 'application/json' }
}

async function putStockLevel(clubNumber, saleItemId, opts, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch
  const built = buildStockBody(opts)
  if (!built.ok) return { status: 'skipped', code: null, error: built.skipReason }
  if (!clubNumber || !saleItemId) return { status: 'skipped', code: null, error: 'missing club or saleItemId' }
  const url = `${ABC_BASE_URL}/${clubNumber}/club/items/${saleItemId}`
  try {
    const res = await fetchImpl(url, {
      method: 'PUT', headers: abcHeaders(), body: JSON.stringify(built.body),
      signal: AbortSignal.timeout(30000),
    })
    let json = {}
    try { json = await res.json() } catch { json = {} }
    const c = classifyAbcResult(json)
    if (c.ok || c.benign) return { status: 'synced', code: c.code, error: null }
    return { status: 'failed', code: c.code, error: (c.message || `HTTP ${res.status}`).slice(0, 500) }
  } catch (e) {
    return { status: 'failed', code: null, error: String(e.message || e).slice(0, 500) }
  }
}

// Map a movement kind to an ABC action. count = absolute set = override;
// adjustment/received = add. Anything else is not pushed.
function actionForKind(kind) {
  if (kind === 'count') return 'override'
  if (kind === 'adjustment' || kind === 'received') return 'add'
  return null
}

async function pushMovement(movementId, deps = {}) {
  const db = deps.db || supabaseAdmin
  const sendCost = process.env.ABC_STOCK_PUSH_SEND_COST === '1'
  const { data: mv } = await db.from('inventory_movements').select('*').eq('id', movementId).maybeSingle()
  if (!mv) return { status: 'skipped', code: null, error: 'movement not found' }
  const action = actionForKind(mv.kind)
  if (!action) return { status: 'skipped', code: null, error: `kind ${mv.kind} not pushable` }

  const { data: item } = await db.from('inventory_items').select('sale_item_id, avg_unit_cost, last_unit_cost').eq('id', mv.item_id).maybeSingle()
  const saleItemId = item?.sale_item_id || null

  const quantity = action === 'override' ? mv.qty_after : mv.qty_delta
  const unitCost = sendCost ? (item?.avg_unit_cost ?? item?.last_unit_cost) : undefined
  let result
  if (!saleItemId) {
    result = { status: 'skipped', code: null, error: 'item has no ABC sale_item_id' }
  } else {
    result = await putStockLevel(mv.club_number, saleItemId, {
      action, quantity, unitCost, notes: mv.note || null,
    }, deps)
  }

  await db.from('inventory_movements').update({
    abc_push_status: result.status,
    abc_action: action,
    abc_push_error: result.error || null,
    abc_push_attempts: (mv.abc_push_attempts || 0) + 1,
    abc_pushed_at: new Date().toISOString(),
  }).eq('id', movementId)
  return result
}

```

Then update the export line to add the new functions:

```js
module.exports = { buildStockBody, sanitizeNotes, classifyAbcResult, putStockLevel, pushMovement, actionForKind, ABC_BASE_URL, ABC_APP_ID, ABC_APP_KEY }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/services/abcStockLevel.test.js`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/abcStockLevel.js src/services/abcStockLevel.test.js
git commit -m "feat(inventory): putStockLevel + pushMovement with status write-back"
```

---

### Task 4: Wire push into the three stock-write endpoints

**Files:**
- Modify: `auth/src/routes/inventory.js` (the `/items/:id/adjust` handler ~line 326, the `/invoices/:id/receive` handler ~line 1364, and the require block at top)

**Interfaces:**
- Consumes: `pushMovement` from `../services/abcStockLevel` (Task 3).
- Produces: each stock-write response gains an `abc_push` field. `/items/:id/adjust` → `abc_push: { status, error }`. `/invoices/:id/receive` → `abc_push: { synced, failed, skipped }` aggregate.

- [ ] **Step 1: Add the require**

At the top of `inventory.js` with the other service requires:

```js
const { pushMovement } = require('../services/abcStockLevel')
```

- [ ] **Step 2: Capture movement id in `/items/:id/adjust` and push**

In the adjust handler, the movement insert currently discards the row. Change it to return the id, then push after the item update. Replace the insert + update tail:

```js
    const { data: mvRow, error: mErr } = await supabaseAdmin.from('inventory_movements').insert({
      item_id: item.id,
      club_number: item.club_number,
      kind,
      qty_delta: delta,
      qty_after: after,
      source: req.body.source === 'mobile' ? 'mobile' : 'manual',
      note: typeof req.body.note === 'string' ? req.body.note.slice(0, 500) : null,
      created_by: req.staff.id,
      created_by_name: req.staff.display_name || req.staff.email || null,
      abc_push_status: 'pending',
    }).select('id').single()
    if (mErr) throw mErr

    const { data: updated, error: uErr } = await supabaseAdmin
      .from('inventory_items').update({ qty_on_hand: after }).eq('id', item.id).select().single()
    if (uErr) throw uErr

    // Best-effort mirror to ABC; never blocks the portal write.
    let abcPush = { status: 'pending', error: null }
    try { abcPush = await pushMovement(mvRow.id) } catch (e) { abcPush = { status: 'failed', error: e.message } }
    res.json({ item: decorateItem(updated), abc_push: { status: abcPush.status, error: abcPush.error || null } })
```

- [ ] **Step 3: Mark POS-origin movements `na` (so the retry job ignores them)**

POS movements are written in `auth/src/services/inventorySync.js`. Find each `inventory_movements` insert with `source: 'abc_pos'` (kinds `sale`/`return`) and add `abc_push_status: 'na'` to the inserted object. (Search `kind: 'sale'` / `source: 'abc_pos'` in that file.) If the inserts are built from a shared object, add the field once there.

```js
// each abc_pos movement insert gains:
abc_push_status: 'na',
```

- [ ] **Step 4: Capture + push each received line in `/invoices/:id/receive`**

In the receive loop, the per-line movement insert currently discards the row. Capture its id, set `abc_push_status:'pending'`, collect ids, and push them after the loop. Modify the insert to `.select('id').single()` and accumulate:

```js
      const { data: mvRow, error: mErr } = await supabaseAdmin.from('inventory_movements').insert({
        item_id: item.id,
        club_number: item.club_number,
        kind: 'received',
        qty_delta: qty,
        qty_after: (num(item.qty_on_hand) || 0) + qty,
        unit_cost: cost,
        source: 'invoice',
        ref_id: invoice.id,
        note: invoice.vendor + (invoice.invoice_number ? ` #${invoice.invoice_number}` : ''),
        created_by: req.staff.id,
        created_by_name: req.staff.display_name || req.staff.email || null,
        abc_push_status: 'pending',
      }).select('id').single()
      if (mErr) throw mErr
      pushIds.push(mvRow.id)
```

Declare `const pushIds = []` before the loop. After the invoice `received_at` update, push them and aggregate:

```js
    const abcAgg = { synced: 0, failed: 0, skipped: 0 }
    for (const id of pushIds) {
      let r
      try { r = await pushMovement(id) } catch { r = { status: 'failed' } }
      if (r.status === 'synced') abcAgg.synced++
      else if (r.status === 'skipped') abcAgg.skipped++
      else abcAgg.failed++
    }
    res.json({ success: true, applied, skipped: (lines || []).length - applied, abc_push: abcAgg })
```

(Remove the old `res.json({ success: true, applied, ... })` line it replaces.)

- [ ] **Step 5: Smoke-test the route loads**

Run (from `auth/`): `node -e "require('./src/routes/inventory.js'); console.log('ok')"`
Expected: prints `ok` (no syntax/require errors).

- [ ] **Step 6: Commit**

```bash
git add src/routes/inventory.js src/services/inventorySync.js
git commit -m "feat(inventory): push restocks, counts, and invoice receives to ABC inline"
```

---

### Task 5: Retry cron for failed/stuck pushes

**Files:**
- Modify: `auth/src/services/inventorySync.js` (add a cron registration + an exported `runAbcPushRetry`)
- Test: `auth/src/services/abcPushRetry.test.js`

**Interfaces:**
- Consumes: `pushMovement` (Task 3).
- Produces: `runAbcPushRetry(deps = {})` → `{ attempted, synced, failed, skipped }`. Selects up to 100 `inventory_movements` with `abc_push_status in ('failed','pending')` and `abc_push_attempts < 5`, oldest `occurred_at` first, and re-runs `pushMovement` on each. `deps.db` and `deps.push` injectable.

- [ ] **Step 1: Write the failing test**

```js
// auth/src/services/abcPushRetry.test.js
const test = require('node:test')
const assert = require('node:assert')
const { runAbcPushRetry } = require('./inventorySync')

// Minimal fake supabase query chain returning two pending rows.
function fakeDb(rows) {
  return {
    from() { return this },
    select() { return this },
    in() { return this },
    lt() { return this },
    order() { return this },
    limit() { return Promise.resolve({ data: rows, error: null }) },
  }
}

test('runAbcPushRetry: re-pushes each selected movement', async () => {
  const seen = []
  const res = await runAbcPushRetry({
    db: fakeDb([{ id: 'a' }, { id: 'b' }]),
    push: async (id) => { seen.push(id); return { status: id === 'a' ? 'synced' : 'failed' } },
  })
  assert.deepStrictEqual(seen, ['a', 'b'])
  assert.strictEqual(res.attempted, 2)
  assert.strictEqual(res.synced, 1)
  assert.strictEqual(res.failed, 1)
})

test('runAbcPushRetry: disabled via env returns zero', async () => {
  process.env.INVENTORY_ABC_PUSH_DISABLED = '1'
  const res = await runAbcPushRetry({ db: fakeDb([{ id: 'a' }]), push: async () => ({ status: 'synced' }) })
  delete process.env.INVENTORY_ABC_PUSH_DISABLED
  assert.strictEqual(res.attempted, 0)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test src/services/abcPushRetry.test.js`
Expected: FAIL — `runAbcPushRetry is not a function`.

- [ ] **Step 3: Implement `runAbcPushRetry` and register cron**

Add to `inventorySync.js`. Add the require near the top:

```js
const { pushMovement } = require('./abcStockLevel')
```

Add the function:

```js
// Retry ABC stock pushes that failed or never completed. The movements row is
// the queue; bounded attempts stop a permanently-rejecting row from looping.
async function runAbcPushRetry(deps = {}) {
  if (process.env.INVENTORY_ABC_PUSH_DISABLED === '1') return { attempted: 0, synced: 0, failed: 0, skipped: 0 }
  const db = deps.db || supabaseAdmin
  const push = deps.push || pushMovement
  const { data: rows, error } = await db
    .from('inventory_movements')
    .select('id')
    .in('abc_push_status', ['failed', 'pending'])
    .lt('abc_push_attempts', 5)
    .order('occurred_at', { ascending: true })
    .limit(100)
  if (error) throw error
  const out = { attempted: 0, synced: 0, failed: 0, skipped: 0 }
  for (const r of rows || []) {
    out.attempted++
    let res
    try { res = await push(r.id) } catch { res = { status: 'failed' } }
    if (res.status === 'synced') out.synced++
    else if (res.status === 'skipped') out.skipped++
    else out.failed++
  }
  return out
}
```

Register a cron alongside the existing schedules (find the `cron.schedule(` block and add one; every 15 minutes):

```js
  // Retry failed/stuck ABC stock pushes every 15 minutes.
  cron.schedule('*/15 * * * *', () => {
    runAbcPushRetry().then(
      (r) => { if (r.attempted) console.log('[Inventory] ABC push retry:', JSON.stringify(r)) },
      (e) => console.error('[Inventory] ABC push retry failed:', e.message),
    )
  })
```

Add `runAbcPushRetry` to `module.exports` of `inventorySync.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/services/abcPushRetry.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/inventorySync.js src/services/abcPushRetry.test.js
git commit -m "feat(inventory): node-cron retry for failed ABC stock pushes"
```

---

### Task 6: `/inventory/compliance` endpoint

**Files:**
- Modify: `auth/src/routes/inventory.js` (add the route, manager+, near `/shrinkage`)

**Interfaces:**
- Consumes: `clubFilter`, `fetchAllRows`, `isSellableItem`, `CLUB_TO_SLUG`, `SLUG_CLUB_MAP`, `ALL_SLUGS` patterns already in the file.
- Produces: `GET /inventory/compliance?location_slug=&overdue_days=` returning `{ overdue_days, clubs: [ { location_slug, club_number, last_count_at, days_since_count, last_restock_at, days_since_restock, tracked_items, never_counted_items, status } ], rollup: { clubs, overdue, never, ok } }`. `status` ∈ `ok|overdue|never`.

- [ ] **Step 1: Implement the route**

Add after the `/shrinkage` handler:

```js
// GET /compliance?location_slug=&overdue_days=30 — per-club "how long since we
// last counted / restocked" scoreboard so managers can see which teams are
// letting physical counts slip. Status keys off COUNT age (the discipline being
// measured); restock is context only. Manager+.
router.get('/compliance', requireRole('manager'), async (req, res) => {
  try {
    const { clubs, error: cErr } = clubFilter(req)
    if (cErr) return res.status(400).json({ error: cErr })
    const overdueDays = Math.min(Math.max(parseInt(req.query.overdue_days) || 30, 1), 365)

    // Sellable tracked items per club (for tracked + never-counted scope).
    const makeItems = () => {
      let q = supabaseAdmin.from('inventory_items').select('id, club_number, category, profit_center, upc, is_tracked').eq('archived', false)
      if (clubs) q = q.in('club_number', clubs)
      return q
    }
    const items = (await fetchAllRows(makeItems)).filter(isSellableItem)

    // Latest count + restock timestamp per (club). One pass over count/restock
    // movements ordered newest-first; first seen per club wins.
    const makeMoves = () => {
      let q = supabaseAdmin.from('inventory_movements')
        .select('club_number, kind, occurred_at, item_id')
        .in('kind', ['count', 'received', 'adjustment'])
        .order('occurred_at', { ascending: false })
      if (clubs) q = q.in('club_number', clubs)
      return q
    }
    const moves = await fetchAllRows(makeMoves)
    const lastCount = new Map()   // club -> iso
    const lastRestock = new Map() // club -> iso
    const countedItems = new Set() // `${club}:${item_id}` ever counted
    for (const m of moves) {
      if (m.kind === 'count') {
        if (!lastCount.has(m.club_number)) lastCount.set(m.club_number, m.occurred_at)
        if (m.item_id) countedItems.add(`${m.club_number}:${m.item_id}`)
      } else if (!lastRestock.has(m.club_number)) {
        lastRestock.set(m.club_number, m.occurred_at)
      }
    }

    // Which clubs to report: the filtered set, or all 7 when unfiltered, so an
    // untouched club still shows as "never".
    const clubNumbers = clubs || [...new Set(Object.values(SLUG_CLUB_MAP))]
    const trackedByClub = new Map()
    const neverByClub = new Map()
    for (const it of items) {
      trackedByClub.set(it.club_number, (trackedByClub.get(it.club_number) || 0) + 1)
      if (!countedItems.has(`${it.club_number}:${it.id}`)) {
        neverByClub.set(it.club_number, (neverByClub.get(it.club_number) || 0) + 1)
      }
    }

    const now = Date.now()
    const daysSince = (iso) => iso ? Math.floor((now - new Date(iso).getTime()) / 86400000) : null
    const rows = clubNumbers.map((club) => {
      const lc = lastCount.get(club) || null
      const dsc = daysSince(lc)
      const status = lc == null ? 'never' : (dsc > overdueDays ? 'overdue' : 'ok')
      return {
        location_slug: CLUB_TO_SLUG[club] || null,
        club_number: club,
        last_count_at: lc,
        days_since_count: dsc,
        last_restock_at: lastRestock.get(club) || null,
        days_since_restock: daysSince(lastRestock.get(club) || null),
        tracked_items: trackedByClub.get(club) || 0,
        never_counted_items: neverByClub.get(club) || 0,
        status,
      }
    }).sort((a, b) => {
      // Worst discipline first: never, then most-overdue.
      const rank = (s) => (s === 'never' ? 2 : s === 'overdue' ? 1 : 0)
      return rank(b.status) - rank(a.status) || (b.days_since_count ?? -1) - (a.days_since_count ?? -1)
    })

    const rollup = {
      clubs: rows.length,
      overdue: rows.filter(r => r.status === 'overdue').length,
      never: rows.filter(r => r.status === 'never').length,
      ok: rows.filter(r => r.status === 'ok').length,
    }
    res.json({ overdue_days: overdueDays, clubs: rows, rollup })
  } catch (err) {
    console.error('[Inventory] compliance error:', err.message)
    res.status(500).json({ error: err.message })
  }
})
```

- [ ] **Step 2: Smoke-test the route loads**

Run (from `auth/`): `node -e "require('./src/routes/inventory.js'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/inventory.js
git commit -m "feat(inventory): /compliance per-location count/restock scoreboard"
```

---

### Task 7: Compliance tab in the POS Sales report

**Files:**
- Modify: `portal/src/lib/api.js` (add `getInventoryCompliance`)
- Modify: `portal/src/components/reports/PosSalesReport.jsx` (add the sub-tab + view)

**Interfaces:**
- Consumes: `getInventoryCompliance` (new); `startDate`/`endDate`/`locationSlug` props the component already receives.
- Produces: a `compliance` sub-tab rendering the scoreboard.

- [ ] **Step 1: Add the api client function**

In `portal/src/lib/api.js`, after `getInventoryShrinkage`:

```js
export async function getInventoryCompliance(params = {}) {
  return api('/inventory/compliance' + inventoryQs(params))
}
```

- [ ] **Step 2: Add the sub-tab + data load**

In `PosSalesReport.jsx`:
- Add to the import: `getInventoryCompliance`.
- Add to `SUB_TABS`: `{ key: 'compliance', label: 'Compliance' }`.
- Add state: `const [compliance, setCompliance] = useState(null)` and `const [overdueDays, setOverdueDays] = useState(30)`.
- In the effect that loads per-tab data, add a branch for `compliance` that calls `getInventoryCompliance({ location_slug: locationSlug, overdue_days: overdueDays })` and stores `res` (refetch when `overdueDays`, `locationSlug` change). Note: compliance is point-in-time (last count to now), so `startDate`/`endDate` are not sent.

- [ ] **Step 3: Render the scoreboard**

Add a `compliance` render branch:

```jsx
{tab === 'compliance' && (
  <div>
    <div className="flex items-center gap-2 mb-3 text-sm">
      <label className="text-text-muted">Overdue after</label>
      <input type="number" min="1" max="365" value={overdueDays}
        onChange={(e) => setOverdueDays(Math.max(1, Math.min(365, Number(e.target.value) || 30)))}
        className="w-20 px-2 py-1 border border-border rounded text-right" />
      <span className="text-text-muted">days without a count</span>
    </div>
    {compliance && (
      <div className="text-sm text-text-muted mb-2">
        {compliance.rollup.overdue} overdue · {compliance.rollup.never} never counted · {compliance.rollup.ok} on track
      </div>
    )}
    <table className="w-full text-sm">
      <thead>
        <tr className="text-text-muted border-b border-border">
          <th className="text-left py-2 px-4">Club</th>
          <th className="text-right py-2 px-2">Last count</th>
          <th className="text-right py-2 px-2">Days since</th>
          <th className="text-right py-2 px-2">Last restock</th>
          <th className="text-right py-2 px-2">Tracked</th>
          <th className="text-right py-2 px-2">Never counted</th>
          <th className="text-right py-2 px-2">Status</th>
        </tr>
      </thead>
      <tbody>
        {(compliance?.clubs || []).map((c) => {
          const badge = c.status === 'overdue' ? 'bg-red-100 text-wcs-red'
            : c.status === 'never' ? 'bg-gray-100 text-text-muted'
            : 'bg-emerald-100 text-emerald-700'
          const label = c.status === 'overdue' ? 'Overdue' : c.status === 'never' ? 'Never' : 'OK'
          return (
            <tr key={c.club_number} className="border-b border-border/50">
              <td className="py-2 px-4 capitalize">{c.location_slug || c.club_number}</td>
              <td className="py-2 px-2 text-right">{fmtDateTime(c.last_count_at)}</td>
              <td className="py-2 px-2 text-right">{c.days_since_count == null ? '—' : c.days_since_count}</td>
              <td className="py-2 px-2 text-right">{fmtDateTime(c.last_restock_at)}</td>
              <td className="py-2 px-2 text-right">{c.tracked_items}</td>
              <td className="py-2 px-2 text-right">{c.never_counted_items}</td>
              <td className="py-2 px-2 text-right"><span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${badge}`}>{label}</span></td>
            </tr>
          )
        })}
      </tbody>
    </table>
  </div>
)}
```

- [ ] **Step 4: Build the frontend to verify it compiles**

Run (from `portal/`): `npm run build`
Expected: build succeeds with no errors referencing `PosSalesReport` or `api.js`. (quagga2 may need `npm install --no-save @ericblade/quagga2` first if the build complains, per prior inventory work.)

- [ ] **Step 5: Commit**

```bash
git add portal/src/lib/api.js portal/src/components/reports/PosSalesReport.jsx
git commit -m "feat(inventory): Compliance tab in POS Sales report"
```

---

### Task 8: Final verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Run the full auth test suite**

Run (from `auth/`): `node --test src/services/abcStockLevel.test.js src/services/abcPushRetry.test.js`
Expected: all PASS.

- [ ] **Step 2: Smoke-test both modified servers load**

Run (from `auth/`): `node -e "require('./src/routes/inventory.js'); require('./src/services/inventorySync.js'); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Confirm migration is applied**

Re-run the Task 1 Step 3 verification query; expect the 5 `abc_*` columns.

- [ ] **Step 4: Push branch and open PR**

```bash
git push -u origin feat/inventory-abc-push-compliance
gh pr create --title "Inventory: push restocks/counts to ABC + compliance tab" --body "<summary + test notes + ABC_STOCK_PUSH_SEND_COST / INVENTORY_ABC_PUSH_DISABLED toggles + migration 056 applied>"
```

Do not merge — Justin merges.

---

## Self-Review notes

- **Spec coverage:** Part 1 push (Tasks 2-5), unitCost env flag (Task 3 `pushMovement`, Global Constraints), best-effort + movement-as-queue + retry (Tasks 1, 4, 5), benign override (Task 2/3), POS `na` exclusion (Task 4 Step 3), Part 2 compliance endpoint + tab (Tasks 6-7). Migration (Task 1). All covered.
- **Type consistency:** `pushMovement(id, deps)` / `putStockLevel(club, saleItemId, opts, deps)` / `runAbcPushRetry(deps)` / `buildStockBody(opts)→{ok,body,skipReason}` / `classifyAbcResult(json)→{ok,code,message,benign}` used consistently across tasks. Movement columns named identically to migration 056.
- **Open risk (documented in spec):** ABC may reject pushes without `unitCost`, or reject `override` without a `reason` — both surface in `abc_push_error`; the env flag and a one-line reason addition are the responses.

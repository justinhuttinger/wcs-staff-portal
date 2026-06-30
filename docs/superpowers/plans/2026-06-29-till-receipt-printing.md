# Till-Close Auto-Print Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a gym submits its PM "Drawer Close Count" in Operandio, a till-close receipt (logo, date, reconciliation, itemized cash drops) prints automatically on that gym's local printer.

**Architecture:** The cloud portal can't reach a USB printer, so the Electron launcher running at each gym is the local print agent. On an Operandio drawer-close submission the portal enqueues a `print_jobs` row; the launcher polls `POST /print/poll` (~30s), receives the job + its admin-selected printer, loads the receipt HTML from `GET /print/receipt/:id`, and silently prints it via Electron `webContents.print`. Admins configure the printer and the trigger remotely from the portal.

**Tech Stack:** Node/Express (`auth/`), Supabase Postgres (service-role), React + Vite (`portal/`), Electron 33 (`launcher/`). Tests use the built-in `node:test` runner (`node --test <file>`).

## Global Constraints

- **Node test runner only:** every backend test is `const test = require('node:test')` + `const assert = require('node:assert')`, run with `node --test <path>`. No jest/vitest.
- **DB access is 100% service-role** via `const { supabaseAdmin } = require('../services/supabase')`. Every new table gets `ENABLE ROW LEVEL SECURITY` with NO policy (service-role bypasses RLS) — repo standard.
- **Admin API gating:** `router.use(authenticate)` then `requireRole('admin')` per route. `authenticate` = `require('../middleware/auth')`; `requireRole` = `require('../middleware/role').requireRole`.
- **Device API auth:** launcher endpoints authenticate with header `x-launcher-key` matching `process.env.LAUNCHER_KEY` (server) which equals the launcher's `WCS_LAUNCHER_KEY`. Same trust model as `/launcher/heartbeat`.
- **Frontend API calls** go through `import { api } from '../lib/api'` (or `'../../lib/api'` from `components/admin/`): `api(path)` for GET, `api(path, { method, body: JSON.stringify(obj) })` for writes.
- **Migration numbering:** master is at `066`, so this feature is `067_print_system.sql`. Tasks 1-6 and 8-12 are decoupled from the till work and ship to master now (dark). **Only Task 7** (the Operandio hook + `loadReconciliation`) consumes the till reconciliation; it stays unmerged until `feat/till-cash-tracking` lands, then this branch is rebased and Task 7 added.
- **No em-dashes** in any user-facing copy (receipt text, labels). Use commas/hyphens.
- Migrations are applied through the project's existing Supabase migration process (Supabase SQL editor or `mcp__supabase__apply_migration`), same as prior numbered migrations.

---

## File Structure

**Backend (`auth/`)**
- Create `auth/migrations/067_print_system.sql` — `print_devices`, `print_jobs`, `print_automations`.
- Create `auth/src/services/printing/printJobs.js` — pure helpers: `dedupeKey`, `buildTillReceiptPayload`, `matchAutomation`.
- Create `auth/src/services/printing/printJobs.test.js`.
- Create `auth/src/services/printing/receiptTemplate.js` — `renderReceiptHtml(payload)` pure.
- Create `auth/src/services/printing/receiptTemplate.test.js`.
- Create `auth/src/services/printing/tillReceipt.js` — `maybeEnqueueTillReceipt({ supabase, event, loadReconciliation })` (the Operandio→queue glue + DB).
- Create `auth/src/routes/print.js` — `POST /print/poll`, `GET /print/receipt/:id`, admin CRUD + test print.
- Modify `auth/src/routes/operandio.js:251-263` — call the hook after a `submitted` job event persists.
- Modify `auth/src/index.js` — mount `app.use('/print', require('./routes/print'))`.

**Frontend (`portal/`)**
- Modify `portal/src/lib/api.js` — print client helpers (append near `getLocations`, ~line 470).
- Create `portal/src/components/admin/AdminPrintDevicesTab.jsx`.
- Create `portal/src/components/admin/AdminPrintAutomationsTab.jsx`.
- Modify `portal/src/components/AdminPanel.jsx` — import + 2 SETUP_TILES entries + 2 render lines.

**Launcher (`launcher/`)**
- Create `launcher/src/printers.js` — `listPrinters(win)`.
- Create `launcher/src/print-poller.js` — `start(deps)`, `pollOnce(deps)`.
- Modify `launcher/src/main.js` — start the poller after the window exists.
- Modify `launcher/package.json` — version `1.7.0`.

---

## Task 1: Migration — print system tables

**Files:**
- Create: `auth/migrations/067_print_system.sql`

**Interfaces:**
- Produces tables `print_devices`, `print_jobs`, `print_automations` consumed by every later backend task.

- [ ] **Step 1: Write the migration**

```sql
-- 067_print_system.sql — Till-close auto-print: device registry, job queue, triggers.

-- A desktop launcher install that can print. One row per install_id.
CREATE TABLE IF NOT EXISTS print_devices (
  install_id         text PRIMARY KEY,
  location_id        uuid REFERENCES locations(id) ON DELETE SET NULL,
  location_slug      text,
  hostname           text,
  available_printers jsonb DEFAULT '[]'::jsonb,   -- [{ name, isDefault }]
  selected_printer   text,
  enabled            boolean NOT NULL DEFAULT false,
  last_seen          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE print_devices ENABLE ROW LEVEL SECURITY;

-- Generic print job queue. v1 only produces type='till_close' and 'test'.
CREATE TABLE IF NOT EXISTS print_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  location_slug text,
  install_id  text,                              -- target device (set when known)
  type        text NOT NULL,                     -- 'till_close' | 'test'
  dedupe_key  text,                              -- e.g. 'till_close:salem:2026-06-29'
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'pending',   -- pending|claimed|printed|failed
  attempts    int  NOT NULL DEFAULT 0,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  claimed_at  timestamptz,
  printed_at  timestamptz
);
ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS print_jobs_install_status_idx ON print_jobs (install_id, status);
CREATE INDEX IF NOT EXISTS print_jobs_location_status_idx ON print_jobs (location_id, status);
-- Stop a re-submitted drawer close from double-printing the same day.
CREATE UNIQUE INDEX IF NOT EXISTS print_jobs_dedupe_idx
  ON print_jobs (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- Per-location automation: which Operandio job name triggers which print type.
CREATE TABLE IF NOT EXISTS print_automations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id    uuid REFERENCES locations(id) ON DELETE CASCADE,
  location_slug  text NOT NULL,
  job_name_match text NOT NULL DEFAULT '%drawer close%',  -- ILIKE pattern
  print_type     text NOT NULL DEFAULT 'till_close',
  enabled        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_slug, print_type)
);
ALTER TABLE print_automations ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply the migration**

Apply `auth/migrations/067_print_system.sql` via the Supabase migration process (SQL editor or `mcp__supabase__apply_migration` with name `print_system`).
Expected: three tables created, no error.

- [ ] **Step 3: Verify tables exist**

Run a quick check (Supabase SQL editor):
```sql
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('print_devices','print_jobs','print_automations');
```
Expected: 3 rows.

- [ ] **Step 4: Commit**

```bash
git add auth/migrations/067_print_system.sql
git commit -m "feat(print): add print_devices/print_jobs/print_automations tables"
```

---

## Task 2: Pure queue helpers (dedupe key, payload, automation match)

**Files:**
- Create: `auth/src/services/printing/printJobs.js`
- Test: `auth/src/services/printing/printJobs.test.js`

**Interfaces:**
- Produces:
  - `dedupeKey(type, locationSlug, businessDate) -> string`
  - `matchAutomation(automation, jobName) -> boolean` (automation: `{ enabled, job_name_match }`)
  - `buildTillReceiptPayload(recon) -> object` where `recon` is the reconciliation row
    `{ location_slug, business_date, closed_by, opening_float, cash_sales, cash_refunds, cash_drops, expected_close, counted_close, over_short, bag_drop, drops:[{name, amount}] }`
    and the returned payload is `{ type:'till_close', location, date, closedBy, float, cashSales, cashRefunds, dropsTotal, expected, counted, overShort, bagDrop, drops:[{name, amount}] }`.

- [ ] **Step 1: Write the failing test**

```js
// auth/src/services/printing/printJobs.test.js
const test = require('node:test')
const assert = require('node:assert')
const { dedupeKey, matchAutomation, buildTillReceiptPayload } = require('./printJobs')

test('dedupeKey is stable and namespaced', () => {
  assert.equal(dedupeKey('till_close', 'Salem', '2026-06-29'), 'till_close:salem:2026-06-29')
})

test('matchAutomation honors enabled flag and ILIKE-ish pattern', () => {
  const a = { enabled: true, job_name_match: '%drawer close%' }
  assert.equal(matchAutomation(a, 'Drawer Close Count (Jun 29)'), true)
  assert.equal(matchAutomation(a, 'AM Open Count'), false)
  assert.equal(matchAutomation({ ...a, enabled: false }, 'Drawer Close Count'), false)
})

test('buildTillReceiptPayload maps reconciliation to template fields', () => {
  const recon = {
    location_slug: 'salem', business_date: '2026-06-29', closed_by: 'Justin H.',
    opening_float: 100, cash_sales: 342.5, cash_refunds: 0, cash_drops: 200,
    expected_close: 242.5, counted_close: 240, over_short: -2.5, bag_drop: 140,
    drops: [{ name: 'Cash Drop', amount: 200 }],
  }
  const p = buildTillReceiptPayload(recon)
  assert.equal(p.type, 'till_close')
  assert.equal(p.location, 'salem')
  assert.equal(p.counted, 240)
  assert.equal(p.overShort, -2.5)
  assert.equal(p.bagDrop, 140)
  assert.deepEqual(p.drops, [{ name: 'Cash Drop', amount: 200 }])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test auth/src/services/printing/printJobs.test.js`
Expected: FAIL — cannot find module `./printJobs`.

- [ ] **Step 3: Write minimal implementation**

```js
// auth/src/services/printing/printJobs.js
// Pure helpers for the print queue. No DB, no I/O — unit-testable.

function dedupeKey(type, locationSlug, businessDate) {
  return `${type}:${String(locationSlug).toLowerCase()}:${businessDate}`
}

// Translate an ILIKE pattern (only % wildcards used) to a case-insensitive test.
function matchAutomation(automation, jobName) {
  if (!automation || !automation.enabled) return false
  const pat = String(automation.job_name_match || '')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')   // escape regex specials
    .replace(/%/g, '.*')                        // % -> .*
  return new RegExp(`^${pat}$`, 'i').test(String(jobName || ''))
}

function buildTillReceiptPayload(recon) {
  return {
    type: 'till_close',
    location: recon.location_slug,
    date: recon.business_date,
    closedBy: recon.closed_by || '',
    float: recon.opening_float,
    cashSales: recon.cash_sales,
    cashRefunds: recon.cash_refunds,
    dropsTotal: recon.cash_drops,
    expected: recon.expected_close,
    counted: recon.counted_close,
    overShort: recon.over_short,
    bagDrop: recon.bag_drop,
    drops: Array.isArray(recon.drops) ? recon.drops : [],
  }
}

module.exports = { dedupeKey, matchAutomation, buildTillReceiptPayload }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test auth/src/services/printing/printJobs.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/printing/printJobs.js auth/src/services/printing/printJobs.test.js
git commit -m "feat(print): pure queue helpers (dedupe, automation match, payload)"
```

---

## Task 3: Receipt HTML template

**Files:**
- Create: `auth/src/services/printing/receiptTemplate.js`
- Test: `auth/src/services/printing/receiptTemplate.test.js`

**Interfaces:**
- Consumes: payload from `buildTillReceiptPayload` (Task 2).
- Produces: `renderReceiptHtml(payload, { logoDataUri }) -> string` (full standalone HTML document).

- [ ] **Step 1: Write the failing test**

```js
// auth/src/services/printing/receiptTemplate.test.js
const test = require('node:test')
const assert = require('node:assert')
const { renderReceiptHtml } = require('./receiptTemplate')

const payload = {
  type: 'till_close', location: 'salem', date: '2026-06-29', closedBy: 'Justin H.',
  float: 100, cashSales: 342.5, cashRefunds: 0, dropsTotal: 200,
  expected: 242.5, counted: 240, overShort: -2.5, bagDrop: 140,
  drops: [{ name: 'Cash Drop', amount: 200 }],
}

test('renders a full HTML doc with the key figures', () => {
  const html = renderReceiptHtml(payload, { logoDataUri: 'data:image/png;base64,AAA' })
  assert.match(html, /<!DOCTYPE html>/i)
  assert.match(html, /TILL CLOSE/i)
  assert.match(html, /Justin H\./)
  assert.match(html, /\$240\.00/)         // counted
  assert.match(html, /-\$2\.50/)          // over/short (short)
  assert.match(html, /\$140\.00/)         // bag drop
  assert.match(html, /Cash Drop/)         // itemized drop
  assert.match(html, /data:image\/png/)   // logo inlined
})

test('positive variance shows a + sign', () => {
  const html = renderReceiptHtml({ ...payload, overShort: 1.25 }, { logoDataUri: '' })
  assert.match(html, /\+\$1\.25/)
})

test('escapes HTML in closedBy', () => {
  const html = renderReceiptHtml({ ...payload, closedBy: '<script>x</script>' }, { logoDataUri: '' })
  assert.doesNotMatch(html, /<script>x<\/script>/)
  assert.match(html, /&lt;script&gt;/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test auth/src/services/printing/receiptTemplate.test.js`
Expected: FAIL — cannot find module `./receiptTemplate`.

- [ ] **Step 3: Write minimal implementation**

```js
// auth/src/services/printing/receiptTemplate.js
// Pure HTML renderer for the till-close receipt. No I/O. The desktop loads this
// into a hidden window and silent-prints it.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
function money(n) {
  const v = Number(n || 0)
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(v).toFixed(2)}`
}
function signedMoney(n) {
  const v = Number(n || 0)
  if (v > 0) return `+$${v.toFixed(2)}`
  if (v < 0) return `-$${Math.abs(v).toFixed(2)}`
  return '$0.00'
}
function prettyDate(iso) {
  // iso 'YYYY-MM-DD' -> 'Mon, Jun 29, 2026' without timezone surprises.
  const [y, m, d] = String(iso).split('-').map(Number)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (!y || !m || !d) return esc(iso)
  return `${months[m - 1]} ${d}, ${y}`
}

function renderReceiptHtml(p, opts = {}) {
  const logo = opts.logoDataUri || ''
  const dropRows = (p.drops || []).map(
    d => `<tr><td>${esc(d.name)}</td><td class="r">${money(d.amount)}</td></tr>`
  ).join('')
  const loc = esc(String(p.location || '')).replace(/^\w/, c => c.toUpperCase())
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; margin: 0; padding: 24px; }
  .logo { display: block; margin: 0 auto 8px; width: 96px; height: auto; }
  h1 { text-align: center; font-size: 22px; margin: 4px 0 0; letter-spacing: 1px; }
  .sub { text-align: center; color: #666; margin: 2px 0 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  td { padding: 4px 0; }
  td.r { text-align: right; font-variant-numeric: tabular-nums; }
  .rule { border-top: 1px solid #999; margin: 10px 0; }
  .hero { border: 2px solid #111; border-radius: 8px; text-align: center; padding: 12px; margin: 14px 0; }
  .hero .label { color: #666; font-size: 12px; letter-spacing: 1px; }
  .hero .amt { font-size: 30px; font-weight: 700; }
  .foot { text-align: center; color: #888; font-size: 11px; margin-top: 12px; }
</style></head><body>
  ${logo ? `<img class="logo" src="${logo}" alt="WCS">` : ''}
  <h1>TILL CLOSE</h1>
  <div class="sub">${loc} &nbsp;&middot;&nbsp; ${prettyDate(p.date)}</div>
  <table>
    <tr><td>Closed by</td><td class="r">${esc(p.closedBy)}</td></tr>
    <tr><td>Starting float</td><td class="r">${money(p.float)}</td></tr>
    <tr><td>Cash sales</td><td class="r">${money(p.cashSales)}</td></tr>
    <tr><td>Cash refunds</td><td class="r">${money(p.cashRefunds)}</td></tr>
    <tr><td>Cash drops</td><td class="r">${money(p.dropsTotal)}</td></tr>
    ${dropRows ? `<tr><td colspan="2"><div class="rule"></div></td></tr>${dropRows}` : ''}
    <tr><td colspan="2"><div class="rule"></div></td></tr>
    <tr><td>Expected in drawer</td><td class="r">${money(p.expected)}</td></tr>
    <tr><td><strong>Counted in drawer</strong></td><td class="r"><strong>${money(p.counted)}</strong></td></tr>
    <tr><td>Over / short</td><td class="r">${signedMoney(p.overShort)}</td></tr>
  </table>
  <div class="hero">
    <div class="label">BAG DROP</div>
    <div class="amt">${money(p.bagDrop)}</div>
  </div>
  <div class="foot">WCS Till System</div>
</body></html>`
}

module.exports = { renderReceiptHtml }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test auth/src/services/printing/receiptTemplate.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/printing/receiptTemplate.js auth/src/services/printing/receiptTemplate.test.js
git commit -m "feat(print): till-close receipt HTML template"
```

---

## Task 4: Enqueue service (Operandio submission -> print job)

**Files:**
- Create: `auth/src/services/printing/tillReceipt.js`
- Test: `auth/src/services/printing/tillReceipt.test.js`

**Interfaces:**
- Consumes: `dedupeKey`, `matchAutomation`, `buildTillReceiptPayload` (Task 2).
- Produces: `maybeEnqueueTillReceipt({ supabase, event, loadReconciliation }) -> Promise<{ enqueued: boolean, reason?: string, jobId?: string }>`
  - `event` is the persisted Operandio submission: `{ job_name, location_slug, job_date, submitted_by }`.
  - `loadReconciliation(supabase, locationSlug, businessDate) -> Promise<reconRow|null>` is injected (the real one wires to the till service in Task 7; tests pass a fake).
  - `supabase` is a `supabaseAdmin`-shaped client. Tests pass a fake exposing `.from(table)` with `select/eq/ilike/maybeSingle/insert`.

- [ ] **Step 1: Write the failing test**

```js
// auth/src/services/printing/tillReceipt.test.js
const test = require('node:test')
const assert = require('node:assert')
const { maybeEnqueueTillReceipt } = require('./tillReceipt')

// Minimal fake supabase tuned to the exact calls the service makes.
function fakeSupabase({ automation, device, insertSink }) {
  return {
    from(table) {
      if (table === 'print_automations') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: automation, error: null }) }) }) }
      }
      if (table === 'print_devices') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: device, error: null }) }) }) }) }
      }
      if (table === 'print_jobs') {
        return { insert: (rows) => ({ select: () => ({ maybeSingle: async () => {
          insertSink.push(rows); return { data: { id: 'job-1' }, error: null }
        } }) }) }
      }
      throw new Error('unexpected table ' + table)
    },
  }
}

const recon = {
  location_slug: 'salem', business_date: '2026-06-29', closed_by: 'Sam',
  opening_float: 100, cash_sales: 300, cash_refunds: 0, cash_drops: 0,
  expected_close: 400, counted_close: 400, over_short: 0, bag_drop: 300, drops: [],
}
const event = { job_name: 'Drawer Close Count (Jun 29)', location_slug: 'salem', job_date: '2026-06-29', submitted_by: 'Sam' }

test('enqueues when automation enabled + device enabled + recon present', async () => {
  const insertSink = []
  const supabase = fakeSupabase({
    automation: { enabled: true, job_name_match: '%drawer close%', print_type: 'till_close' },
    device: { install_id: 'abc', selected_printer: 'Star', enabled: true },
    insertSink,
  })
  const res = await maybeEnqueueTillReceipt({
    supabase, event, loadReconciliation: async () => recon,
  })
  assert.equal(res.enqueued, true)
  assert.equal(res.jobId, 'job-1')
  assert.equal(insertSink.length, 1)
  assert.equal(insertSink[0].type, 'till_close')
  assert.equal(insertSink[0].dedupe_key, 'till_close:salem:2026-06-29')
  assert.equal(insertSink[0].install_id, 'abc')
})

test('skips when no enabled automation matches', async () => {
  const supabase = fakeSupabase({ automation: null, device: { enabled: true }, insertSink: [] })
  const res = await maybeEnqueueTillReceipt({ supabase, event, loadReconciliation: async () => recon })
  assert.equal(res.enqueued, false)
  assert.equal(res.reason, 'no_automation')
})

test('skips when no enabled device for the location', async () => {
  const supabase = fakeSupabase({
    automation: { enabled: true, job_name_match: '%drawer close%', print_type: 'till_close' },
    device: null, insertSink: [],
  })
  const res = await maybeEnqueueTillReceipt({ supabase, event, loadReconciliation: async () => recon })
  assert.equal(res.enqueued, false)
  assert.equal(res.reason, 'no_device')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test auth/src/services/printing/tillReceipt.test.js`
Expected: FAIL — cannot find module `./tillReceipt`.

- [ ] **Step 3: Write minimal implementation**

```js
// auth/src/services/printing/tillReceipt.js
// Glue: an Operandio drawer-close submission -> a print_jobs row.
// Best-effort. Never throws to the caller (the Operandio webhook must not break).

const { dedupeKey, matchAutomation, buildTillReceiptPayload } = require('./printJobs')

async function maybeEnqueueTillReceipt({ supabase, event, loadReconciliation }) {
  try {
    const slug = String(event.location_slug || '').toLowerCase()
    const businessDate = event.job_date

    // 1. Is there an enabled till_close automation for this location?
    const { data: automation } = await supabase
      .from('print_automations')
      .select('enabled, job_name_match, print_type')
      .eq('location_slug', slug)
      .maybeSingle()
    if (!matchAutomation(automation, event.job_name)) {
      return { enqueued: false, reason: 'no_automation' }
    }

    // 2. Is there an enabled device with a printer for this location?
    const { data: device } = await supabase
      .from('print_devices')
      .select('install_id, selected_printer, enabled')
      .eq('location_slug', slug)
      .eq('enabled', true)
      .maybeSingle()
    if (!device || !device.selected_printer) {
      return { enqueued: false, reason: 'no_device' }
    }

    // 3. Pull the reconciliation for the day (injected; wires to till service).
    const recon = await loadReconciliation(supabase, slug, businessDate)
    if (!recon) return { enqueued: false, reason: 'no_reconciliation' }

    // 4. Enqueue. Unique dedupe_key index makes a re-submit a no-op (23505).
    const payload = buildTillReceiptPayload(recon)
    const row = {
      location_slug: slug,
      install_id: device.install_id,
      type: 'till_close',
      dedupe_key: dedupeKey('till_close', slug, businessDate),
      payload,
      status: 'pending',
    }
    const { data, error } = await supabase
      .from('print_jobs').insert(row).select().maybeSingle()
    if (error) {
      if (error.code === '23505') return { enqueued: false, reason: 'duplicate' }
      return { enqueued: false, reason: 'insert_error', error: error.message }
    }
    return { enqueued: true, jobId: data.id }
  } catch (err) {
    return { enqueued: false, reason: 'exception', error: err && err.message }
  }
}

module.exports = { maybeEnqueueTillReceipt }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test auth/src/services/printing/tillReceipt.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/printing/tillReceipt.js auth/src/services/printing/tillReceipt.test.js
git commit -m "feat(print): enqueue service for Operandio drawer-close -> print job"
```

---

## Task 5: Print router — device endpoints (`/print/poll`, `/print/receipt/:id`)

**Files:**
- Create: `auth/src/routes/print.js`
- Modify: `auth/src/index.js` (mount the router)

**Interfaces:**
- Consumes: `renderReceiptHtml` (Task 3), `supabaseAdmin`.
- Produces HTTP:
  - `POST /print/poll` body `{ install_id, hostname, location, printers, acks? }` -> `{ enabled, selected_printer, jobs: [{ id, receipt_url }] }`. Upserts the device, applies acks, hands out ≤3 pending jobs (marks them `claimed`).
  - `GET /print/receipt/:id` -> `text/html` receipt for that job (no session; guarded by unguessable uuid + `status='claimed'`).

- [ ] **Step 1: Write the router**

```js
// auth/src/routes/print.js
const { Router } = require('express')
const fs = require('fs')
const path = require('path')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { renderReceiptHtml } = require('../services/printing/receiptTemplate')

const router = Router()

// Logo inlined once at boot so the desktop needs no auth to fetch an asset.
let LOGO_DATA_URI = ''
try {
  const p = path.join(__dirname, '..', 'assets', 'logo.png')
  if (fs.existsSync(p)) LOGO_DATA_URI = 'data:image/png;base64,' + fs.readFileSync(p).toString('base64')
} catch {}

// --- Device (launcher) endpoints: shared-key auth, not user JWT --------------
function requireLauncherKey(req, res, next) {
  const key = process.env.LAUNCHER_KEY
  if (key && req.headers['x-launcher-key'] !== key) {
    return res.status(401).json({ error: 'Invalid launcher key' })
  }
  next()
}

// POST /print/poll — device check-in: register printers, apply acks, get jobs.
router.post('/poll', requireLauncherKey, async (req, res) => {
  try {
    const { install_id, hostname, location, printers, acks } = req.body || {}
    if (!install_id) return res.status(400).json({ error: 'install_id required' })
    const slug = String(location || '').toLowerCase()

    // Resolve location_id from slug (best-effort).
    let locationId = null
    const { data: loc } = await supabaseAdmin
      .from('locations').select('id').ilike('name', slug).maybeSingle()
    if (loc) locationId = loc.id

    // Upsert the device registry row (preserve admin-set selected_printer/enabled).
    await supabaseAdmin.from('print_devices').upsert({
      install_id,
      hostname: hostname || null,
      location_slug: slug || null,
      location_id: locationId,
      available_printers: Array.isArray(printers) ? printers : [],
      last_seen: new Date().toISOString(),
    }, { onConflict: 'install_id', ignoreDuplicates: false })

    // Apply acks for previously handed-out jobs.
    for (const ack of (Array.isArray(acks) ? acks : [])) {
      if (!ack || !ack.id) continue
      const ok = ack.status === 'printed'
      await supabaseAdmin.from('print_jobs').update({
        status: ok ? 'printed' : 'failed',
        printed_at: ok ? new Date().toISOString() : null,
        error: ok ? null : String(ack.error || 'print failed'),
      }).eq('id', ack.id).eq('install_id', install_id)
    }

    // Read current device config + hand out pending jobs.
    const { data: device } = await supabaseAdmin
      .from('print_devices').select('enabled, selected_printer').eq('install_id', install_id).maybeSingle()

    let jobs = []
    if (device && device.enabled && device.selected_printer) {
      const { data: pending } = await supabaseAdmin
        .from('print_jobs').select('id')
        .eq('install_id', install_id).eq('status', 'pending')
        .order('created_at', { ascending: true }).limit(3)
      const ids = (pending || []).map(j => j.id)
      if (ids.length) {
        await supabaseAdmin.from('print_jobs')
          .update({ status: 'claimed', claimed_at: new Date().toISOString() })
          .in('id', ids).eq('status', 'pending')
      }
      const base = process.env.PUBLIC_API_URL || ''
      jobs = ids.map(id => ({ id, receipt_url: `${base}/print/receipt/${id}` }))
    }

    res.json({
      enabled: !!(device && device.enabled),
      selected_printer: device ? device.selected_printer : null,
      jobs,
    })
  } catch (err) {
    console.error('[print] poll failed:', err.message)
    res.status(500).json({ error: 'poll failed' })
  }
})

// GET /print/receipt/:id — standalone HTML for the desktop to print.
router.get('/receipt/:id', async (req, res) => {
  try {
    const { data: job } = await supabaseAdmin
      .from('print_jobs').select('payload, status').eq('id', req.params.id).maybeSingle()
    if (!job || (job.status !== 'claimed' && job.status !== 'printed')) {
      return res.status(404).send('Not found')
    }
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(renderReceiptHtml(job.payload, { logoDataUri: LOGO_DATA_URI }))
  } catch (err) {
    console.error('[print] receipt failed:', err.message)
    res.status(500).send('error')
  }
})

module.exports = router
// Admin endpoints are appended in Task 6.
```

- [ ] **Step 2: Mount the router**

In `auth/src/index.js`, next to the other `app.use('/...', require('./routes/...'))` lines (e.g. near the operandio mount), add:
```js
app.use('/print', require('./routes/print'))
```

- [ ] **Step 3: Manually smoke-test the device poll**

Start the API locally (`cd auth && npm run dev`). With a seeded device row absent, run:
```bash
curl -s -X POST http://localhost:3001/print/poll \
  -H 'Content-Type: application/json' -H "x-launcher-key: $LAUNCHER_KEY" \
  -d '{"install_id":"test-install","hostname":"DESK1","location":"Salem","printers":[{"name":"Microsoft Print to PDF","isDefault":true}]}'
```
Expected: `{"enabled":false,"selected_printer":null,"jobs":[]}` and a `print_devices` row now exists with `available_printers` populated.

- [ ] **Step 4: Commit**

```bash
git add auth/src/routes/print.js auth/src/index.js
git commit -m "feat(print): device poll + receipt HTML endpoints"
```

---

## Task 6: Print router — admin endpoints (devices, automations, test print)

**Files:**
- Modify: `auth/src/routes/print.js` (append admin routes before `module.exports`)

**Interfaces:**
- Produces HTTP (all `authenticate` + `requireRole('admin')`):
  - `GET  /print/devices` -> `{ devices: [...] }` (joined with last_seen)
  - `PUT  /print/devices/:install_id` body `{ selected_printer?, enabled? }` -> `{ device }`
  - `POST /print/devices/:install_id/test` -> `{ jobId }` (enqueues a `type:'test'` job)
  - `GET  /print/automations` -> `{ automations: [...] }`
  - `PUT  /print/automations/:location_slug` body `{ enabled?, job_name_match? }` -> `{ automation }`

- [ ] **Step 1: Append admin routes**

Insert immediately above `module.exports = router` in `auth/src/routes/print.js`:
```js
// --- Admin endpoints: user JWT + admin role -------------------------------
router.use(authenticate)

router.get('/devices', requireRole('admin'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('print_devices')
    .select('install_id, location_slug, hostname, available_printers, selected_printer, enabled, last_seen')
    .order('location_slug')
  if (error) return res.status(500).json({ error: 'Failed to list devices' })
  res.json({ devices: data || [] })
})

router.put('/devices/:install_id', requireRole('admin'), async (req, res) => {
  const updates = {}
  if (req.body.selected_printer !== undefined) updates.selected_printer = req.body.selected_printer
  if (req.body.enabled !== undefined) updates.enabled = !!req.body.enabled
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' })
  const { data, error } = await supabaseAdmin
    .from('print_devices').update(updates).eq('install_id', req.params.install_id).select().maybeSingle()
  if (error) return res.status(500).json({ error: 'Failed to update device' })
  res.json({ device: data })
})

router.post('/devices/:install_id/test', requireRole('admin'), async (req, res) => {
  const { data: device } = await supabaseAdmin
    .from('print_devices').select('install_id, location_slug, selected_printer, enabled')
    .eq('install_id', req.params.install_id).maybeSingle()
  if (!device) return res.status(404).json({ error: 'Device not found' })
  if (!device.enabled || !device.selected_printer) {
    return res.status(400).json({ error: 'Device not enabled or no printer selected' })
  }
  const testPayload = {
    type: 'till_close', location: device.location_slug || 'Test', date: new Date().toISOString().slice(0, 10),
    closedBy: 'Test Print', float: 100, cashSales: 0, cashRefunds: 0, dropsTotal: 0,
    expected: 100, counted: 100, overShort: 0, bagDrop: 0, drops: [],
  }
  const { data, error } = await supabaseAdmin.from('print_jobs').insert({
    location_slug: device.location_slug, install_id: device.install_id,
    type: 'test', payload: testPayload, status: 'pending',
  }).select().maybeSingle()
  if (error) return res.status(500).json({ error: 'Failed to enqueue test' })
  res.json({ jobId: data.id })
})

router.get('/automations', requireRole('admin'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('print_automations')
    .select('id, location_slug, job_name_match, print_type, enabled')
    .order('location_slug')
  if (error) return res.status(500).json({ error: 'Failed to list automations' })
  res.json({ automations: data || [] })
})

router.put('/automations/:location_slug', requireRole('admin'), async (req, res) => {
  const slug = String(req.params.location_slug).toLowerCase()
  const { data: loc } = await supabaseAdmin.from('locations').select('id').ilike('name', slug).maybeSingle()
  const row = {
    location_slug: slug,
    location_id: loc ? loc.id : null,
    print_type: 'till_close',
    enabled: req.body.enabled !== undefined ? !!req.body.enabled : false,
  }
  if (req.body.job_name_match !== undefined) row.job_name_match = req.body.job_name_match
  const { data, error } = await supabaseAdmin
    .from('print_automations').upsert(row, { onConflict: 'location_slug,print_type' }).select().maybeSingle()
  if (error) return res.status(500).json({ error: 'Failed to save automation' })
  res.json({ automation: data })
})
```

> Note: `router.use(authenticate)` is mounted AFTER the device routes (`/poll`, `/receipt/:id`) so those stay on shared-key auth. Express applies `use` only to routes registered after it — keep the device routes above this line.

- [ ] **Step 2: Smoke-test an admin route**

With a valid admin JWT in `$TOKEN`:
```bash
curl -s http://localhost:3001/print/devices -H "Authorization: Bearer $TOKEN"
```
Expected: `{"devices":[{"install_id":"test-install",...}]}`.

- [ ] **Step 3: Commit**

```bash
git add auth/src/routes/print.js
git commit -m "feat(print): admin device + automation endpoints, test print"
```

---

## Task 7: Wire the Operandio submission hook (+ reconciliation loader)

> **Depends on `feat/till-cash-tracking` merged.** That branch provides the till
> reconciliation. This task supplies the real `loadReconciliation` and calls the
> hook from the Operandio webhook.

**Files:**
- Create: `auth/src/services/printing/loadReconciliation.js`
- Modify: `auth/src/routes/operandio.js:251-263`

**Interfaces:**
- Consumes: `maybeEnqueueTillReceipt` (Task 4), the till reconcile function from `feat/till-cash-tracking` (`auth/src/lib/tillReconcile.js` / `auth/src/routes/till.js`).
- Produces: `loadReconciliation(supabase, locationSlug, businessDate) -> Promise<reconRow|null>` shaped for `buildTillReceiptPayload`.

- [ ] **Step 1: Write the reconciliation loader**

Inspect the merged till code for the function that returns a single day's reconciliation row (the `GET /till/reconciliation` handler builds `{ openingFloat, cashSales, cashRefunds, cashDrops, expectedClose, countedClose, overShort, bagDrop, closeBy, ... }`). Extract or reuse it as a callable, then map to the snake_case shape `buildTillReceiptPayload` expects:

```js
// auth/src/services/printing/loadReconciliation.js
// Maps the till-cash-tracking reconciliation (one club/day) into the shape
// buildTillReceiptPayload consumes. Returns null if there's no close count yet.
const { reconcileForLocationDay } = require('../../lib/tillReconcile') // adjust to the merged export

async function loadReconciliation(supabase, locationSlug, businessDate) {
  const r = await reconcileForLocationDay(supabase, locationSlug, businessDate)
  if (!r || r.countedClose == null) return null
  return {
    location_slug: locationSlug,
    business_date: businessDate,
    closed_by: r.closeBy || '',
    opening_float: r.openingFloat,
    cash_sales: r.cashSales,
    cash_refunds: r.cashRefunds,
    cash_drops: r.cashDrops,
    expected_close: r.expectedClose,
    counted_close: r.countedClose,
    over_short: r.overShort,
    bag_drop: r.bagDrop,
    drops: r.drops || [],
  }
}

module.exports = { loadReconciliation }
```

> If the merged till code exposes a different function name/signature, adapt this
> one call site only. The mapping keys above are the contract Task 2's test locks.

- [ ] **Step 2: Call the hook from the Operandio webhook**

In `auth/src/routes/operandio.js`, at the top add:
```js
const { maybeEnqueueTillReceipt } = require('../services/printing/tillReceipt')
const { loadReconciliation } = require('../services/printing/loadReconciliation')
```
Then inside the `if (jobEmail) { try { ... }` block, right after the existing
`console.log('[Operandio] Job event stored:', ...)` (currently line ~254) and
before the `return res.json(...)`, insert:
```js
      // Fire-and-forget till-close auto-print. Must never break ingestion.
      if (jobEmail.kind === 'submitted') {
        maybeEnqueueTillReceipt({
          supabase: supabaseAdmin,
          event: jobEmail.event,
          loadReconciliation,
        }).then(r => {
          if (r.enqueued) console.log('[print] till receipt queued', r.jobId)
          else if (r.reason && r.reason !== 'no_automation') console.log('[print] till receipt skipped:', r.reason)
        }).catch(e => console.error('[print] enqueue error:', e.message))
      }
```

- [ ] **Step 3: Verify backend tests still pass**

Run: `node --test auth/src/services/printing/*.test.js`
Expected: all PASS (no regression; the hook is glue, covered by Task 4 unit tests).

- [ ] **Step 4: Commit**

```bash
git add auth/src/services/printing/loadReconciliation.js auth/src/routes/operandio.js
git commit -m "feat(print): wire Operandio drawer-close submission to till-receipt enqueue"
```

---

## Task 8: Launcher — enumerate printers

**Files:**
- Create: `launcher/src/printers.js`

**Interfaces:**
- Produces: `async listPrinters(win) -> [{ name, isDefault }]` using Electron `webContents.getPrintersAsync()`.

- [ ] **Step 1: Write the module**

```js
// launcher/src/printers.js
// Enumerate installed printers via the hidden/main window's webContents.
async function listPrinters(win) {
  try {
    if (!win || win.isDestroyed()) return []
    const printers = await win.webContents.getPrintersAsync()
    return (printers || []).map(p => ({ name: p.name, isDefault: !!p.isDefault }))
  } catch (e) {
    return []
  }
}
module.exports = { listPrinters }
```

- [ ] **Step 2: Sanity check (no automated test — Electron runtime required)**

This needs the Electron runtime, so it is validated via the manual end-to-end in Task 9. Confirm the file requires without syntax error:
```bash
node -e "require('./launcher/src/printers.js'); console.log('ok')"
```
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add launcher/src/printers.js
git commit -m "feat(launcher): enumerate installed printers"
```

---

## Task 9: Launcher — print poller (poll, print, ack) + wire into main

**Files:**
- Create: `launcher/src/print-poller.js`
- Modify: `launcher/src/main.js`
- Modify: `launcher/package.json` (version -> 1.7.0)

**Interfaces:**
- Consumes: `listPrinters` (Task 8), `API_URL`/`getLocation`/`getInstallId`, device config (`selected_printer`).
- Produces: `start({ getWindow, log })`, `stop()`. Internally `pollOnce` POSTs `/print/poll`, prints each job's `receipt_url` to `selected_printer`, and acks on the next poll.

- [ ] **Step 1: Write the poller**

```js
// launcher/src/print-poller.js
// Every ~30s: report printers, fetch claimed jobs, silent-print each to the
// admin-selected printer, and ack results on the following poll.
const { BrowserWindow } = require('electron')
const { API_URL, getLocation } = require('./config')
const { getInstallId, getHostname } = require('./install-id')
const { listPrinters } = require('./printers')

const POLL_MS = 30 * 1000
let timer = null
let log = () => {}
let pendingAcks = []   // [{ id, status, error }]

function setLogger(fn) { log = fn || (() => {}) }

// Print one receipt URL to deviceName via an offscreen window. Resolves to ack.
function printJob(job, deviceName) {
  return new Promise((resolve) => {
    const w = new BrowserWindow({ show: false, webPreferences: { offscreen: false } })
    let done = false
    const finish = (status, error) => {
      if (done) return
      done = true
      try { if (!w.isDestroyed()) w.close() } catch {}
      resolve({ id: job.id, status, error })
    }
    const guard = setTimeout(() => finish('failed', 'load timeout'), 20000)
    w.webContents.once('did-finish-load', () => {
      clearTimeout(guard)
      w.webContents.print({ silent: true, deviceName, printBackground: true }, (ok, reason) => {
        finish(ok ? 'printed' : 'failed', ok ? null : reason)
      })
    })
    w.loadURL(job.receipt_url).catch(e => finish('failed', String(e && e.message)))
  })
}

async function pollOnce(getWindow) {
  try {
    const win = getWindow && getWindow()
    const printers = await listPrinters(win)
    const body = {
      install_id: getInstallId(), hostname: getHostname(), location: getLocation(),
      printers, acks: pendingAcks,
    }
    const headers = { 'Content-Type': 'application/json' }
    if (process.env.WCS_LAUNCHER_KEY) headers['x-launcher-key'] = process.env.WCS_LAUNCHER_KEY
    const res = await fetch(API_URL + '/print/poll', { method: 'POST', headers, body: JSON.stringify(body) })
    if (!res.ok) { log('[print] poll non-OK ' + res.status); return }
    pendingAcks = []   // server received them
    const data = await res.json()
    if (!data || !data.enabled || !data.selected_printer || !Array.isArray(data.jobs) || !data.jobs.length) return
    for (const job of data.jobs) {
      log('[print] printing job ' + job.id + ' -> ' + data.selected_printer)
      const ack = await printJob(job, data.selected_printer)
      pendingAcks.push(ack)
      log('[print] job ' + job.id + ' ' + ack.status + (ack.error ? ' (' + ack.error + ')' : ''))
    }
  } catch (err) {
    log('[print] poll failed: ' + (err && err.message))
  }
}

function start({ getWindow, logger } = {}) {
  setLogger(logger)
  if (timer) return
  setTimeout(() => pollOnce(getWindow), 25 * 1000)
  timer = setInterval(() => pollOnce(getWindow), POLL_MS)
}
function stop() { if (timer) { clearInterval(timer); timer = null } }

module.exports = { start, stop, pollOnce, setLogger }
```

- [ ] **Step 2: Wire into `main.js`**

In `launcher/src/main.js`, where the heartbeat is started (search for `heartbeat`), add alongside it (after the main window is created):
```js
const printPoller = require('./print-poller')
printPoller.start({ getWindow: () => mainWindow, logger: (m) => console.log(m) })
```
(Use whatever the existing main-window variable is named; mirror how `heartbeat.start(...)` is called.)

- [ ] **Step 3: Bump launcher version**

In `launcher/package.json`, set `"version": "1.7.0"`.

- [ ] **Step 4: Manual end-to-end (the real validation)**

1. Apply migration 067. Set `LAUNCHER_KEY` on the API and `WCS_LAUNCHER_KEY` (same value) for the launcher; set `PUBLIC_API_URL` on the API.
2. Run the launcher locally (`npm run launcher:dev`). It should appear in the admin **Print Devices** list (Task 11) with its printers.
3. In admin, select "Microsoft Print to PDF", enable the device, click **Test Print**.
4. Within ~30s the launcher prints the test receipt (a PDF save dialog or file confirms the silent-print path fired).

Expected: job transitions `pending -> claimed -> printed` (visible in admin after the next poll).

- [ ] **Step 5: Commit**

```bash
git add launcher/src/print-poller.js launcher/src/main.js launcher/package.json
git commit -m "feat(launcher): poll for print jobs and silent-print receipts (v1.7.0)"
```

---

## Task 10: Frontend API client helpers

**Files:**
- Modify: `portal/src/lib/api.js` (append after `getLocations`, ~line 470)

**Interfaces:**
- Produces exported fns used by Tasks 11-12:
  `getPrintDevices()`, `updatePrintDevice(installId, data)`, `testPrintDevice(installId)`,
  `getPrintAutomations()`, `updatePrintAutomation(slug, data)`.

- [ ] **Step 1: Add the helpers**

```js
// --- Till-close auto-print -------------------------------------------------
export async function getPrintDevices() {
  return api('/print/devices')
}
export async function updatePrintDevice(installId, data) {
  return api('/print/devices/' + encodeURIComponent(installId), {
    method: 'PUT', body: JSON.stringify(data),
  })
}
export async function testPrintDevice(installId) {
  return api('/print/devices/' + encodeURIComponent(installId) + '/test', { method: 'POST' })
}
export async function getPrintAutomations() {
  return api('/print/automations')
}
export async function updatePrintAutomation(slug, data) {
  return api('/print/automations/' + encodeURIComponent(slug), {
    method: 'PUT', body: JSON.stringify(data),
  })
}
```

- [ ] **Step 2: Verify the portal builds**

Run: `cd portal && npm run build`
Expected: build succeeds (no missing-export errors).

- [ ] **Step 3: Commit**

```bash
git add portal/src/lib/api.js
git commit -m "feat(print): portal API client helpers for devices + automations"
```

---

## Task 11: Admin UI — Print Devices tab

**Files:**
- Create: `portal/src/components/admin/AdminPrintDevicesTab.jsx`
- Modify: `portal/src/components/AdminPanel.jsx` (import + SETUP_TILES entry + render line)

**Interfaces:**
- Consumes: `getPrintDevices`, `updatePrintDevice`, `testPrintDevice` (Task 10).

- [ ] **Step 1: Write the component**

```jsx
// portal/src/components/admin/AdminPrintDevicesTab.jsx
import { useEffect, useState } from 'react'
import { getPrintDevices, updatePrintDevice, testPrintDevice } from '../../lib/api'

function minutesAgo(iso) {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return mins + 'm ago'
  return Math.round(mins / 60) + 'h ago'
}

export default function AdminPrintDevicesTab() {
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  async function load() {
    setLoading(true)
    try { const { devices } = await getPrintDevices(); setDevices(devices || []) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function onChange(install_id, patch) {
    setBusy(install_id)
    try { await updatePrintDevice(install_id, patch); await load() }
    finally { setBusy('') }
  }
  async function onTest(install_id) {
    setBusy(install_id); setMsg('')
    try { await testPrintDevice(install_id); setMsg('Test print queued. It prints within ~30s.') }
    catch (e) { setMsg('Test failed: ' + (e?.message || 'error')) }
    finally { setBusy('') }
  }

  if (loading) return <div className="p-4 text-text-muted">Loading devices...</div>
  if (!devices.length) return <div className="p-4 text-text-muted">No devices have checked in yet. Install the launcher at a gym and it will appear here.</div>

  return (
    <div className="p-4 space-y-4">
      {msg && <div className="text-sm text-text-muted">{msg}</div>}
      {devices.map(d => {
        const online = d.last_seen && (Date.now() - new Date(d.last_seen).getTime()) < 5 * 60000
        const printers = Array.isArray(d.available_printers) ? d.available_printers : []
        return (
          <div key={d.install_id} className="bg-surface border border-border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-text-primary capitalize">{d.location_slug || 'Unassigned'}</div>
                <div className="text-xs text-text-muted">{d.hostname || d.install_id}</div>
              </div>
              <span className={'text-xs px-2 py-0.5 rounded ' + (online ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-text-muted')}>
                {online ? 'online' : 'last seen ' + minutesAgo(d.last_seen)}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <select
                className="bg-background border border-border rounded px-2 py-1 text-sm"
                value={d.selected_printer || ''}
                disabled={busy === d.install_id}
                onChange={e => onChange(d.install_id, { selected_printer: e.target.value })}
              >
                <option value="">Select a printer...</option>
                {printers.map(p => <option key={p.name} value={p.name}>{p.name}{p.isDefault ? ' (default)' : ''}</option>)}
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!d.enabled} disabled={busy === d.install_id}
                  onChange={e => onChange(d.install_id, { enabled: e.target.checked })} />
                Enabled
              </label>
              <button
                className="text-sm px-3 py-1 rounded bg-primary/20 text-primary disabled:opacity-50"
                disabled={busy === d.install_id || !d.enabled || !d.selected_printer}
                onClick={() => onTest(d.install_id)}
              >Test Print</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Register the tile in `AdminPanel.jsx`**

Add the import near the other admin imports (~line 40):
```js
import AdminPrintDevicesTab from './admin/AdminPrintDevicesTab'
```
Add to `SETUP_TILES` (use the printer icon path):
```js
  { key: 'print-devices', label: 'Print Devices', desc: 'Receipt Printers per Gym', icon: 'M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z' },
```
Add the render line in the active-section block (near the other `{activeSection === ... && <... />}` lines):
```jsx
        {activeSection === 'print-devices' && <AdminPrintDevicesTab />}
```

- [ ] **Step 3: Verify build**

Run: `cd portal && npm run build`
Expected: build succeeds. Loading the Admin panel shows a "Print Devices" tile.

- [ ] **Step 4: Commit**

```bash
git add portal/src/components/admin/AdminPrintDevicesTab.jsx portal/src/components/AdminPanel.jsx
git commit -m "feat(print): admin Print Devices tab (pick printer, enable, test)"
```

---

## Task 12: Admin UI — Print Automations tab

**Files:**
- Create: `portal/src/components/admin/AdminPrintAutomationsTab.jsx`
- Modify: `portal/src/components/AdminPanel.jsx` (import + SETUP_TILES entry + render line)

**Interfaces:**
- Consumes: `getPrintAutomations`, `updatePrintAutomation` (Task 10), `getLocations` (existing).

- [ ] **Step 1: Write the component**

```jsx
// portal/src/components/admin/AdminPrintAutomationsTab.jsx
import { useEffect, useState } from 'react'
import { getPrintAutomations, updatePrintAutomation, getLocations } from '../../lib/api'

export default function AdminPrintAutomationsTab() {
  const [rows, setRows] = useState([])     // [{ location_slug, label, enabled, job_name_match }]
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')

  async function load() {
    setLoading(true)
    try {
      const [{ locations }, { automations }] = await Promise.all([getLocations(), getPrintAutomations()])
      const bySlug = Object.fromEntries((automations || []).map(a => [a.location_slug, a]))
      setRows((locations || []).map(l => {
        const slug = l.name.toLowerCase()
        const a = bySlug[slug] || {}
        return { location_slug: slug, label: l.name, enabled: !!a.enabled, job_name_match: a.job_name_match || '%drawer close%' }
      }))
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function save(slug, patch) {
    setBusy(slug)
    try { await updatePrintAutomation(slug, patch); await load() }
    finally { setBusy('') }
  }

  if (loading) return <div className="p-4 text-text-muted">Loading...</div>

  return (
    <div className="p-4 space-y-3">
      <p className="text-sm text-text-muted">Print a till-close receipt automatically when the PM drawer close is submitted in Operandio. Requires an enabled device with a printer for that location.</p>
      {rows.map(r => (
        <div key={r.location_slug} className="bg-surface border border-border rounded-lg p-3 flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-text-primary">{r.label}</div>
            <div className="text-xs text-text-muted">Matches job name: <code>{r.job_name_match}</code></div>
          </div>
          <label className="flex items-center gap-2 text-sm whitespace-nowrap">
            <input type="checkbox" checked={r.enabled} disabled={busy === r.location_slug}
              onChange={e => save(r.location_slug, { enabled: e.target.checked, job_name_match: r.job_name_match })} />
            Print on close
          </label>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Register the tile in `AdminPanel.jsx`**

Import (~line 40):
```js
import AdminPrintAutomationsTab from './admin/AdminPrintAutomationsTab'
```
Add to `SETUP_TILES`:
```js
  { key: 'print-automations', label: 'Print Automations', desc: 'Till-Close Print Triggers', icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z' },
```
Render line:
```jsx
        {activeSection === 'print-automations' && <AdminPrintAutomationsTab />}
```

- [ ] **Step 3: Verify build**

Run: `cd portal && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add portal/src/components/admin/AdminPrintAutomationsTab.jsx portal/src/components/AdminPanel.jsx
git commit -m "feat(print): admin Print Automations tab (per-location till-close trigger)"
```

---

## Task 13: Server logo asset + final integration pass

**Files:**
- Create: `auth/src/assets/logo.png` (the WCS logo used on the receipt)

- [ ] **Step 1: Add the logo asset**

Copy the WCS logo to `auth/src/assets/logo.png` (the receipt template inlines it as base64 at boot — see Task 5). Keep it reasonably small (<= 512px) so the inlined data URI stays light.

- [ ] **Step 2: Run the full backend test suite**

Run: `node --test auth/src/services/printing/*.test.js`
Expected: all PASS.

- [ ] **Step 3: Full manual end-to-end**

With `feat/till-cash-tracking` merged + migration 067 applied + launcher v1.7.0 running at a pilot gym:
1. Enable the device + select its printer in Print Devices.
2. Enable the automation for that location in Print Automations.
3. Submit a real "Drawer Close Count" in Operandio for that gym.
4. Confirm the receipt prints within ~30s and the job shows `printed`.

- [ ] **Step 4: Commit**

```bash
git add auth/src/assets/logo.png
git commit -m "feat(print): bundle WCS logo asset for receipts"
```

---

## Self-Review Notes (coverage vs. spec)

- **Remote printer control (admin):** Tasks 6, 11 — `GET/PUT /print/devices` + Print Devices tab. ✓
- **Per-location trigger wiring:** Tasks 6, 12 — automations CRUD + Print Automations tab. ✓
- **Operandio PM-close → print:** Tasks 4, 7 — enqueue service + webhook hook. ✓
- **Cloud→desktop delivery (pull ~30s):** Tasks 5, 9 — `/print/poll` + launcher poller. ✓
- **Receipt: core reconciliation + itemized cash drops:** Tasks 2, 3 — payload + template (drops table). ✓
- **Printer-agnostic / any installed queue:** Task 9 prints to `deviceName`. ✓
- **Dedupe / no double-print:** Task 1 unique index + Task 4 23505 handling. ✓
- **Security (device shared-key, admin JWT, RLS, unguessable receipt URL):** Tasks 1, 5, 6. ✓
- **Dependency on till-cash-tracking** is isolated to Task 7 (injected `loadReconciliation`), so Tasks 1-6 + 8-12 build and test on master today. ✓

**Open follow-ups (not blocking v1):** Star TSP143 narrow-paper template variant; stale-job cutoff (skip jobs older than ~12h) can be added to the `/print/poll` job query when needed.

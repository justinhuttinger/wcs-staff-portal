# Revenue Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest ABC Financial's daily "Revenue by Profit Center" CSV (via SendGrid Inbound Parse) into Supabase, support multi-year backfill via admin upload, and surface a Revenue dashboard inside the existing Reporting tile.

**Architecture:** Node/Express auth API ingests CSV → two Supabase tables (`abc_revenue_imports` for audit, `abc_revenue_transactions` for grain) → one `revenue_summary` Postgres RPC aggregates → React portal renders cards, trend, and breakdown. Idempotency is achieved by deleting all rows for `(payment_date BETWEEN period_start AND period_end, club_number IN clubs_in_file)` before insert.

**Tech Stack:** Node 22 + Express + `csv-parse` + multer + `@supabase/supabase-js` (auth API); React 19 + Vite + Tailwind 4 + custom SVG charts (portal); Postgres 15 (Supabase). Tests use Node's built-in `node:test` runner — no install needed.

**Spec:** `docs/superpowers/specs/2026-05-13-revenue-reporting-design.md`

---

## File Structure

**New files (auth/server):**
- `auth/migrations/019_abc_revenue.sql` — DDL for the two tables + `revenue_summary` RPC
- `auth/src/services/revenueCsvParser.js` — pure parsing logic (no DB, no I/O)
- `auth/src/services/revenueIngest.js` — DB-write side (idempotent delete-then-insert)
- `auth/src/routes/revenue.js` — webhook + admin upload routes
- `auth/src/routes/revenueReports.js` — read-side endpoints (mounted at `/reports/revenue`)
- `auth/tests/revenueCsvParser.test.js` — `node:test` unit tests for the parser
- `auth/tests/fixtures/revenue-sample.csv` — copy of the 12-day sample for tests

**New files (portal/client):**
- `portal/src/components/reports/RevenueReport.jsx` — the report view component
- `portal/src/components/admin/RevenueBackfillTile.jsx` — Admin Panel upload widget

**Modified files:**
- `auth/package.json` — add `csv-parse` dep
- `auth/src/index.js` — mount `/revenue` and `/reports/revenue` routers
- `auth/src/middleware/role.js` — add `revenue` to `REPORT_ACCESS` matrix
- `portal/src/lib/api.js` — three new wrappers
- `portal/src/components/ReportingView.jsx` — add tile, icon, group entry, render switch

---

## Task 1: Database migration (tables + RPC)

**Files:**
- Create: `auth/migrations/019_abc_revenue.sql`

- [ ] **Step 1: Write the migration**

Create `auth/migrations/019_abc_revenue.sql` with this content:

```sql
-- 019_abc_revenue.sql
-- ABC "Revenue by Profit Center" ingest tables and aggregation RPC.
-- Spec: docs/superpowers/specs/2026-05-13-revenue-reporting-design.md
-- Ingested via SendGrid Inbound Parse (daily) + admin upload (backfill).

-- -------------------------------------------------------------------------
-- abc_revenue_imports — one row per ingest attempt (webhook OR admin upload).
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS abc_revenue_imports (
  id              bigserial PRIMARY KEY,
  source          text        NOT NULL CHECK (source IN ('sendgrid_webhook', 'admin_upload')),
  uploaded_by     uuid        REFERENCES auth.users(id),
  period_start    date        NOT NULL,
  period_end      date        NOT NULL,
  reported_total  numeric(14,2),
  computed_total  numeric(14,2),
  row_count       int,
  filename        text,
  email_subject   text,
  status          text        NOT NULL CHECK (status IN ('success','partial','failed')),
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_abc_revenue_imports_created
  ON abc_revenue_imports (created_at DESC);

-- -------------------------------------------------------------------------
-- abc_revenue_transactions — transaction grain (one row per CSV line).
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS abc_revenue_transactions (
  id                    bigserial PRIMARY KEY,
  payment_date          date          NOT NULL,
  club_number           text          NOT NULL,
  location_slug         text          NOT NULL,
  member_number         text,
  agreement_number      text,
  member_first_name     text,
  member_last_name      text,
  billing_type          text,
  membership_type_code  text,
  profit_center         text          NOT NULL,
  catalog_item          text,
  payment_code_desc     text,
  payment_type          text,
  collected_method      text,
  receipt_number        text,
  gl_code               text,
  payment_amount        numeric(12,2) NOT NULL,
  total_amount          numeric(12,2),
  tax_amount            numeric(12,2),
  source_file_id        bigint        NOT NULL REFERENCES abc_revenue_imports(id) ON DELETE CASCADE,
  source_row_index      int           NOT NULL,
  imported_at           timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (source_file_id, source_row_index)
);

CREATE INDEX IF NOT EXISTS idx_abc_revenue_tx_date
  ON abc_revenue_transactions (payment_date);
CREATE INDEX IF NOT EXISTS idx_abc_revenue_tx_loc_date
  ON abc_revenue_transactions (location_slug, payment_date);
CREATE INDEX IF NOT EXISTS idx_abc_revenue_tx_pc_date
  ON abc_revenue_transactions (profit_center, payment_date);
CREATE INDEX IF NOT EXISTS idx_abc_revenue_tx_loc_pc_date
  ON abc_revenue_transactions (location_slug, profit_center, payment_date);

-- -------------------------------------------------------------------------
-- revenue_summary(start_date, end_date, location_filter) — single-call
-- rollup used by /reports/revenue/summary. NULL/empty location_filter means
-- all WCS clubs.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION revenue_summary(
  p_start_date   date,
  p_end_date     date,
  p_location_filter text[] DEFAULT NULL
)
RETURNS TABLE (
  bucket          text,    -- 'total' | 'by_club' | 'by_profit_center' | 'by_day'
  key1            text,    -- slug for by_club, profit_center for by_profit_center, date for by_day
  key2            text,    -- reserved for future use
  total_amount    numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH filtered AS (
    SELECT *
    FROM abc_revenue_transactions
    WHERE payment_date BETWEEN p_start_date AND p_end_date
      AND (p_location_filter IS NULL
           OR cardinality(p_location_filter) = 0
           OR location_slug = ANY(p_location_filter))
  )
  SELECT 'total'::text AS bucket, NULL::text AS key1, NULL::text AS key2,
         COALESCE(SUM(payment_amount), 0) AS total_amount
  FROM filtered
  UNION ALL
  SELECT 'by_club'::text, location_slug, NULL::text,
         SUM(payment_amount)
  FROM filtered
  GROUP BY location_slug
  UNION ALL
  SELECT 'by_profit_center'::text, profit_center, NULL::text,
         SUM(payment_amount)
  FROM filtered
  GROUP BY profit_center
  UNION ALL
  SELECT 'by_day'::text, payment_date::text, NULL::text,
         SUM(payment_amount)
  FROM filtered
  GROUP BY payment_date;
$$;
```

- [ ] **Step 2: Apply the migration to Supabase**

Justin runs this manually via the Supabase SQL Editor (project `ybopxxydsuwlbwxiuzve`) or via `psql` if connected. **Do not auto-apply** — confirm with Justin first.

Verification (after Justin applies):

```sql
SELECT to_regclass('public.abc_revenue_imports');
SELECT to_regclass('public.abc_revenue_transactions');
SELECT * FROM revenue_summary('2026-01-01'::date, '2026-12-31'::date);
```

Expected: both table names returned (non-null); RPC returns 0 rows (empty tables).

- [ ] **Step 3: Commit**

```bash
git add auth/migrations/019_abc_revenue.sql
git commit -m "feat(revenue): add abc_revenue_imports + abc_revenue_transactions migration"
```

---

## Task 2: Install csv-parse and copy test fixture

**Files:**
- Modify: `auth/package.json`
- Create: `auth/tests/fixtures/revenue-sample.csv` (copy of `C:\Users\justi\Downloads\Revenue by Profit Center.csv`)

- [ ] **Step 1: Add the dependency**

```bash
cd auth && npm install csv-parse@^5.6.0
```

Expected: `package.json` gains `"csv-parse": "^5.6.0"` under `dependencies`; `package-lock.json` updated.

- [ ] **Step 2: Copy the sample CSV into the repo as a test fixture**

```bash
mkdir -p auth/tests/fixtures
cp "/c/Users/justi/Downloads/Revenue by Profit Center.csv" auth/tests/fixtures/revenue-sample.csv
```

Expected: `auth/tests/fixtures/revenue-sample.csv` is ~3.2 MB, 9,144 lines.

- [ ] **Step 3: Verify it's gitignore-safe**

The fixture contains real member data. Check `.gitignore` — if `auth/tests/fixtures/` is not already excluded, **do not commit the fixture**; add `auth/tests/fixtures/*.csv` to `.gitignore` and document its location in a README. For local testing the file stays on disk but does not enter git history.

```bash
echo 'auth/tests/fixtures/*.csv' >> .gitignore
```

- [ ] **Step 4: Commit**

```bash
git add auth/package.json auth/package-lock.json .gitignore
git commit -m "feat(revenue): add csv-parse dep + gitignore parser fixtures"
```

---

## Task 3: Parser — money + date helpers (TDD)

**Files:**
- Create: `auth/tests/revenueCsvParser.test.js`
- Create: `auth/src/services/revenueCsvParser.js`

- [ ] **Step 1: Write the failing tests for parseMoney and parseDate**

Create `auth/tests/revenueCsvParser.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseMoney, parseDate } = require('../src/services/revenueCsvParser')

test('parseMoney handles plain dollars', () => {
  assert.equal(parseMoney('$24.50'), 24.5)
})

test('parseMoney handles commas', () => {
  assert.equal(parseMoney('$1,234.56'), 1234.56)
})

test('parseMoney handles quoted commas', () => {
  assert.equal(parseMoney('"$262,386.78"'), 262386.78)
})

test('parseMoney handles parens as negative (refund)', () => {
  assert.equal(parseMoney('($40.00)'), -40)
})

test('parseMoney handles empty/blank as 0', () => {
  assert.equal(parseMoney(''), 0)
  assert.equal(parseMoney(null), 0)
  assert.equal(parseMoney(undefined), 0)
})

test('parseMoney handles zero', () => {
  assert.equal(parseMoney('$0.00'), 0)
})

test('parseDate converts MM/DD/YYYY to ISO', () => {
  assert.equal(parseDate('05/12/2026'), '2026-05-12')
})

test('parseDate handles single-digit-via-leading-zero MM/DD', () => {
  assert.equal(parseDate('01/05/2024'), '2024-01-05')
})

test('parseDate returns null for blank/invalid', () => {
  assert.equal(parseDate(''), null)
  assert.equal(parseDate(null), null)
  assert.equal(parseDate('garbage'), null)
})
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
cd auth && node --test tests/revenueCsvParser.test.js
```

Expected: All tests fail with `Cannot find module '../src/services/revenueCsvParser'`.

- [ ] **Step 3: Implement the minimal helpers**

Create `auth/src/services/revenueCsvParser.js`:

```js
// ABC "Revenue by Profit Center" CSV parser.
// Pure functions only — no DB, no I/O. Consumed by routes/revenue.js.
//
// Spec: docs/superpowers/specs/2026-05-13-revenue-reporting-design.md

// WCS-only club mapping. Anything not in this map is skipped at parse time.
// 31601 ("EAST SIDE ATHLETIC CLUB" in ABC) is Milwaukie's trade name.
const CLUB_MAP = {
  '30935': 'salem',
  '31599': 'keizer',
  '07655': 'eugene',
  '31598': 'springfield',
  '31600': 'clackamas',
  '32073': 'medford',
  '31601': 'milwaukie',
}

function parseMoney(raw) {
  if (raw === null || raw === undefined || raw === '') return 0
  let s = String(raw).trim()
  // Strip surrounding double quotes (CSV preserves them inside cells when commas are present)
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim()
  let negative = false
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true
    s = s.slice(1, -1).trim()
  }
  s = s.replace(/[$,]/g, '')
  if (s === '' || s === '-') return 0
  const n = Number(s)
  if (Number.isNaN(n)) return 0
  return negative ? -n : n
}

function parseDate(raw) {
  if (!raw) return null
  const m = String(raw).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[1]}-${m[2]}`
}

module.exports = {
  CLUB_MAP,
  parseMoney,
  parseDate,
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

```bash
cd auth && node --test tests/revenueCsvParser.test.js
```

Expected: All 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/revenueCsvParser.js auth/tests/revenueCsvParser.test.js
git commit -m "feat(revenue): money/date parse helpers + CLUB_MAP whitelist"
```

---

## Task 4: Parser — header extraction (TDD)

**Files:**
- Modify: `auth/src/services/revenueCsvParser.js`
- Modify: `auth/tests/revenueCsvParser.test.js`

- [ ] **Step 1: Add the failing test for parseHeaderMeta**

Append to `auth/tests/revenueCsvParser.test.js`:

```js
const { parseHeaderMeta } = require('../src/services/revenueCsvParser')

test('parseHeaderMeta extracts period and total from Textbox16', () => {
  const tb = 'Location: All Locations | Date: 05/01/2026 - 05/12/2026 | Total Revenue: $262,386.78'
  assert.deepEqual(parseHeaderMeta(tb), {
    period_start: '2026-05-01',
    period_end: '2026-05-12',
    reported_total: 262386.78,
  })
})

test('parseHeaderMeta handles single-day period', () => {
  const tb = 'Location: All Locations | Date: 05/12/2026 - 05/12/2026 | Total Revenue: $5,000.00'
  assert.deepEqual(parseHeaderMeta(tb), {
    period_start: '2026-05-12',
    period_end: '2026-05-12',
    reported_total: 5000,
  })
})

test('parseHeaderMeta returns null on unrecognized string', () => {
  assert.equal(parseHeaderMeta('Some other subject line'), null)
  assert.equal(parseHeaderMeta(''), null)
  assert.equal(parseHeaderMeta(null), null)
})
```

- [ ] **Step 2: Run the test, confirm new tests fail**

```bash
cd auth && node --test tests/revenueCsvParser.test.js
```

Expected: 3 new tests fail with `parseHeaderMeta is not a function`.

- [ ] **Step 3: Implement parseHeaderMeta**

Add to `auth/src/services/revenueCsvParser.js` (before `module.exports`):

```js
function parseHeaderMeta(textbox16) {
  if (!textbox16) return null
  const s = String(textbox16)
  const dateMatch = s.match(/Date:\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/)
  const totalMatch = s.match(/Total Revenue:\s*\$?([\d,]+\.\d{2})/)
  if (!dateMatch || !totalMatch) return null
  const period_start = parseDate(dateMatch[1])
  const period_end = parseDate(dateMatch[2])
  const reported_total = Number(totalMatch[1].replace(/,/g, ''))
  if (!period_start || !period_end || Number.isNaN(reported_total)) return null
  return { period_start, period_end, reported_total }
}
```

Update `module.exports` to include the new function:

```js
module.exports = {
  CLUB_MAP,
  parseMoney,
  parseDate,
  parseHeaderMeta,
}
```

- [ ] **Step 4: Run the tests, confirm all 12 pass**

```bash
cd auth && node --test tests/revenueCsvParser.test.js
```

Expected: 12 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/revenueCsvParser.js auth/tests/revenueCsvParser.test.js
git commit -m "feat(revenue): parseHeaderMeta extracts period + reported total"
```

---

## Task 5: Parser — full CSV parse with sample fixture (TDD)

**Files:**
- Modify: `auth/src/services/revenueCsvParser.js`
- Modify: `auth/tests/revenueCsvParser.test.js`

- [ ] **Step 1: Write the failing integration test**

Append to `auth/tests/revenueCsvParser.test.js`:

```js
const fs = require('node:fs')
const path = require('node:path')
const { parseRevenueCsv } = require('../src/services/revenueCsvParser')

const FIXTURE = path.join(__dirname, 'fixtures', 'revenue-sample.csv')
const hasFixture = fs.existsSync(FIXTURE)

test('parseRevenueCsv reads the 12-day sample end-to-end', { skip: !hasFixture && 'fixture missing; copy it into auth/tests/fixtures/' }, () => {
  const buf = fs.readFileSync(FIXTURE)
  const result = parseRevenueCsv(buf)

  assert.equal(result.period_start, '2026-05-01')
  assert.equal(result.period_end, '2026-05-12')
  assert.equal(result.reported_total, 262386.78)

  // All parsed rows pass WCS club filter
  assert.ok(result.rows.length > 0, 'expected > 0 parsed rows')
  for (const r of result.rows) {
    assert.ok(['salem','keizer','eugene','springfield','clackamas','medford','milwaukie'].includes(r.location_slug),
      `unexpected location_slug ${r.location_slug}`)
    assert.ok(r.payment_date.match(/^\d{4}-\d{2}-\d{2}$/), `bad payment_date ${r.payment_date}`)
    assert.ok(typeof r.payment_amount === 'number', 'payment_amount must be a number')
    assert.ok(r.profit_center, 'profit_center required')
  }

  // Computed total should match reported total within 1 cent
  const computed = result.rows.reduce((s, r) => s + r.payment_amount, 0)
  assert.ok(Math.abs(computed - result.reported_total) < 0.01,
    `computed ${computed} != reported ${result.reported_total}`)

  // At least one refund row should be negative
  const refunds = result.rows.filter(r => r.payment_amount < 0)
  assert.ok(refunds.length > 0, 'expected at least one negative refund row')

  // Milwaukie rows should exist (East Side Athletic Club, club 31601)
  const milwaukie = result.rows.filter(r => r.location_slug === 'milwaukie')
  assert.ok(milwaukie.length > 0, 'expected Milwaukie rows from club 31601')
  for (const r of milwaukie) assert.equal(r.club_number, '31601')
})

test('parseRevenueCsv skips rows with unknown club_number', () => {
  // Build a minimal in-memory CSV with one known + one unknown club
  const csv = [
    'Textbox16,CLUB_NAME,CLUB_NUMBER,PAYMENT_CLUB,HOME_CLUB,MEMBER_NUMBER,AGREEMENT_NUMBER,LAST_NAME,FIRST_NAME,BILLING_TYPE,BILLING_MODE,BILLING_FREQUENCY,MEMBERSHIP_TYPE_ABC_CODE,PROFIT_CENTER,CATALOG_ITEM,DATE_KEY,PAYMENT_TYPE,PAYMENT_CODE_DESCRIPTION,TOTAL_AMOUNT3,TAX_AMOUNT,PAYMENT_AMOUNT,RECEIPT_NUMBER,COLLECTED_METHOD,GL_CODE,Textbox69,CLUB_NUMBER_I2,TOTAL_AMOUNT4,Textbox86,PAYMENT_AMOUNT1,CLUB_NUMBER_I1,TOTAL_AMOUNT5,Textbox64,PAYMENT_AMOUNT2',
    '"Location: All Locations | Date: 05/01/2026 - 05/01/2026 | Total Revenue: $100.00",WEST COAST STRENGTH SALEM,30935,30935,30935,001,30935001,DOE,JOHN,,,,SGL,DUES,DUES PAYMENT,05/01/2026,VISA,,$100.00,$0.00,$100.00,R1,POS Club Collected,,Total DUES,1,$100.00,$0.00,$100.00,1,$100.00,$0.00,$100.00',
    '"Location: All Locations | Date: 05/01/2026 - 05/01/2026 | Total Revenue: $100.00",SOME OTHER GYM,99999,99999,99999,002,99999002,SMITH,JANE,,,,SGL,DUES,DUES PAYMENT,05/01/2026,VISA,,$50.00,$0.00,$50.00,R2,POS Club Collected,,Total DUES,1,$100.00,$0.00,$100.00,1,$100.00,$0.00,$100.00',
  ].join('\n')
  const result = parseRevenueCsv(Buffer.from(csv))
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].location_slug, 'salem')
  assert.equal(result.skipped.unknown_club, 1)
})
```

- [ ] **Step 2: Run the tests, confirm they fail**

```bash
cd auth && node --test tests/revenueCsvParser.test.js
```

Expected: 2 new tests fail with `parseRevenueCsv is not a function`.

- [ ] **Step 3: Implement parseRevenueCsv**

Add to `auth/src/services/revenueCsvParser.js`:

```js
const { parse: parseSync } = require('csv-parse/sync')

function parseRevenueCsv(buffer) {
  const text = buffer.toString('utf8').replace(/\r\n/g, '\n')

  // csv-parse `relax_*` flags absorb the ABC report's footer junk + smart quotes
  let records
  try {
    records = parseSync(text, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      trim: false,
    })
  } catch (err) {
    return {
      period_start: null,
      period_end: null,
      reported_total: null,
      rows: [],
      skipped: { unknown_club: 0, missing_date: 0, missing_amount: 0, bad_shape: 0 },
      errors: [`csv-parse failed: ${err.message}`],
    }
  }

  let header = null
  const rows = []
  const skipped = { unknown_club: 0, missing_date: 0, missing_amount: 0, bad_shape: 0 }
  const errors = []

  records.forEach((rec, idx) => {
    // First row that has a non-empty Textbox16 carries the period + total
    if (!header && rec.Textbox16) {
      const meta = parseHeaderMeta(rec.Textbox16)
      if (meta) header = meta
    }

    const clubNumber = (rec.CLUB_NUMBER || '').trim()
    if (!clubNumber) {
      skipped.bad_shape += 1
      return
    }
    const slug = CLUB_MAP[clubNumber]
    if (!slug) {
      skipped.unknown_club += 1
      return
    }
    const payment_date = parseDate(rec.DATE_KEY)
    if (!payment_date) {
      skipped.missing_date += 1
      return
    }
    const payment_amount = parseMoney(rec.PAYMENT_AMOUNT)
    // We allow 0 amounts (zero-dollar membership rows exist in the data) but
    // skip rows that have neither a date nor any amount AND blank profit center.
    if (payment_amount === 0 && !rec.PROFIT_CENTER) {
      skipped.missing_amount += 1
      return
    }

    rows.push({
      source_row_index: idx,
      payment_date,
      club_number: clubNumber,
      location_slug: slug,
      member_number: (rec.MEMBER_NUMBER || '').trim() || null,
      agreement_number: (rec.AGREEMENT_NUMBER || '').trim() || null,
      member_first_name: (rec.FIRST_NAME || '').trim() || null,
      member_last_name: (rec.LAST_NAME || '').trim() || null,
      billing_type: (rec.BILLING_TYPE || '').trim() || null,
      membership_type_code: (rec.MEMBERSHIP_TYPE_ABC_CODE || '').trim() || null,
      profit_center: (rec.PROFIT_CENTER || '').trim(),
      catalog_item: (rec.CATALOG_ITEM || '').trim() || null,
      payment_code_desc: (rec.PAYMENT_CODE_DESCRIPTION || '').trim() || null,
      payment_type: (rec.PAYMENT_TYPE || '').trim() || null,
      collected_method: (rec.COLLECTED_METHOD || '').trim() || null,
      receipt_number: (rec.RECEIPT_NUMBER || '').trim() || null,
      gl_code: (rec.GL_CODE || '').trim() || null,
      payment_amount,
      total_amount: parseMoney(rec.TOTAL_AMOUNT3) || null,
      tax_amount: parseMoney(rec.TAX_AMOUNT) || null,
    })
  })

  return {
    period_start: header ? header.period_start : null,
    period_end: header ? header.period_end : null,
    reported_total: header ? header.reported_total : null,
    rows,
    skipped,
    errors,
  }
}
```

Update `module.exports`:

```js
module.exports = {
  CLUB_MAP,
  parseMoney,
  parseDate,
  parseHeaderMeta,
  parseRevenueCsv,
}
```

- [ ] **Step 4: Run all tests, confirm they pass**

```bash
cd auth && node --test tests/revenueCsvParser.test.js
```

Expected: 14 tests pass (12 prior + 2 new). The sample-fixture test will be skipped if Justin hasn't placed the fixture; manual prompt to copy it lives in Task 2.

- [ ] **Step 5: Commit**

```bash
git add auth/src/services/revenueCsvParser.js auth/tests/revenueCsvParser.test.js
git commit -m "feat(revenue): parseRevenueCsv handles full CSV with sample-fixture test"
```

---

## Task 6: Ingest service (DB writes, idempotent)

**Files:**
- Create: `auth/src/services/revenueIngest.js`

- [ ] **Step 1: Write the ingest module**

Create `auth/src/services/revenueIngest.js`:

```js
// Writes parsed revenue rows into Supabase with idempotent "delete window then
// insert" semantics. Window = (period_start..period_end) ∩ (clubs_in_file).
//
// Called by:
//   - POST /revenue/webhook  (source = 'sendgrid_webhook')
//   - POST /revenue/upload   (source = 'admin_upload')
//
// Spec: docs/superpowers/specs/2026-05-13-revenue-reporting-design.md

const { supabaseAdmin } = require('./supabase')

const INSERT_CHUNK = 5000

async function ingestParsedRevenue({ parsed, source, uploadedBy, filename, emailSubject }) {
  if (!parsed) throw new Error('parsed payload required')
  const {
    period_start, period_end, reported_total, rows, skipped = {}, errors = [],
  } = parsed

  if (!period_start || !period_end) {
    return { ok: false, error: 'missing_period', import_id: null, skipped, errors }
  }
  if (errors.length > 0) {
    return { ok: false, error: errors.join('; '), import_id: null, skipped, errors }
  }

  // 1. Insert pending import row
  const { data: importRow, error: importErr } = await supabaseAdmin
    .from('abc_revenue_imports')
    .insert({
      source,
      uploaded_by: uploadedBy || null,
      period_start,
      period_end,
      reported_total,
      computed_total: null,
      row_count: rows.length,
      filename: filename || null,
      email_subject: emailSubject || null,
      status: 'partial',
    })
    .select('id')
    .single()

  if (importErr) {
    return { ok: false, error: `import insert failed: ${importErr.message}`, import_id: null }
  }
  const sourceFileId = importRow.id

  try {
    // 2. Delete prior rows in window for clubs touched by this file
    const clubsInFile = Array.from(new Set(rows.map(r => r.club_number)))
    if (clubsInFile.length > 0) {
      const { error: delErr } = await supabaseAdmin
        .from('abc_revenue_transactions')
        .delete()
        .gte('payment_date', period_start)
        .lte('payment_date', period_end)
        .in('club_number', clubsInFile)
      if (delErr) throw new Error(`delete window failed: ${delErr.message}`)
    }

    // 3. Bulk insert in chunks
    let inserted = 0
    let computed = 0
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK).map(r => ({ ...r, source_file_id: sourceFileId }))
      const { error: insErr } = await supabaseAdmin
        .from('abc_revenue_transactions')
        .insert(chunk)
      if (insErr) throw new Error(`insert chunk ${i / INSERT_CHUNK} failed: ${insErr.message}`)
      inserted += chunk.length
      computed += chunk.reduce((s, r) => s + (r.payment_amount || 0), 0)
    }

    // 4. Finalize import row
    const reconciled = reported_total !== null && Math.abs(computed - reported_total) < 0.01
    const status = reconciled ? 'success' : 'partial'
    await supabaseAdmin
      .from('abc_revenue_imports')
      .update({
        computed_total: Number(computed.toFixed(2)),
        status,
        error_message: reconciled ? null : `drift: computed ${computed.toFixed(2)} vs reported ${reported_total}`,
      })
      .eq('id', sourceFileId)

    return {
      ok: true,
      import_id: sourceFileId,
      period_start,
      period_end,
      row_count: inserted,
      reported_total,
      computed_total: Number(computed.toFixed(2)),
      reconciled,
      skipped,
    }
  } catch (err) {
    await supabaseAdmin
      .from('abc_revenue_imports')
      .update({ status: 'failed', error_message: err.message })
      .eq('id', sourceFileId)
    return { ok: false, error: err.message, import_id: sourceFileId, skipped }
  }
}

module.exports = { ingestParsedRevenue }
```

- [ ] **Step 2: Smoke-test require/loadability**

```bash
cd auth && node -e "console.log(Object.keys(require('./src/services/revenueIngest')))"
```

Expected: `[ 'ingestParsedRevenue' ]`

- [ ] **Step 3: Commit**

```bash
git add auth/src/services/revenueIngest.js
git commit -m "feat(revenue): idempotent ingest service (delete window + chunked insert)"
```

---

## Task 7: Webhook + Upload routes

**Files:**
- Create: `auth/src/routes/revenue.js`

- [ ] **Step 1: Write the routes file**

Create `auth/src/routes/revenue.js`:

```js
const { Router } = require('express')
const multer = require('multer')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { parseRevenueCsv } = require('../services/revenueCsvParser')
const { ingestParsedRevenue } = require('../services/revenueIngest')

const router = Router()

const WEBHOOK_SECRET = process.env.REVENUE_WEBHOOK_SECRET

// SendGrid Inbound Parse can send multipart with several files; admin upload sends a single file.
// 200 MB cap: a yearly backfill (~300k rows ~ 100MB) fits; a 5-year file would exceed and must be chunked.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
})

function pickCsvFile(files) {
  if (!files || files.length === 0) return null
  // Prefer fields named attachment1 / file / csv; else first text/csv-ish mimetype.
  const named = files.find(f => ['attachment1', 'file', 'csv'].includes(f.fieldname))
  if (named) return named
  const byType = files.find(f => /csv|excel|octet-stream|text\//.test(f.mimetype))
  return byType || files[0]
}

// ---------------------------------------------------------------------------
// POST /revenue/webhook — SendGrid Inbound Parse target.
// Auth: shared secret in ?secret= (SendGrid can't send custom headers).
// ---------------------------------------------------------------------------
router.post('/webhook', upload.any(), async (req, res) => {
  if (!WEBHOOK_SECRET || req.query.secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'invalid webhook secret' })
  }
  const file = pickCsvFile(req.files)
  if (!file) {
    console.warn('[revenue/webhook] no attachment in payload')
    return res.status(200).json({ ignored: true, reason: 'no attachment' })
  }
  const parsed = parseRevenueCsv(file.buffer)
  const result = await ingestParsedRevenue({
    parsed,
    source: 'sendgrid_webhook',
    filename: file.originalname,
    emailSubject: req.body?.subject || null,
  })
  if (!result.ok) {
    console.error('[revenue/webhook] ingest failed', result)
    return res.status(500).json({ error: result.error, import_id: result.import_id })
  }
  console.log(`[revenue/webhook] stored ${result.row_count} rows for ${result.period_start}..${result.period_end}`)
  res.json(result)
})

// ---------------------------------------------------------------------------
// POST /revenue/upload — admin manual upload (backfill).
// Auth: session + role 'admin'.
// ---------------------------------------------------------------------------
router.post(
  '/upload',
  authenticate,
  requireRole('admin'),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file' })
    const parsed = parseRevenueCsv(req.file.buffer)
    const result = await ingestParsedRevenue({
      parsed,
      source: 'admin_upload',
      uploadedBy: req.staff?.user_id || null,
      filename: req.file.originalname,
    })
    if (!result.ok) return res.status(500).json(result)
    res.json(result)
  }
)

module.exports = router
```

- [ ] **Step 2: Smoke-test require/loadability**

```bash
cd auth && node -e "const r = require('./src/routes/revenue'); console.log('router loaded:', typeof r)"
```

Expected: `router loaded: function`

- [ ] **Step 3: Commit**

```bash
git add auth/src/routes/revenue.js
git commit -m "feat(revenue): /revenue/webhook (SendGrid) + /revenue/upload (admin)"
```

---

## Task 8: Read API + role gate

**Files:**
- Create: `auth/src/routes/revenueReports.js`
- Modify: `auth/src/middleware/role.js`

- [ ] **Step 1: Add `revenue` to REPORT_ACCESS**

In `auth/src/middleware/role.js`, the `REPORT_ACCESS` object currently looks like:

```js
const REPORT_ACCESS = {
  membership:   ['lead', 'manager', 'marketing', 'corporate', 'admin'],
  'club-health': ['manager', 'marketing', 'corporate', 'admin'],
  pt:           ['lead', 'manager', 'marketing', 'corporate', 'admin'],
  checkins:     ['lead', 'manager', 'marketing', 'corporate', 'admin'],
  'pt-sessions': ['lead', 'manager', 'marketing', 'corporate', 'admin'],
  payroll:      ['manager', 'corporate', 'admin'],
  marketing:    ['marketing', 'corporate', 'admin'],
}
```

Add a `revenue` entry — managers and above (no `lead`, no `marketing`):

```js
const REPORT_ACCESS = {
  membership:   ['lead', 'manager', 'marketing', 'corporate', 'admin'],
  'club-health': ['manager', 'marketing', 'corporate', 'admin'],
  pt:           ['lead', 'manager', 'marketing', 'corporate', 'admin'],
  checkins:     ['lead', 'manager', 'marketing', 'corporate', 'admin'],
  'pt-sessions': ['lead', 'manager', 'marketing', 'corporate', 'admin'],
  payroll:      ['manager', 'corporate', 'admin'],
  marketing:    ['marketing', 'corporate', 'admin'],
  revenue:      ['manager', 'corporate', 'admin'],
}
```

- [ ] **Step 2: Create the read-side router**

Create `auth/src/routes/revenueReports.js`:

```js
const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole, canSeeAllLocations } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')

const router = Router()

// Resolve the location_slug filter the caller is allowed to use.
// - Returns null if caller may see all clubs (corporate/admin/marketing) AND
//   either passed no slug or slug='all'.
// - Returns ['<slug>'] for a single-club view.
// - Returns the caller's allowed slug set if they tried to overreach (silent narrow).
async function resolveLocationFilter(req) {
  const requestedRaw = (req.query.location_slug || '').trim()
  const requested = requestedRaw === '' || requestedRaw === 'all' ? null : requestedRaw
  const role = req.staff?.role

  if (canSeeAllLocations(role)) {
    return requested ? [requested] : null
  }

  // Manager / lead: lock to their allowed locations.
  const allowedIds = req.staff?.location_ids || []
  if (allowedIds.length === 0) return [] // No access at all → empty result
  const { data: allowedLocs } = await supabaseAdmin
    .from('locations')
    .select('name')
    .in('id', allowedIds)
  const allowedSlugs = (allowedLocs || []).map(l =>
    l.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  )
  if (requested && allowedSlugs.includes(requested)) return [requested]
  // Silent narrow: caller asked for something they can't have, OR no slug → give all their slugs.
  return allowedSlugs
}

function priorEquivalentPeriod(start, end) {
  const s = new Date(start + 'T00:00:00Z')
  const e = new Date(end + 'T00:00:00Z')
  const lengthDays = Math.round((e - s) / 86400000) + 1
  const prevEnd = new Date(s)
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1)
  const prevStart = new Date(prevEnd)
  prevStart.setUTCDate(prevStart.getUTCDate() - (lengthDays - 1))
  const iso = d => d.toISOString().slice(0, 10)
  return { start: iso(prevStart), end: iso(prevEnd) }
}

async function fetchSummary(startDate, endDate, locationFilter) {
  const { data, error } = await supabaseAdmin.rpc('revenue_summary', {
    p_start_date: startDate,
    p_end_date: endDate,
    p_location_filter: locationFilter,
  })
  if (error) throw new Error(`revenue_summary RPC failed: ${error.message}`)
  const out = { total: 0, by_club: [], by_profit_center: [], by_day: [] }
  for (const r of data || []) {
    const amount = Number(r.total_amount) || 0
    if (r.bucket === 'total') out.total = amount
    else if (r.bucket === 'by_club') out.by_club.push({ slug: r.key1, total: amount })
    else if (r.bucket === 'by_profit_center') out.by_profit_center.push({ name: r.key1, total: amount })
    else if (r.bucket === 'by_day') out.by_day.push({ date: r.key1, total: amount })
  }
  out.by_club.sort((a, b) => b.total - a.total)
  out.by_profit_center.sort((a, b) => b.total - a.total)
  const pcTotal = out.by_profit_center.reduce((s, p) => s + p.total, 0) || 1
  out.by_profit_center.forEach(p => { p.pct_of_total = p.total / pcTotal })
  out.by_day.sort((a, b) => a.date.localeCompare(b.date))
  return out
}

// ---------------------------------------------------------------------------
// GET /reports/revenue/summary
// ---------------------------------------------------------------------------
router.get('/summary', authenticate, requireRole('manager'), async (req, res) => {
  try {
    const { start_date, end_date } = req.query
    if (!start_date || !end_date) return res.status(400).json({ error: 'start_date and end_date required' })
    const locationFilter = await resolveLocationFilter(req)
    const compare = priorEquivalentPeriod(start_date, end_date)
    const [current, prior] = await Promise.all([
      fetchSummary(start_date, end_date, locationFilter),
      fetchSummary(compare.start, compare.end, locationFilter),
    ])
    res.json({
      period: { start: start_date, end: end_date },
      ...current,
      compare: { period: compare, ...prior },
    })
  } catch (err) {
    console.error('[revenue/summary]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /reports/revenue/profit-center-trend
// ---------------------------------------------------------------------------
router.get('/profit-center-trend', authenticate, requireRole('manager'), async (req, res) => {
  try {
    const { start_date, end_date, profit_center } = req.query
    if (!start_date || !end_date || !profit_center) {
      return res.status(400).json({ error: 'start_date, end_date, profit_center required' })
    }
    const locationFilter = await resolveLocationFilter(req)
    let q = supabaseAdmin
      .from('abc_revenue_transactions')
      .select('payment_date, payment_amount')
      .eq('profit_center', profit_center)
      .gte('payment_date', start_date)
      .lte('payment_date', end_date)
    if (locationFilter && locationFilter.length > 0) {
      q = q.in('location_slug', locationFilter)
    } else if (locationFilter && locationFilter.length === 0) {
      // No access — return empty series.
      return res.json({ series: [] })
    }
    const { data, error } = await q
    if (error) throw error
    const byDay = {}
    for (const r of data || []) {
      byDay[r.payment_date] = (byDay[r.payment_date] || 0) + Number(r.payment_amount)
    }
    const series = Object.entries(byDay)
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date))
    res.json({ series })
  } catch (err) {
    console.error('[revenue/profit-center-trend]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /reports/revenue/imports — last N import audit rows (admin Backfill UI)
// ---------------------------------------------------------------------------
router.get('/imports', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100)
    const { data, error } = await supabaseAdmin
      .from('abc_revenue_imports')
      .select('id, source, period_start, period_end, reported_total, computed_total, row_count, filename, status, error_message, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    res.json({ rows: data || [] })
  } catch (err) {
    console.error('[revenue/imports]', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
```

- [ ] **Step 3: Smoke-test loadability**

```bash
cd auth && node -e "const r = require('./src/routes/revenueReports'); console.log('router loaded:', typeof r)"
```

Expected: `router loaded: function`

- [ ] **Step 4: Commit**

```bash
git add auth/src/routes/revenueReports.js auth/src/middleware/role.js
git commit -m "feat(revenue): read API (/summary, /profit-center-trend, /imports) + role gate"
```

---

## Task 9: Wire routers into auth/src/index.js

**Files:**
- Modify: `auth/src/index.js`

- [ ] **Step 1: Mount both routers**

In `auth/src/index.js`, find the block of `app.use('/operandio', ...)` etc. Add these two lines next to the other report mounts (keep `/reports/revenue` before the generic `/reports` catch-all):

```js
app.use('/revenue', require('./routes/revenue'))
app.use('/reports/revenue', require('./routes/revenueReports'))
```

Concretely: place `app.use('/reports/revenue', ...)` after the existing `app.use('/reports/fb-roas', ...)` line and before `app.use('/reports', require('./routes/reports'))`. Place `app.use('/revenue', ...)` next to `app.use('/operandio', ...)` for logical grouping.

- [ ] **Step 2: Boot the dev server and verify endpoints respond**

```bash
cd auth && npm run dev
```

In another terminal:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/revenue/webhook?secret=wrong
# Expected: 401

curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/reports/revenue/summary
# Expected: 401 (no auth)
```

Stop the dev server (Ctrl-C).

- [ ] **Step 3: Commit**

```bash
git add auth/src/index.js
git commit -m "feat(revenue): mount /revenue + /reports/revenue routers"
```

---

## Task 10: Portal lib/api.js wrappers

**Files:**
- Modify: `portal/src/lib/api.js`

- [ ] **Step 1: Add three wrappers**

Append to `portal/src/lib/api.js` (alongside existing `getFbRoas`, `getOperandioRange` exports):

```js
export async function getRevenueSummary(params = {}) {
  const qs = new URLSearchParams()
  if (params.start_date) qs.set('start_date', params.start_date)
  if (params.end_date) qs.set('end_date', params.end_date)
  if (params.location_slug) qs.set('location_slug', params.location_slug)
  return api(`/reports/revenue/summary?${qs.toString()}`)
}

export async function getRevenueProfitCenterTrend(params = {}) {
  const qs = new URLSearchParams()
  if (params.start_date) qs.set('start_date', params.start_date)
  if (params.end_date) qs.set('end_date', params.end_date)
  if (params.location_slug) qs.set('location_slug', params.location_slug)
  if (params.profit_center) qs.set('profit_center', params.profit_center)
  return api(`/reports/revenue/profit-center-trend?${qs.toString()}`)
}

export async function getRevenueImports(limit = 20) {
  return api(`/reports/revenue/imports?limit=${limit}`)
}

export async function uploadRevenueCsv(file) {
  const fd = new FormData()
  fd.append('file', file)
  return api('/revenue/upload', { method: 'POST', body: fd, isFormData: true })
}
```

If `api()` does not currently support `isFormData` (it sets `Content-Type: application/json` by default), check `portal/src/lib/api.js` lines 95-148 for the `api` function and adjust — when `options.isFormData === true`, skip the JSON header so the browser sets multipart boundaries.

- [ ] **Step 2: Verify by reading the file back**

Check that the three exports appear and the `api` helper still compiles. No automated test — visual diff is enough for this file.

- [ ] **Step 3: Commit**

```bash
git add portal/src/lib/api.js
git commit -m "feat(revenue): portal api wrappers for revenue endpoints"
```

---

## Task 11: RevenueReport.jsx component

**Files:**
- Create: `portal/src/components/reports/RevenueReport.jsx`

- [ ] **Step 1: Write the component**

Create `portal/src/components/reports/RevenueReport.jsx`:

```jsx
import React, { useEffect, useState } from 'react'
import { getRevenueSummary, getRevenueProfitCenterTrend } from '../../lib/api'
import { exportCSV } from '../../lib/export'

const TOP_N_STACKS = 6
const STACK_COLORS = ['#e53e3e', '#3182ce', '#38a169', '#805ad5', '#d69e2e', '#319795', '#a0aec0']

function fmtMoney(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n || 0)
}

function fmtPct(n) {
  return `${(n * 100).toFixed(1)}%`
}

function buildStackPoints(byDay, byProfitCenter, startDate, endDate) {
  // Top N profit centers go in their own stacks; the rest collapse to "Other".
  const top = byProfitCenter.slice(0, TOP_N_STACKS).map(p => p.name)
  const start = new Date(startDate + 'T00:00:00Z')
  const end = new Date(endDate + 'T00:00:00Z')
  // For v1 the API returns one total per day — to stack we'd need a richer
  // by_day_pc shape. Until then the chart shows total per day as a single area.
  const dateMap = {}
  byDay.forEach(d => { dateMap[d.date] = d.total })
  const points = []
  const cur = new Date(start)
  while (cur <= end) {
    const iso = cur.toISOString().slice(0, 10)
    points.push({ date: iso, total: dateMap[iso] || 0 })
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return { top, points }
}

function TrendChart({ points, label }) {
  if (!points || points.length === 0) return null
  const w = 720
  const h = 180
  const padL = 50
  const padR = 12
  const padT = 12
  const padB = 28
  const chartW = w - padL - padR
  const chartH = h - padT - padB
  const max = Math.max(1, ...points.map(p => p.total))
  const toX = i => padL + (points.length > 1 ? (i / (points.length - 1)) * chartW : chartW / 2)
  const toY = v => padT + chartH - (v / max) * chartH

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.total).toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${toX(points.length - 1).toFixed(1)},${(padT + chartH).toFixed(1)} L${toX(0).toFixed(1)},${(padT + chartH).toFixed(1)} Z`

  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">{label}</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: '220px' }}>
        <path d={areaPath} fill={STACK_COLORS[0]} opacity="0.15" />
        <path d={linePath} fill="none" stroke={STACK_COLORS[0]} strokeWidth="1.5" />
        {points.map((p, i) => (
          <title key={i}>{`${p.date}: ${fmtMoney(p.total)}`}</title>
        ))}
        <text x={padL - 4} y={padT + 8} textAnchor="end" className="fill-gray-400" style={{ fontSize: '9px' }}>{fmtMoney(max)}</text>
        <text x={padL - 4} y={padT + chartH + 3} textAnchor="end" className="fill-gray-400" style={{ fontSize: '9px' }}>$0</text>
        <text x={padL} y={h - 6} className="fill-gray-400" style={{ fontSize: '9px' }}>{points[0]?.date}</text>
        <text x={padL + chartW} y={h - 6} textAnchor="end" className="fill-gray-400" style={{ fontSize: '9px' }}>{points[points.length - 1]?.date}</text>
      </svg>
    </div>
  )
}

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-text-primary mt-1">{value}</p>
      {sub && <p className="text-xs text-text-muted mt-1">{sub}</p>}
    </div>
  )
}

function DeltaChip({ current, prior }) {
  if (!prior || prior === 0) return <span className="text-xs text-text-muted">no prior</span>
  const delta = current - prior
  const pct = delta / prior
  const positive = delta >= 0
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${positive ? 'text-green-600' : 'text-red-600'}`}>
      {positive ? '▲' : '▼'} {fmtPct(Math.abs(pct))} ({fmtMoney(Math.abs(delta))})
    </span>
  )
}

export default function RevenueReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeProfitCenter, setActiveProfitCenter] = useState(null)
  const [pcSeries, setPcSeries] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    setActiveProfitCenter(null)
    setPcSeries(null)
    getRevenueSummary({ start_date: startDate, end_date: endDate, location_slug: locationSlug })
      .then(d => setData(d))
      .catch(e => setError(e.message || 'Failed to load revenue summary'))
      .finally(() => setLoading(false))
  }, [startDate, endDate, locationSlug])

  function selectProfitCenter(pc) {
    if (activeProfitCenter === pc) {
      setActiveProfitCenter(null)
      setPcSeries(null)
      return
    }
    setActiveProfitCenter(pc)
    getRevenueProfitCenterTrend({
      start_date: startDate, end_date: endDate, location_slug: locationSlug, profit_center: pc,
    })
      .then(d => setPcSeries(d.series))
      .catch(() => setPcSeries([]))
  }

  function handleExportCsv() {
    if (!data) return
    const rows = [
      ['Profit Center', 'Total', 'Pct of Total'],
      ...data.by_profit_center.map(p => [p.name, p.total.toFixed(2), (p.pct_of_total * 100).toFixed(2) + '%']),
    ]
    exportCSV(rows, `revenue-${startDate}_to_${endDate}.csv`)
  }

  if (loading) return <div className="text-text-muted">Loading revenue…</div>
  if (error) return <div className="text-red-600">Error: {error}</div>
  if (!data) return null

  const topPc = data.by_profit_center[0]
  const topClub = data.by_club[0]
  const { points } = buildStackPoints(data.by_day, data.by_profit_center, startDate, endDate)
  const trendPoints = activeProfitCenter && pcSeries
    ? pcSeries.map(s => ({ date: s.date, total: s.total }))
    : points
  const chartLabel = activeProfitCenter ? `${activeProfitCenter} — Daily` : 'Daily Revenue Trend'

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Total Revenue" value={fmtMoney(data.total)} sub={<DeltaChip current={data.total} prior={data.compare?.total} />} />
        <StatCard label="Top Profit Center" value={topPc?.name || '—'} sub={topPc ? `${fmtMoney(topPc.total)} · ${fmtPct(topPc.pct_of_total)}` : null} />
        <StatCard label="Top Club" value={topClub?.slug ? topClub.slug.charAt(0).toUpperCase() + topClub.slug.slice(1) : '—'} sub={topClub ? fmtMoney(topClub.total) : null} />
        <StatCard label="Days in Range" value={data.by_day.length} sub={`${startDate} → ${endDate}`} />
      </div>

      <TrendChart points={trendPoints} label={chartLabel} />

      {data.by_club.length > 1 && (
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">By Club</p>
          <div className="space-y-2">
            {data.by_club.map(c => {
              const pct = data.total > 0 ? c.total / data.total : 0
              return (
                <div key={c.slug} className="flex items-center gap-3">
                  <div className="w-24 text-xs font-medium capitalize">{c.slug}</div>
                  <div className="flex-1 bg-bg rounded h-5 overflow-hidden">
                    <div className="h-full bg-wcs-red" style={{ width: `${(pct * 100).toFixed(1)}%` }} />
                  </div>
                  <div className="w-24 text-right text-xs font-semibold">{fmtMoney(c.total)}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="bg-surface rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Profit Center Breakdown</p>
          <button onClick={handleExportCsv} className="text-xs px-2 py-1 rounded border border-border hover:bg-bg">
            Export CSV
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-text-muted">
            <tr><th className="text-left py-2">Profit Center</th><th className="text-right">Total</th><th className="text-right">% of Total</th><th className="text-right">Δ vs Prior</th></tr>
          </thead>
          <tbody>
            {data.by_profit_center.map(p => {
              const priorPc = data.compare?.by_profit_center?.find(x => x.name === p.name)
              const isActive = p.name === activeProfitCenter
              return (
                <tr
                  key={p.name}
                  onClick={() => selectProfitCenter(p.name)}
                  className={`cursor-pointer border-t border-border ${isActive ? 'bg-wcs-red/5' : 'hover:bg-bg'}`}
                >
                  <td className="py-2">{p.name}</td>
                  <td className="text-right font-semibold">{fmtMoney(p.total)}</td>
                  <td className="text-right text-text-muted">{fmtPct(p.pct_of_total)}</td>
                  <td className="text-right"><DeltaChip current={p.total} prior={priorPc?.total} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Confirm the file lints / parses**

There's no separate lint step in this repo. Quickest check: run the portal dev server and visit any route (the file isn't wired into the router yet so it won't render, but its import must not blow up other reports).

```bash
cd portal && npm run dev
```

Expected: dev server starts, no "Cannot find module" / parse error in the terminal. Stop with Ctrl-C.

- [ ] **Step 3: Commit**

```bash
git add portal/src/components/reports/RevenueReport.jsx
git commit -m "feat(revenue): RevenueReport.jsx — cards + trend + club bars + PC table"
```

---

## Task 12: Wire RevenueReport into ReportingView

**Files:**
- Modify: `portal/src/components/ReportingView.jsx`

- [ ] **Step 1: Add import**

At the top of `ReportingView.jsx` next to the other `import ... from './reports/...'` lines, add:

```jsx
import RevenueReport from './reports/RevenueReport'
```

- [ ] **Step 2: Add icon path**

In the `REPORT_ICONS` object (near the top of the file), add:

```js
revenue: 'M2.25 18 9 11.25l4.306 4.307a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941',
```

- [ ] **Step 3: Add the tile entry**

In `ALL_REPORT_TILES`, append after the `payroll` entry:

```js
{ key: 'revenue', label: 'Revenue', desc: 'Dollars & Profit Centers' },
```

- [ ] **Step 4: Add to the `health` group**

In `REPORT_GROUPS`, find the `'health'` group's `reports` array. Replace:

```js
reports: ['club-health', 'membership', 'cancels', 'operations', 'checkins', 'payroll'],
```

with:

```js
reports: ['club-health', 'membership', 'cancels', 'operations', 'checkins', 'payroll', 'revenue'],
```

- [ ] **Step 5: Add to role-visibility lists**

In `getReportTilesForRole`, the `manager` case currently lists a set of keys. Append `'revenue'` to it (Justin's spec: manager+ only — NOT lead, NOT marketing). Replace:

```js
case 'manager':
  return ALL_REPORT_TILES.filter(t => ['membership', 'cancels', 'pt', 'club-health', 'pt-roster', 'checkins', 'pt-sessions', 'pt-new-clients', 'session-frequency', 'deactivated-pt', 'pt-health', 'payroll', 'operations'].includes(t.key))
```

with:

```js
case 'manager':
  return ALL_REPORT_TILES.filter(t => ['membership', 'cancels', 'pt', 'club-health', 'pt-roster', 'checkins', 'pt-sessions', 'pt-new-clients', 'session-frequency', 'deactivated-pt', 'pt-health', 'payroll', 'operations', 'revenue'].includes(t.key))
```

The `default` case (`corporate/admin`) already returns `ALL_REPORT_TILES`, so revenue is automatically visible there once it's in the array.

- [ ] **Step 6: Add the render-switch entry**

Inside the JSX, find the block of `{activeReport === '...' && <... />}` entries. Add (alongside `payroll`/`operations`):

```jsx
{activeReport === 'revenue' && (
  <RevenueReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
)}
```

- [ ] **Step 7: Manual smoke test in browser**

Start both servers (likely in separate panes):

```bash
# in auth/
npm run dev
# in portal/
npm run dev
```

In the Electron launcher (or the browser at `http://localhost:5173`):

1. Log in as a manager — confirm the Revenue tile appears inside Reporting → Club Health and is hidden for `lead`.
2. Open the Revenue tile — expect "Error: …" or empty cards (no data yet; tables are empty).
3. Change date range — confirm new fetch fires (Network tab).

This is a partial pass; full data check happens after Task 14.

- [ ] **Step 8: Commit**

```bash
git add portal/src/components/ReportingView.jsx
git commit -m "feat(revenue): register Revenue tile under Reporting -> Club Health"
```

---

## Task 13: Admin Backfill tile

**Files:**
- Create: `portal/src/components/admin/RevenueBackfillTile.jsx`
- Modify: the Admin Panel root that lists tiles (see Step 1)

- [ ] **Step 1: Locate the Admin Panel tile registry**

Find which component renders the Admin Panel tiles (Staff / Tiles / Roles / References / Sync Status). Search:

```bash
grep -rn "Sync Status" portal/src/components --include='*.jsx' | head -5
```

Open that file and identify the array/JSX that lists the tiles. Note the file path — you'll edit it in Step 4.

- [ ] **Step 2: Create the backfill tile component**

Create `portal/src/components/admin/RevenueBackfillTile.jsx`:

```jsx
import React, { useEffect, useState } from 'react'
import { uploadRevenueCsv, getRevenueImports } from '../../lib/api'

function fmtMoney(n) {
  if (n === null || n === undefined) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function RevenueBackfillTile() {
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [imports, setImports] = useState([])

  async function refreshImports() {
    try {
      const r = await getRevenueImports(20)
      setImports(r.rows || [])
    } catch (e) {
      // Non-fatal — just leave the table empty.
    }
  }

  useEffect(() => { refreshImports() }, [])

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setError(null)
    setResult(null)
    try {
      const r = await uploadRevenueCsv(file)
      setResult(r)
      setFile(null)
      await refreshImports()
    } catch (e) {
      setError(e.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const reconciled = result?.reconciled
  const drift = result ? Math.abs((result.computed_total || 0) - (result.reported_total || 0)) : 0

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <h3 className="text-base font-semibold text-text-primary mb-1">Revenue Backfill</h3>
      <p className="text-xs text-text-muted mb-4">
        Upload an ABC "Revenue by Profit Center" CSV. Window is reset for the period in the file, then rows are re-inserted.
      </p>

      <div className="border-2 border-dashed border-border rounded-lg p-6 text-center mb-3">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={e => { setFile(e.target.files?.[0] || null); setResult(null); setError(null) }}
          className="block mx-auto text-sm"
        />
        {file && <p className="text-xs text-text-muted mt-2">{file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</p>}
      </div>

      <button
        disabled={!file || uploading}
        onClick={handleUpload}
        className="w-full bg-wcs-red disabled:bg-gray-300 text-white py-2 rounded font-medium"
      >
        {uploading ? 'Uploading…' : 'Upload & Ingest'}
      </button>

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

      {result && (
        <div className={`mt-4 p-3 rounded ${reconciled ? 'bg-green-50 border border-green-300' : 'bg-yellow-50 border border-yellow-300'}`}>
          <p className="text-sm font-semibold">
            {reconciled ? 'Matches reported total' : `Drift ${fmtMoney(drift)}`}
          </p>
          <p className="text-xs text-text-muted mt-1">
            Period: {result.period_start} → {result.period_end} · Rows: {result.row_count} · Computed: {fmtMoney(result.computed_total)} · Reported: {fmtMoney(result.reported_total)}
          </p>
        </div>
      )}

      <div className="mt-6">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Recent Imports</p>
        <table className="w-full text-xs">
          <thead className="text-text-muted">
            <tr><th className="text-left py-1">When</th><th className="text-left">Source</th><th className="text-left">Period</th><th className="text-right">Rows</th><th className="text-right">Computed</th><th className="text-left">Status</th></tr>
          </thead>
          <tbody>
            {imports.map(r => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-1">{new Date(r.created_at).toLocaleString()}</td>
                <td>{r.source}</td>
                <td>{r.period_start}..{r.period_end}</td>
                <td className="text-right">{r.row_count}</td>
                <td className="text-right">{fmtMoney(r.computed_total)}</td>
                <td className={r.status === 'success' ? 'text-green-600' : r.status === 'failed' ? 'text-red-600' : 'text-yellow-600'}>{r.status}</td>
              </tr>
            ))}
            {imports.length === 0 && (
              <tr><td colSpan="6" className="py-4 text-center text-text-muted">No imports yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Mount the tile in the Admin Panel**

Open the file you identified in Step 1. Following the pattern used for other admin tiles (Staff / Tiles / Roles / References / Sync Status), import `RevenueBackfillTile` and render it as a new tile. The exact edit depends on the Admin Panel's structure — match the existing convention (`<AdminTile title="…">` wrapper or direct `<RevenueBackfillTile />` insertion).

If the Admin Panel uses a tile-card-then-section pattern (like the main Reporting tile), add a card labelled "Revenue Backfill" that, when clicked, renders `<RevenueBackfillTile />`.

- [ ] **Step 4: Manual smoke test**

In the portal:

1. Log in as admin.
2. Open Admin Panel → Revenue Backfill.
3. Upload the sample CSV (`C:\Users\justi\Downloads\Revenue by Profit Center.csv`).
4. Expect: green badge "Matches reported total", row_count ~9100, computed = `$262,386.78`.
5. Re-upload the same file — expect: same result, no duplicates in the database (verify in Supabase SQL Editor: `SELECT COUNT(*) FROM abc_revenue_transactions` should be unchanged after the second upload).
6. Open Reporting → Club Health → Revenue. With date range 2026-05-01 → 2026-05-12, expect Total Revenue = `$262,386.78` and profit center breakdown populated.

- [ ] **Step 5: Commit**

```bash
git add portal/src/components/admin/RevenueBackfillTile.jsx <admin-panel-file>
git commit -m "feat(revenue): admin backfill upload tile with reconciliation badge"
```

---

## Task 14: SendGrid Inbound Parse configuration + production deploy

**Files:** none in repo — operational config + Render env

- [ ] **Step 1: Add Render env vars**

In the Render dashboard for `wcs-auth-api`:

- `REVENUE_WEBHOOK_SECRET` = a fresh 32-char random string (generate with `openssl rand -hex 16`)

Note the value somewhere safe (1Password or vault).

- [ ] **Step 2: Configure SendGrid Inbound Parse**

In the SendGrid dashboard (the same one already wired for Operandio):

- Inbound Parse → Add Host & URL
- Receiving domain: `parse.wcstrength.com` (or whatever your existing parse subdomain is — match Operandio's)
- Subdomain: pick a fresh local part, e.g. `revenue@parse.wcstrength.com`
- Destination URL: `https://wcs-auth-api.onrender.com/revenue/webhook?secret=<REVENUE_WEBHOOK_SECRET value>`
- Check "POST the raw, full MIME message" → leave OFF (we want multipart parsing)

- [ ] **Step 3: Schedule the ABC daily export**

In ABC Financial back office:

- Schedule the "Revenue by Profit Center" report to run daily for "Yesterday" (single day range).
- Email recipient: `revenue@parse.wcstrength.com`.
- Format: CSV.

- [ ] **Step 4: Run an end-to-end test**

From a personal email, send a test message to `revenue@parse.wcstrength.com` with the sample CSV attached:

```bash
# (Or use the SendGrid Inbound Parse "test" feature if it has one)
```

Watch the Render logs for `wcs-auth-api`. Expected:

```
[revenue/webhook] stored 9136 rows for 2026-05-01..2026-05-12
```

Open Admin Panel → Revenue Backfill in the portal — the test send should appear in "Recent Imports" with `source = sendgrid_webhook`.

- [ ] **Step 5: Document the operational state**

There's no code change here — but note in the daily-driver checklist (or DEPLOY.md / runbook) that:

- ABC report schedule is set in ABC back office.
- SendGrid Inbound Parse hostname is `revenue@parse.wcstrength.com`.
- Re-keying the webhook secret means updating BOTH SendGrid's destination URL AND Render env.

No commit needed unless updating a runbook doc.

---

## Self-Review

Spec coverage check (each spec section ↔ task):

- §1 Goal — covered by tasks 1, 7, 11, 12
- §2 Sources & cadence — tasks 7 (webhook), 13 (admin upload), 14 (ops)
- §3 CSV format notes — task 5 (parseRevenueCsv with sample)
- §4 Club mapping — task 3 (CLUB_MAP) + task 5 (filter test)
- §5 Data model (tables + RPC) — task 1
- §6.1 Parser — tasks 3, 4, 5
- §6.2 Webhook handler — task 7
- §6.3 Ingest transaction — task 6
- §7 Read API — task 8
- §7 Role gate — task 8 step 1 (REPORT_ACCESS) + task 8 step 2 (resolveLocationFilter)
- §8.1 Tile placement — task 12
- §8.2 RevenueReport.jsx — task 11
- §8.3 Admin Backfill tile — task 13
- §9 Security & roles — tasks 7 (webhook secret), 8 (role gate), 14 (env)
- §10 Acceptance criteria:
  - Daily SendGrid → row count grows: tasks 7, 14
  - Re-sending is idempotent: task 6 (delete window) + task 13 step 4 (manual verify)
  - 12-day sample → reconciles to $262,386.78: task 5 + task 13 step 4
  - Manager sees only own club: task 8 (resolveLocationFilter)
  - Refund row negative: task 3 (parseMoney) + task 5 test
  - 5-year backfill: covered by task 6 chunked insert + task 7 200 MB multer cap; user may need to chunk by year for files > 200 MB (documented)
  - East Side under Milwaukie: task 3 + task 5 test
  - Unknown clubs skipped + drift reported: task 5 + task 6
- §11 Out of scope — respected (no Transaction Explorer, no PC grouping, no PT reconciliation)
- §12 Open questions — none blocking
- §13 Files to touch — all 5 new files + 5 modified files have tasks

Placeholder scan: no "TBD" / "implement later" / generic "add error handling" remain. Code blocks present for every code step.

Type consistency: `parseMoney` / `parseDate` / `parseHeaderMeta` / `parseRevenueCsv` consistent across tasks 3-5. `ingestParsedRevenue` signature in task 6 matches call sites in task 7. `getRevenueSummary` / `getRevenueProfitCenterTrend` / `getRevenueImports` / `uploadRevenueCsv` names match between task 10 (api.js) and tasks 11/13 (components).

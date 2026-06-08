# Operandio Audit PDF Backfill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-time backfill of the ~70–80 Operandio audit "Job Report" PDFs in `Downloads` into `operandio_qa_reports` (with the PDFs archived in Supabase Storage) so the portal's Audits report shows full audit history.

**Architecture:** A pure parser (`operandioAuditPdf.js`) turns extracted PDF text into a normalized audit record + scored `items[]`. A local one-time script globs Downloads, parses each PDF, dedupes, uploads the PDF to the `operandio-attachments` bucket, and upserts a row (`source='pdf_backfill'`) — never overwriting email-ingested rows. The existing HTML viewer renders the backfilled rows unchanged.

**Tech Stack:** Node.js (CommonJS), `@supabase/supabase-js` (service-role), `pdf-parse`, `node:test` for unit tests, Supabase MCP for the migration. Windows / PowerShell, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-08-operandio-audit-pdf-backfill-design.md`

**Working dir:** worktree `C:\Users\justi\wcs-staff-portal\.claude\worktrees\audit-pdf-backfill`, branch `feat/operandio-audit-pdf-backfill`. All paths below are relative to the worktree root unless absolute. All `node`/`pnpm` commands run from the `auth/` subdirectory unless stated.

---

## File Structure

- `auth/migrations/031_operandio_audit_pdf.sql` (new) — adds `pdf_path`, `source` columns.
- `auth/src/lib/operandioAuditPdf.js` (new) — pure parser `parseAuditPdfText(text) -> record | { ok:false, reason }`.
- `auth/src/lib/__fixtures__/*.txt` (new) — real `pdf-parse` text dumps used as test fixtures.
- `auth/src/lib/operandioAuditPdf.test.js` (new) — `node:test` unit tests.
- `auth/scripts/backfill-operandio-audit-pdfs.js` (new) — the one-time backfill runner.
- `auth/package.json` (modify) — add `pdf-parse` dependency.

---

## Task 1: Worktree setup — deps + env

No tests (environment setup). Gets the worktree runnable.

**Files:**
- Modify: `auth/package.json` (via pnpm)

- [ ] **Step 1: Install existing deps in the worktree**

Run (PowerShell, from worktree root):
```powershell
cd C:\Users\justi\wcs-staff-portal\.claude\worktrees\audit-pdf-backfill\auth
pnpm install
```
Expected: installs into `auth/node_modules` (pnpm store-linked, fast). Completes without error.

- [ ] **Step 2: Add the pdf-parse dependency**

Run:
```powershell
pnpm add pdf-parse
```
Expected: `auth/package.json` dependencies now include `pdf-parse`; lockfile updated.

- [ ] **Step 3: Copy the env file into the worktree (gitignored, not committed)**

The service-role creds live in the main checkout's `auth/.env`. Copy it so the script + scripts can reach Supabase:
```powershell
Copy-Item C:\Users\justi\wcs-staff-portal\auth\.env C:\Users\justi\wcs-staff-portal\.claude\worktrees\audit-pdf-backfill\auth\.env
```
Expected: `auth/.env` exists in the worktree. Confirm it has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`:
```powershell
Select-String -Path .\.env -Pattern 'SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY' | ForEach-Object { ($_ -split '=')[0] }
```
Expected output: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (names only).

- [ ] **Step 4: Commit the dependency change**

```powershell
cd C:\Users\justi\wcs-staff-portal\.claude\worktrees\audit-pdf-backfill
git add auth/package.json auth/pnpm-lock.yaml
git commit -m "chore: add pdf-parse to auth for audit PDF backfill"
```
(If `auth/pnpm-lock.yaml` doesn't exist because the repo uses a single root lockfile, `git add` only `auth/package.json` and any updated root `pnpm-lock.yaml`.)

---

## Task 2: Migration 031 — pdf_path + source columns

**Files:**
- Create: `auth/migrations/031_operandio_audit_pdf.sql`

- [ ] **Step 1: Write the migration file**

Create `auth/migrations/031_operandio_audit_pdf.sql`:
```sql
-- 031: Operandio audit PDF backfill support.
-- pdf_path  = storage object path in the operandio-attachments bucket (null for
--             email-ingested rows).
-- source    = provenance of the row: 'email' (the SendGrid webhook, default) or
--             'pdf_backfill' (the one-time Downloads backfill). Lets the
--             backfill be idempotent and never overwrite live email rows.
alter table operandio_qa_reports
  add column if not exists pdf_path text,
  add column if not exists source text not null default 'email';
```

- [ ] **Step 2: Apply the migration to prod via Supabase MCP**

Use the Supabase MCP `apply_migration` tool with `project_id: ybopxxydsuwlbwxiuzve`, `name: "031_operandio_audit_pdf"`, and the SQL above.
Expected: success, no error.

- [ ] **Step 3: Verify the columns exist**

Use Supabase MCP `execute_sql` with `project_id: ybopxxydsuwlbwxiuzve`:
```sql
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'operandio_qa_reports' and column_name in ('pdf_path','source')
order by column_name;
```
Expected: two rows — `pdf_path | text | null` and `source | text | 'email'::text`.

- [ ] **Step 4: Commit**

```powershell
git add auth/migrations/031_operandio_audit_pdf.sql
git commit -m "feat: migration 031 — pdf_path + source on operandio_qa_reports"
```

---

## Task 3: Capture real pdf-parse fixtures

The Read tool's PDF rendering is NOT necessarily what `pdf-parse` emits. Capture real `pdf-parse` text from known PDFs so the parser + tests are grounded in reality.

**Files:**
- Create (temporary): `auth/scripts/_probe-pdf.js`
- Create: `auth/src/lib/__fixtures__/mc-audit-springfield.txt`
- Create: `auth/src/lib/__fixtures__/pt-audit-clackamas.txt`
- Create: `auth/src/lib/__fixtures__/blank-template.txt`

- [ ] **Step 1: Write a throwaway probe script**

Create `auth/scripts/_probe-pdf.js`:
```js
// TEMPORARY: dump pdf-parse text for given PDF paths. Deleted in Task 7.
const fs = require('fs')
let pdf
try { pdf = require('pdf-parse') } catch { pdf = require('pdf-parse/lib/pdf-parse.js') }

async function main() {
  for (const p of process.argv.slice(2)) {
    const data = await pdf(fs.readFileSync(p))
    console.log('\n===== ' + p + ' =====')
    console.log(data.text)
    console.log('===== END (' + data.text.length + ' chars) =====')
  }
}
main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Run the probe against the two sample audits and one template**

Run (from `auth/`):
```powershell
node scripts/_probe-pdf.js "C:\Users\justi\Downloads\Springfield-MC Audit-May 2026.pdf" "C:\Users\justi\Downloads\pt_audit-69030d1ed725f5134e377daa-1762203622605.pdf" "C:\Users\justi\Downloads\WCS Audit Forms - Membership_Front Desk.pdf"
```
Expected: prints three text blocks. Read the output carefully — note exactly how the header line, `Submitted ... by <name>`, `Overall <a> <p> <pct>%`, and the scoring-by-section rows are spaced/broken across lines. This dictates the regexes in Task 4.

- [ ] **Step 3: Save the three outputs as fixture files**

Save each `===== ... =====` block's text (without the probe's own delimiter lines) into:
- `auth/src/lib/__fixtures__/mc-audit-springfield.txt`
- `auth/src/lib/__fixtures__/pt-audit-clackamas.txt`
- `auth/src/lib/__fixtures__/blank-template.txt`

(Use the Write tool with the captured text; do not hand-edit the content — it must be the verbatim pdf-parse output.)

- [ ] **Step 4: Commit the fixtures**

```powershell
cd C:\Users\justi\wcs-staff-portal\.claude\worktrees\audit-pdf-backfill
git add auth/src/lib/__fixtures__
git commit -m "test: capture real pdf-parse fixtures for audit parser"
```

---

## Task 4: Parser `operandioAuditPdf.js` (TDD)

**Files:**
- Create: `auth/src/lib/operandioAuditPdf.js`
- Test: `auth/src/lib/operandioAuditPdf.test.js`

> NOTE: The regexes below are written against the structure observed in the sample PDFs. After Step 1, if a test fails because `pdf-parse` spaced a field differently than expected, adjust the regex in `operandioAuditPdf.js` to match the **fixture** text (the fixture is ground truth) — do not change the fixtures.

- [ ] **Step 1: Write the failing test**

Create `auth/src/lib/operandioAuditPdf.test.js`:
```js
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { parseAuditPdfText } = require('./operandioAuditPdf')

const fx = name => fs.readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8')

test('parses the MC audit (Springfield)', () => {
  const r = parseAuditPdfText(fx('mc-audit-springfield.txt'))
  assert.equal(r.ok, true)
  assert.equal(r.locationSlug, 'springfield')
  assert.equal(r.department, 'Membership Coordinator Audit')
  assert.equal(r.jobName, 'Membership Coordinator Audit (Jun 2)')
  assert.equal(r.submittedDate, '2026-06-02')
  assert.equal(r.submittedBy, 'Steve Vedder')
  assert.equal(r.scoreAchieved, 54)
  assert.equal(r.scorePossible, 55)
  assert.equal(r.scorePct, 98)
  // 11 scored sections (the non-scored "Comments" row is excluded).
  assert.equal(r.items.length, 11)
  assert.equal(r.scorePossible % r.items.length, 0) // viewer per-item-max divides evenly
  assert.equal(r.items[0].name, 'GoHighLevel Ability')
  assert.equal(r.items[0].score, 5)
  assert.equal(r.items[0].by, 'Steve Vedder')
  assert.ok(r.items.every(it => typeof it.score === 'number' && it.name))
})

test('parses the PT audit (Clackamas), excludes non-scored Auditor Name row', () => {
  const r = parseAuditPdfText(fx('pt-audit-clackamas.txt'))
  assert.equal(r.ok, true)
  assert.equal(r.locationSlug, 'clackamas')
  assert.equal(r.department, 'PT Audit')
  assert.equal(r.submittedDate, '2025-10-31')
  assert.equal(r.scoreAchieved, 39)
  assert.equal(r.scorePossible, 40)
  assert.equal(r.scorePct, 98) // round(39/40*100)=98
  assert.equal(r.items.length, 8) // 9 steps minus the non-scored "Auditor Name:"
  assert.equal(r.scorePossible % r.items.length, 0)
  assert.ok(!r.items.some(it => /Auditor Name/i.test(it.name)))
})

test('rejects a blank template (not a submitted audit)', () => {
  const r = parseAuditPdfText(fx('blank-template.txt'))
  assert.equal(r.ok, false)
  assert.ok(r.reason)
})

test('rejects empty input', () => {
  const r = parseAuditPdfText('')
  assert.equal(r.ok, false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `auth/`):
```powershell
node --test src/lib/operandioAuditPdf.test.js
```
Expected: FAIL — `Cannot find module './operandioAuditPdf'` (or all assertions fail).

- [ ] **Step 3: Implement the parser**

Create `auth/src/lib/operandioAuditPdf.js`:
```js
// Pure parser: Operandio "Job Report" audit PDF text -> normalized record.
// Input is the text extracted by pdf-parse. Filenames are NOT used; the PDF
// body is authoritative. Produces the same shape the email pipeline writes to
// operandio_qa_reports (location_slug, job_name, department, score triple,
// items[{n,at,by,name,score}]) so the existing HTML viewer renders it.
//
// IMPORTANT: in the PDF the "Overall" row is "<achieved> <possible> <pct>%"
// (achieved first — opposite of the email "Overall score <possible> <achieved>"
// text). We parse achieved-first and sanity-check against the printed percent.

const { ALL_SLUGS } = require('../utils/locationSlug')

const MONTHS = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
}

// Department -> the auditKey()-style check used by the report's /audit/i filter
// and toggles. We only require the department to contain "audit".
function isAuditDept(dept) {
  return /audit/i.test(dept || '')
}

// "Jun 2, 2026" -> { iso: '2026-06-02', monthDay: 'Jun 2' }
function parseHeaderDate(s) {
  const m = (s || '').match(/([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/)
  if (!m) return null
  const mm = MONTHS[m[1]]
  if (!mm) return null
  return { iso: `${m[3]}-${mm}-${String(m[2]).padStart(2, '0')}`, monthDay: `${m[1]} ${m[2]}` }
}

function parseAuditPdfText(text) {
  if (!text || typeof text !== 'string') return { ok: false, reason: 'empty text' }

  // Must be an Operandio Job Report.
  if (!/Job Report/i.test(text)) return { ok: false, reason: 'not a Job Report' }

  // Header line: "<Department> | <Location> | Submitted <Mon D, YYYY>"
  const header = text.match(/\n\s*([^\n|]+?)\s*\|\s*([A-Za-z .'-]+?)\s*\|\s*Submitted\s+([A-Z][a-z]{2} \d{1,2}, \d{4})/)
  if (!header) return { ok: false, reason: 'no job-report header line' }

  // Department = first segment minus any parenthetical, e.g. "PT Audit (Monthly)" -> "PT Audit".
  const department = header[1].replace(/\s*\([^)]*\)\s*/g, ' ').trim()
  if (!isAuditDept(department)) return { ok: false, reason: `not an audit department: ${department}` }

  const locationSlug = header[2].trim().toLowerCase()
  if (!ALL_SLUGS.includes(locationSlug)) return { ok: false, reason: `unknown location: ${header[2].trim()}` }

  // Submitter + timestamp: "Submitted Jun 2, 2026, 11:36AM PDT by Steve Vedder"
  const sub = text.match(/Submitted\s+([A-Z][a-z]{2} \d{1,2}, \d{4}),?\s+(\d{1,2}:\d{2}\s*[AP]M)\s+([A-Z]{2,4})\s+by\s+([^\n]+)/)
  if (!sub) return { ok: false, reason: 'no "Submitted ... by <name>" line (likely a blank/unsubmitted template)' }
  const dt = parseHeaderDate(sub[1])
  if (!dt) return { ok: false, reason: 'unparseable submitted date' }
  const submittedBy = sub[4].trim()
  const tzOffset = sub[3] === 'PST' ? '-08:00' : '-07:00' // Pacific; PDT default
  const time24 = to24h(sub[2].replace(/\s+/g, ''))
  const submittedAt = `${dt.iso}T${time24}:00${tzOffset}`
  const atLabel = `${sub[1]}, ${sub[2].replace(/\s+/g, '')} ${sub[3]}` // "Jun 2, 2026, 11:36AM PDT"

  // Overall score row: "Overall 54 55 98.2%" (achieved possible pct).
  const overall = text.match(/Overall\s+(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)%/)
  if (!overall) return { ok: false, reason: 'no Overall score row' }
  let achieved = parseInt(overall[1], 10)
  let possible = parseInt(overall[2], 10)
  const printedPct = Math.round(parseFloat(overall[3]))
  // Guard against column-order surprises: prefer the orientation whose computed
  // percent matches the printed one.
  if (possible > 0 && Math.round((achieved / possible) * 100) !== printedPct &&
      achieved > 0 && Math.round((possible / achieved) * 100) === printedPct) {
    [achieved, possible] = [possible, achieved]
  }
  const scorePct = possible > 0 ? Math.round((achieved / possible) * 100) : printedPct

  // Scored section rows: "<name> <achieved> <possible> <pct>%". Non-scored rows
  // (Comments, Auditor Name:) print "-" and never match. Drop the Overall and
  // "This section" summary rows, and de-dup by name (the table appears once but
  // be safe).
  const rowRe = /([^\n]+?)\s+(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)%/g
  const seen = new Set()
  const items = []
  let m
  while ((m = rowRe.exec(text)) !== null) {
    const name = m[1].trim().replace(/^\d+\s+/, '') // strip any leading step number
    if (/^(Overall|This section|This job)$/i.test(name)) continue
    if (seen.has(name)) continue
    seen.add(name)
    items.push({ n: items.length + 1, at: atLabel, by: submittedBy, name, score: parseInt(m[2], 10) })
  }
  if (items.length === 0) return { ok: false, reason: 'no scored section rows' }

  return {
    ok: true,
    locationSlug,
    department,
    jobName: `${department} (${dt.monthDay})`,
    submittedDate: dt.iso,
    submittedAt,
    submittedBy,
    scoreAchieved: achieved,
    scorePossible: possible,
    scorePct,
    items,
  }
}

// "11:36AM" -> "11:36"; "1:05PM" -> "13:05"
function to24h(hhmm) {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})([AP]M)$/i)
  if (!m) return '00:00'
  let h = parseInt(m[1], 10)
  const min = m[2]
  const pm = /pm/i.test(m[3])
  if (pm && h !== 12) h += 12
  if (!pm && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${min}`
}

module.exports = { parseAuditPdfText }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `auth/`):
```powershell
node --test src/lib/operandioAuditPdf.test.js
```
Expected: PASS — 4/4 tests. If the two real-audit tests fail on `items.length` or a field, inspect the fixture text and adjust the regexes in `operandioAuditPdf.js` to match the fixture (NOT the other way around). Re-run until green.

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\justi\wcs-staff-portal\.claude\worktrees\audit-pdf-backfill
git add auth/src/lib/operandioAuditPdf.js auth/src/lib/operandioAuditPdf.test.js
git commit -m "feat: Operandio audit PDF text parser + tests"
```

---

## Task 5: Backfill script

**Files:**
- Create: `auth/scripts/backfill-operandio-audit-pdfs.js`

- [ ] **Step 1: Write the backfill script**

Create `auth/scripts/backfill-operandio-audit-pdfs.js`:
```js
// One-time backfill: parse Operandio audit "Job Report" PDFs from a folder
// (default: the user's Downloads), archive each to the operandio-attachments
// bucket, and upsert a row into operandio_qa_reports so the Audits report shows
// full history. The existing HTML viewer renders these rows via their items.
//
// Run from auth/:
//   node scripts/backfill-operandio-audit-pdfs.js --dry-run      (parse + print, write nothing)
//   node scripts/backfill-operandio-audit-pdfs.js                (do the backfill)
//   node scripts/backfill-operandio-audit-pdfs.js --dir="C:\path\to\folder"
//
// Idempotent + safe: rows are keyed (location_slug, job_name, submitted_date).
// A row that already exists from the email pipeline (source='email' or null) is
// NEVER overwritten; a prior 'pdf_backfill' row is updated. Re-running replaces
// the uploaded PDF (upsert) and corrects parsed data.
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const os = require('os')
const { createClient } = require('@supabase/supabase-js')
const { parseAuditPdfText } = require('../src/lib/operandioAuditPdf')

let pdfParse
try { pdfParse = require('pdf-parse') } catch { pdfParse = require('pdf-parse/lib/pdf-parse.js') }

const BUCKET = 'operandio-attachments'
const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const dirArg = args.find(a => a.startsWith('--dir='))
const DIR = dirArg ? dirArg.slice('--dir='.length).replace(/^"|"$/g, '') : path.join(os.homedir(), 'Downloads')

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

function deptSlug(dept) {
  return dept.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

// Cheap filename pre-filter so we don't pdf-parse the whole Downloads folder.
function isCandidate(name) {
  return /\.pdf$/i.test(name) && /audit/i.test(name)
}

async function main() {
  const files = fs.readdirSync(DIR).filter(isCandidate).map(f => path.join(DIR, f))
  console.log(`${DRY ? '[DRY-RUN] ' : ''}Scanning ${files.length} candidate PDF(s) in ${DIR}\n`)

  const parsed = []
  const skips = []
  for (const file of files) {
    try {
      const { text } = await pdfParse(fs.readFileSync(file))
      const r = parseAuditPdfText(text)
      if (!r.ok) { skips.push({ file: path.basename(file), reason: r.reason }); continue }
      if (r.scorePossible % r.items.length !== 0) {
        console.warn(`  WARN ${path.basename(file)}: ${r.scorePossible} not divisible by ${r.items.length} items (viewer will use /10 fallback)`)
      }
      parsed.push({ file, r })
    } catch (err) {
      skips.push({ file: path.basename(file), reason: 'pdf-parse error: ' + err.message })
    }
  }

  // Dedupe the two filename families by the natural key; keep the first.
  const byKey = new Map()
  for (const p of parsed) {
    const key = `${p.r.locationSlug}|${p.r.jobName}|${p.r.submittedDate}`
    if (!byKey.has(key)) byKey.set(key, p)
  }
  const unique = [...byKey.values()]

  console.log(`Parsed OK: ${parsed.length}  |  Unique rows: ${unique.length}  |  Skipped: ${skips.length}\n`)
  for (const u of unique.sort(sortRows)) {
    console.log(`  ${u.r.submittedDate}  ${u.r.locationSlug.padEnd(11)} ${u.r.department.padEnd(30)} ${u.r.scoreAchieved}/${u.r.scorePossible} (${u.r.scorePct}%)  items=${u.r.items.length}`)
  }
  if (skips.length) {
    console.log('\nSkipped:')
    for (const s of skips) console.log(`  - ${s.file} :: ${s.reason}`)
  }

  if (DRY) { console.log('\n[DRY-RUN] No writes performed.'); return }

  let inserted = 0, updated = 0, protectedSkips = 0, failed = 0
  for (const { file, r } of unique) {
    try {
      const { data: existing, error: selErr } = await sb
        .from('operandio_qa_reports')
        .select('id, source')
        .eq('location_slug', r.locationSlug)
        .eq('job_name', r.jobName)
        .eq('submitted_date', r.submittedDate)
        .maybeSingle()
      if (selErr) throw selErr
      if (existing && (existing.source === 'email' || existing.source == null)) {
        protectedSkips++
        console.log(`  PROTECT (email row exists) ${r.locationSlug} ${r.jobName}`)
        continue
      }

      // Archive the PDF (deterministic path; one PDF per club/dept/date).
      const storagePath = `audit-backfill/${r.locationSlug}/${deptSlug(r.department)}/${r.submittedDate}.pdf`
      const { error: upErr } = await sb.storage
        .from(BUCKET)
        .upload(storagePath, fs.readFileSync(file), { contentType: 'application/pdf', upsert: true })
      if (upErr) throw upErr

      const row = {
        location_slug: r.locationSlug,
        job_name: r.jobName,
        department: r.department,
        score_possible: r.scorePossible,
        score_achieved: r.scoreAchieved,
        score_pct: r.scorePct,
        report_url: null,
        items: r.items,
        raw_email_id: null,
        submitted_date: r.submittedDate,
        submitted_at: r.submittedAt,
        pdf_path: storagePath,
        source: 'pdf_backfill',
      }

      if (existing) {
        const { error } = await sb.from('operandio_qa_reports').update(row).eq('id', existing.id)
        if (error) throw error
        updated++
      } else {
        const { error } = await sb.from('operandio_qa_reports').insert(row)
        if (error) throw error
        inserted++
      }
      console.log(`  OK ${existing ? 'update' : 'insert'} ${r.locationSlug} ${r.jobName} (${r.scorePct}%)`)
    } catch (err) {
      failed++
      console.error(`  FAIL ${path.basename(file)} :: ${err.message}`)
    }
  }

  console.log(`\nDone. inserted=${inserted} updated=${updated} protected(email)=${protectedSkips} failed=${failed} skipped(parse)=${skips.length}`)
}

function sortRows(a, b) {
  return a.r.locationSlug.localeCompare(b.r.locationSlug) ||
    a.r.department.localeCompare(b.r.department) ||
    a.r.submittedDate.localeCompare(b.r.submittedDate)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Commit the script (still un-run)**

```powershell
cd C:\Users\justi\wcs-staff-portal\.claude\worktrees\audit-pdf-backfill
git add auth/scripts/backfill-operandio-audit-pdfs.js
git commit -m "feat: one-time Operandio audit PDF backfill script"
```

---

## Task 6: Dry-run, review, real run, verify

No code; this is the actual backfill + verification gate. **Stop and show the user the dry-run output before the real run.**

- [ ] **Step 1: Dry-run over Downloads**

Run (from `auth/`):
```powershell
node scripts/backfill-operandio-audit-pdfs.js --dry-run
```
Expected: a table of unique rows (club / department / score / item count) plus a Skipped list. Sanity-check: clubs are Salem/Keizer/Eugene/Springfield/Clackamas; departments are the five audits; scores look right; templates + `Ryan G PT Audit` appear under Skipped with a reason. **Show this output to the user and get a go-ahead.**

- [ ] **Step 2: Real run**

Run (from `auth/`):
```powershell
node scripts/backfill-operandio-audit-pdfs.js
```
Expected: `inserted=N updated=… protected(email)=… failed=0 skipped(parse)=…`. Investigate any `FAIL` lines.

- [ ] **Step 3: Verify rows in the database**

Use Supabase MCP `execute_sql` (`project_id: ybopxxydsuwlbwxiuzve`):
```sql
select location_slug, department, count(*) n, min(submitted_date) earliest,
       max(submitted_date) latest, round(avg(score_pct)) avg_pct
from operandio_qa_reports
where source = 'pdf_backfill'
group by location_slug, department
order by location_slug, department;
```
Expected: rows for each club/department present in Downloads, sensible date spans and averages.

- [ ] **Step 4: Verify the items render correctly for one row**

```sql
select location_slug, job_name, submitted_date, score_achieved, score_possible,
       score_pct, jsonb_array_length(items) items_len,
       (score_possible % jsonb_array_length(items)) remainder, pdf_path
from operandio_qa_reports
where source = 'pdf_backfill'
order by submitted_date desc limit 10;
```
Expected: `items_len > 0` and `remainder = 0` for every row (so the viewer's per-item-max math is exact). Any row with `remainder <> 0` should be investigated against its PDF.

- [ ] **Step 5: Spot-check storage upload**

Use Supabase MCP `execute_sql`:
```sql
select count(*) from storage.objects
where bucket_id = 'operandio-attachments' and name like 'audit-backfill/%';
```
Expected: equals inserted+updated from Step 2.

- [ ] **Step 6: Verify in the running portal (manual)**

Have the user open the portal Audits report (Reporting → Audits) for **Springfield** and **Clackamas**: confirm the audit departments list, the latest-% big number, the trend chart has multiple points, and "View Report" opens the branded HTML report with correct section scores. (No code change was needed here — this confirms the backfilled rows flow through the existing UI.)

---

## Task 7: Cleanup, PR

- [ ] **Step 1: Remove the temporary probe script**

```powershell
cd C:\Users\justi\wcs-staff-portal\.claude\worktrees\audit-pdf-backfill
Remove-Item auth/scripts/_probe-pdf.js
git add -A auth/scripts/_probe-pdf.js
git commit -m "chore: remove temporary pdf probe script"
```

- [ ] **Step 2: Confirm the full test suite still passes**

Run (from `auth/`):
```powershell
node --test src/lib/operandioAuditPdf.test.js
```
Expected: PASS.

- [ ] **Step 3: Push the branch**

```powershell
cd C:\Users\justi\wcs-staff-portal\.claude\worktrees\audit-pdf-backfill
git push -u origin feat/operandio-audit-pdf-backfill
```

- [ ] **Step 4: Open a PR (do NOT merge — Justin is the merger of record)**

```powershell
gh pr create --title "Operandio audit PDF backfill" --body @'
## What
One-time backfill of the Operandio audit Job Report PDFs from Downloads into `operandio_qa_reports`, so the Audits report shows full audit history. PDFs are archived in the `operandio-attachments` bucket.

## How
- Migration 031 adds `pdf_path` + `source` to `operandio_qa_reports`.
- `auth/src/lib/operandioAuditPdf.js` parses the (authoritative) PDF text into the same row shape the email pipeline writes, including scored `items[]` (non-scored steps excluded so the HTML viewer per-item-max math stays exact).
- `auth/scripts/backfill-operandio-audit-pdfs.js` globs Downloads, parses, dedupes the two filename families, archives each PDF, and upserts rows as `source='pdf_backfill'` — never overwriting email-ingested rows.

## Notes
- Frontend unchanged: backfilled rows render through the existing `buildQaReportHtml` viewer because they carry `items`.
- Migration 031 already applied to prod (ybopxxydsuwlbwxiuzve). Backfill already run by Justin/script.
- Tests: `node --test src/lib/operandioAuditPdf.test.js` (auth/).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
'@
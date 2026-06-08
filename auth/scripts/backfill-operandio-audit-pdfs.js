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
// Polyfill WebSocket for Node < 22 (Supabase Realtime constructor check fires at
// createClient() time even when Realtime is never used by this script).
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class WebSocket {
    constructor() { this.readyState = 3 }
    close() {} send() {} addEventListener() {} removeEventListener() {}
  }
}
const fs = require('fs')
const path = require('path')
const os = require('os')
const { createClient } = require('@supabase/supabase-js')
const { parseAuditPdfText } = require('../src/lib/operandioAuditPdf')
const { PDFParse } = require('pdf-parse') // v2 class API: new PDFParse({ data }).getText()

// Extract concatenated text from a PDF buffer using pdf-parse v2.
async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  try {
    const { text } = await parser.getText()
    return text
  } finally {
    await parser.destroy()
  }
}

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

function sortRows(a, b) {
  return a.r.locationSlug.localeCompare(b.r.locationSlug) ||
    a.r.department.localeCompare(b.r.department) ||
    a.r.submittedDate.localeCompare(b.r.submittedDate)
}

async function main() {
  const files = fs.readdirSync(DIR).filter(isCandidate).map(f => path.join(DIR, f))
  console.log(`${DRY ? '[DRY-RUN] ' : ''}Scanning ${files.length} candidate PDF(s) in ${DIR}\n`)

  const parsed = []
  const skips = []
  for (const file of files) {
    try {
      const text = await extractPdfText(fs.readFileSync(file))
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
  for (const u of unique.slice().sort(sortRows)) {
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

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })

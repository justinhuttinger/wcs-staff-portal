// Backfill: re-parse the per-item breakdown (incl. auditor notes) for QA reports
// that were ingested from the Operandio "audit submitted" email.
//
// Why: the original email parser dropped any item that carried a note (its regex
// didn't allow the extra note <div>), so noted items were missing entirely AND
// the note text was never captured. The fixed parser (../src/lib/operandioEmailAudit)
// keeps every item and transcribes the note. This re-reads each report's stored
// raw email HTML and rewrites only the `items` column.
//
// Run from auth/:
//   node scripts/reparse-operandio-email-items.js --dry-run   (print before/after, write nothing)
//   node scripts/reparse-operandio-email-items.js             (apply updates)
//
// Safe + idempotent: scores/dates are untouched, only `items` is rewritten from
// the source-of-truth email HTML. Re-running produces the same result.
require('dotenv').config()
// Polyfill WebSocket for Node < 22 (Supabase Realtime constructor check fires at
// createClient() time even when Realtime is never used by this script).
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class WebSocket {
    constructor() { this.readyState = 3 }
    close() {} send() {} addEventListener() {} removeEventListener() {}
  }
}
const { createClient } = require('@supabase/supabase-js')
const { parseQaItems } = require('../src/lib/operandioEmailAudit')

const DRY = process.argv.slice(2).includes('--dry-run')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const noteCount = items => (items || []).filter(i => i && i.note).length

async function main() {
  // Every report that came from an email has a raw_email_id pointing at the
  // stored HTML. PDF-backfilled rows have raw_email_id null and are skipped.
  const { data: reports, error } = await sb
    .from('operandio_qa_reports')
    .select('id, location_slug, job_name, submitted_date, raw_email_id, items')
    .not('raw_email_id', 'is', null)
    .order('submitted_date', { ascending: false })
  if (error) throw error

  console.log(`${DRY ? '[DRY-RUN] ' : ''}Re-parsing ${reports.length} email-sourced QA report(s)\n`)

  let updated = 0, unchanged = 0, missing = 0, failed = 0
  for (const r of reports) {
    try {
      const { data: raw, error: rawErr } = await sb
        .from('operandio_raw_emails')
        .select('body_html')
        .eq('id', r.raw_email_id)
        .maybeSingle()
      if (rawErr) throw rawErr
      if (!raw || !raw.body_html) {
        missing++
        console.log(`  MISSING raw email  ${r.location_slug} ${r.job_name}`)
        continue
      }

      const newItems = parseQaItems(raw.body_html)
      const before = (r.items || []).length
      const after = (newItems || []).length
      const notes = noteCount(newItems)
      const label = `${r.location_slug.padEnd(11)} ${String(r.job_name).padEnd(26)} items ${before} -> ${after}, notes ${notes}`

      if (after === 0) {
        // Don't blow away an existing breakdown if the re-parse finds nothing.
        unchanged++
        console.log(`  SKIP (parsed 0)    ${label}`)
        continue
      }

      if (DRY) {
        console.log(`  WOULD UPDATE       ${label}`)
        updated++
        continue
      }

      const { error: upErr } = await sb
        .from('operandio_qa_reports')
        .update({ items: newItems })
        .eq('id', r.id)
      if (upErr) throw upErr
      updated++
      console.log(`  OK                 ${label}`)
    } catch (err) {
      failed++
      console.error(`  FAIL ${r.location_slug} ${r.job_name} :: ${err.message}`)
    }
  }

  console.log(`\nDone. ${DRY ? 'would update' : 'updated'}=${updated} skipped=${unchanged} missing=${missing} failed=${failed}`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })

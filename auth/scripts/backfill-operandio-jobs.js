// Backfill operandio_job_events + operandio_task_completions from the raw
// emails already captured in operandio_raw_emails. Safe to re-run: events
// upsert on their natural key and task rows are replaced per event.
//
// Run after migration 030 is applied:
//   node scripts/backfill-operandio-jobs.js
//
// Marks each successfully-parsed raw email processed=true. Scored audits and
// daily summaries are left untouched (they are owned by other parsers).
require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
const { classifyJobEmail, persistJobEmail } = require('../src/lib/operandioJobs')

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  const { data, error } = await sb
    .from('operandio_raw_emails')
    .select('id, subject, body_text, body_html, received_at, processed')
    .order('received_at', { ascending: true })
    .limit(5000)
  if (error) throw error

  let submitted = 0, overdue = 0, skipped = 0, failed = 0
  for (const r of data) {
    const classified = classifyJobEmail({
      subject: r.subject, text: r.body_text, html: r.body_html, receivedAt: r.received_at,
    })
    if (!classified) { skipped++; continue }
    try {
      await persistJobEmail(sb, classified, r.id)
      if (classified.kind === 'submitted') submitted++; else overdue++
      if (!r.processed) await sb.from('operandio_raw_emails').update({ processed: true }).eq('id', r.id)
    } catch (err) {
      failed++
      console.error('FAIL', r.subject, '-', err.message)
    }
  }
  console.log(`Backfill complete. submitted=${submitted} overdue=${overdue} skipped(other shapes)=${skipped} failed=${failed}`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })

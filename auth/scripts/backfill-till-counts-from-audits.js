// Backfill: recover drawer counts that were misfiled as QA audits.
//
// Why: /operandio/webhook used to test the audit branch BEFORE the till branch.
// A drawer count email was only saved to till_counts because its body said
// "Overall score 0 0 %" (no points), which failed the audit gate. In Jul 2026 a
// scored step was added to the Drawer Close Count job in Operandio, so its
// emails began carrying a real "Overall score 1 1 100%". From then on every
// close count matched the audit branch and returned early: nothing reached
// till_counts, and the Till report showed no closing count even though staff
// completed the job. The webhook now runs the till branch first.
//
// The raw emails were retained (operandio_raw_emails.body_html), so the counts
// are fully recoverable. This script replays every raw email that classifies as
// a drawer count but never produced a till_counts row, and removes the bogus
// "Drawer * Count" rows from operandio_qa_reports (they are not audits and they
// pollute the Audits report + compliance KPI with a fake department).
//
// Run from auth/:
//   node scripts/backfill-till-counts-from-audits.js --dry-run   (print, write nothing)
//   node scripts/backfill-till-counts-from-audits.js             (apply)
//
// Idempotent: till_counts upserts on (club_number, business_date, count_type)
// and the qa_reports delete is scoped to drawer-count job names only. Emails are
// replayed oldest-first so a same-day re-submission lands last, matching what
// live ingestion would have done. No printing is triggered (historic data).
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
const { classifyTillCount } = require('../src/lib/tillCountParse')
const { SLUG_CLUB_MAP } = require('../src/utils/locationSlug')

const DRY = process.argv.slice(2).includes('--dry-run')
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  // Any retained email whose subject looks like a drawer count. Scanning by
  // subject (not by reason) also picks up anything that landed in the generic
  // job/raw buckets for the same reason.
  const { data: emails, error } = await sb
    .from('operandio_raw_emails')
    .select('id, subject, body_html, received_at, reason')
    .ilike('subject', '%Drawer%Count%')
    .order('received_at', { ascending: true })
  if (error) throw error

  console.log(`${DRY ? '[DRY-RUN] ' : ''}Scanning ${emails.length} retained drawer-count email(s)\n`)

  let inserted = 0, already = 0, unparsable = 0, unmapped = 0, failed = 0
  for (const e of emails) {
    try {
      const till = classifyTillCount({ subject: e.subject, html: e.body_html, receivedAt: e.received_at })
      if (!till) {
        unparsable++
        console.log(`  NO PARSE           ${e.subject}`)
        continue
      }
      const clubNumber = SLUG_CLUB_MAP[till.location_slug]
      if (!clubNumber) {
        unmapped++
        console.log(`  UNMAPPED LOCATION  ${till.location_slug} :: ${e.subject}`)
        continue
      }

      const label = `${till.location_slug.padEnd(11)} ${till.business_date} ${till.count_type.padEnd(5)} $${till.counted_amount} by ${till.employee_name || '?'}`

      // Skip rows that already ingested normally, so a re-run can't overwrite a
      // live-ingested count with a replay of an older duplicate email.
      const { data: existing, error: exErr } = await sb
        .from('till_counts')
        .select('id')
        .eq('club_number', clubNumber)
        .eq('business_date', till.business_date)
        .eq('count_type', till.count_type)
        .maybeSingle()
      if (exErr) throw exErr
      if (existing) {
        already++
        console.log(`  EXISTS             ${label}`)
        continue
      }

      if (DRY) {
        inserted++
        console.log(`  WOULD INSERT       ${label}`)
        continue
      }

      const { error: tcErr } = await sb.from('till_counts').upsert({
        club_number: clubNumber,
        location_slug: till.location_slug,
        business_date: till.business_date,
        count_type: till.count_type,
        counted_amount: till.counted_amount,
        denominations: till.denominations,
        employee_name: till.employee_name,
        counted_at: till.counted_at,
        raw_email_id: e.id,
      }, { onConflict: 'club_number,business_date,count_type' })
      if (tcErr) throw tcErr

      // Re-label the source email so the staging table reflects what it really
      // was. Cosmetic, and never fatal.
      if (e.reason !== 'till_count') {
        const { error: rErr } = await sb
          .from('operandio_raw_emails').update({ reason: 'till_count' }).eq('id', e.id)
        if (rErr) console.warn(`    (reason relabel failed: ${rErr.message})`)
      }

      inserted++
      console.log(`  OK                 ${label}`)
    } catch (err) {
      failed++
      console.error(`  FAIL ${e.subject} :: ${err.message}`)
    }
  }

  // Drawer counts are not audits. Remove the rows the audit branch created so
  // the Audits report and compliance KPI stop counting a "Drawer Close Count"
  // department that never existed.
  const { data: bogus, error: bErr } = await sb
    .from('operandio_qa_reports')
    .select('id, location_slug, job_name, submitted_date')
    .ilike('job_name', '%Drawer%Count%')
    .order('submitted_date', { ascending: true })
  if (bErr) throw bErr

  console.log(`\n${DRY ? '[DRY-RUN] ' : ''}${bogus.length} bogus QA audit row(s) from drawer counts`)
  if (bogus.length && !DRY) {
    const { error: delErr } = await sb
      .from('operandio_qa_reports')
      .delete()
      .in('id', bogus.map(b => b.id))
    if (delErr) throw delErr
    console.log(`  deleted ${bogus.length}`)
  } else {
    for (const b of bogus.slice(0, 10))
      console.log(`  ${DRY ? 'would delete' : 'kept'}: ${b.location_slug} ${b.submitted_date} ${b.job_name}`)
    if (bogus.length > 10) console.log(`  ... and ${bogus.length - 10} more`)
  }

  console.log(`\nDone. ${DRY ? 'would insert' : 'inserted'}=${inserted} existing=${already} no-parse=${unparsable} unmapped=${unmapped} failed=${failed}`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })

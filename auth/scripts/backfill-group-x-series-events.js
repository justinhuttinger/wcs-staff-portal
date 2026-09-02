// One-off backfill for migration 182.
//
// Links classes created before the link table existed, by shape-matching them
// to their series with exactly the same helper the live path uses.
//
// Idempotent: rows upsert on the primary key, so re-running links only what is
// still missing. Safe to run repeatedly, and safe to not run at all -- the
// runtime fallback in GET /classes infers the same links, just without a row.
//
// Usage:  node scripts/backfill-group-x-series-events.js [--apply]
// Without --apply it prints what it would insert and writes nothing.
require('dotenv').config()
const { supabaseAdmin } = require('../src/services/supabase')
const abc = require('../src/services/abcGroupX')
const { matchesSeries, seriesWindow } = require('../src/lib/groupXSeries')

const APPLY = process.argv.includes('--apply')

async function main() {
  const { data: series, error } = await supabaseAdmin
    .from('group_x_series')
    .select('*')
    .is('canceled_at', null)
  if (error) throw new Error(error.message)

  console.log(`${series.length} live series`)
  let total = 0

  for (const s of series) {
    const { start, end } = seriesWindow(s)
    if (!start || !end) {
      console.log(`  ${s.class_name} (${s.id}): no materialised window, skipping`)
      continue
    }
    const classes = await abc.listClasses(s.club_number, start, end)
    const rows = classes
      .filter(c => matchesSeries(c, s))
      .map(c => ({
        club_number: String(s.club_number),
        abc_event_id: String(c.event_id),
        series_id: s.id,
        event_date: String(c.event_timestamp_local).slice(0, 10),
      }))

    console.log(`  ${s.class_name} @ ${s.club_number} (${start}..${end}): ${rows.length} matched`)
    total += rows.length

    if (APPLY && rows.length) {
      const { error: upErr } = await supabaseAdmin
        .from('group_x_series_events')
        .upsert(rows, { onConflict: 'club_number,abc_event_id' })
      if (upErr) console.error(`    FAILED: ${upErr.message}`)
    }
  }

  console.log(APPLY ? `Linked ${total} classes.` : `Would link ${total} classes. Re-run with --apply.`)
}

main().catch(err => { console.error(err); process.exit(1) })

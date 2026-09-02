// One-off backfill for migration 182.
//
// Links classes created before the link table existed, by shape-matching them
// to their series with exactly the same helper the live path uses.
//
// Matching happens PER EVENT, not per series: for each club, every one of its
// live series is gathered up front, and findSeriesForEvent() -- the same
// function GET /classes uses -- decides which series (if any) a class
// belongs to. Looping series-by-series and upserting independently, like an
// earlier version of this script did, lets two identically-shaped series
// both match the same class; whichever series was processed last silently
// won the primary key. findSeriesForEvent() exists precisely to catch that
// case and report it as ambiguous instead of guessing, so this script must
// use it the same way the runtime does.
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
const { seriesWindow, findSeriesForEvent } = require('../src/lib/groupXSeries')

const APPLY = process.argv.includes('--apply')

async function main() {
  const { data: series, error } = await supabaseAdmin
    .from('group_x_series')
    .select('*')
    .is('canceled_at', null)
  if (error) throw new Error(error.message)

  console.log(`${series.length} live series`)

  // Group live series by club -- series are only ever matched against
  // classes from their own club -- and drop any series whose window can't be
  // resolved (same as the old per-series skip).
  const byClub = new Map()
  for (const s of series) {
    const { start, end } = seriesWindow(s)
    if (!start || !end) {
      console.log(`  ${s.class_name} (${s.id}): no materialised window, skipping`)
      continue
    }
    const club = String(s.club_number)
    if (!byClub.has(club)) byClub.set(club, [])
    byClub.get(club).push({ series: s, start, end })
  }

  let linked = 0
  let skippedAmbiguous = 0

  for (const [club, entries] of byClub) {
    const start = entries.reduce((min, e) => (e.start < min ? e.start : min), entries[0].start)
    const end = entries.reduce((max, e) => (e.end > max ? e.end : max), entries[0].end)
    const clubSeries = entries.map(e => e.series)

    let classes
    try {
      classes = await abc.listClasses(club, start, end)
    } catch (err) {
      // Resilience matches the old per-series behaviour: log and keep going
      // with the other clubs rather than losing the whole run.
      console.error(`  club ${club}: FAILED to list classes: ${err.message}`)
      continue
    }

    const rows = []
    let clubAmbiguous = 0
    for (const c of classes) {
      const result = findSeriesForEvent(c, clubSeries)
      if (!result) continue
      if (result.ambiguous) {
        clubAmbiguous++
        continue
      }
      rows.push({
        club_number: club,
        abc_event_id: String(c.event_id),
        series_id: result.series.id,
        event_date: String(c.event_timestamp_local).slice(0, 10),
      })
    }

    console.log(`  club ${club} (${start}..${end}): ${rows.length} linked, ${clubAmbiguous} skipped as ambiguous`)
    linked += rows.length
    skippedAmbiguous += clubAmbiguous

    if (APPLY && rows.length) {
      const { error: upErr } = await supabaseAdmin
        .from('group_x_series_events')
        .upsert(rows, { onConflict: 'club_number,abc_event_id' })
      if (upErr) console.error(`    FAILED: ${upErr.message}`)
    }
  }

  console.log(
    APPLY
      ? `Linked ${linked} classes, ${skippedAmbiguous} skipped as ambiguous.`
      : `Would link ${linked} classes, ${skippedAmbiguous} skipped as ambiguous. Re-run with --apply.`,
  )
}

main().catch(err => { console.error(err); process.exit(1) })

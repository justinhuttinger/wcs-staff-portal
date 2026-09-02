// Pure helpers for PUT /group-x/series/:id/from/:date (and its preview).
//
// No I/O — every decision about which ABC classes get touched by a
// series-forward edit is made from these functions, so it is worth testing
// hard, the same reasoning as groupXSeries.js's expandSeries/matchesSeries.
const { matchesSeries } = require('./groupXSeries')

// The route IS the access control: Supabase here is service-role with no
// RLS. A series loaded by id alone and edited from body fields would let
// anyone holding another club's series UUID move that club's schedule into
// their own -- the mistake already shipped once on the Courts & Pool side.
// A cancelled series is refused too: DELETE /series/:id never deletes the
// row, so "exists" alone is not enough.
function seriesBelongsToClub(series, clubNumber) {
  return !!series && !series.canceled_at && series.club_number === String(clubNumber)
}

// Which ABC classes this edit replaces, from `fromDate` onward.
//
// Two sources, in order of trust: `linkedRows` (group_x_series_events,
// migration 182) is authoritative for anything created since it landed;
// `abcEvents` (a raw ABC calendar window, filtered by matchesSeries) is the
// fallback for anything older or unlinked. De-duplicated by event id, linked
// rows winning on a collision.
function selectSeriesTargets({ series, fromDate, linkedRows, abcEvents }) {
  const byId = new Map()

  for (const r of linkedRows || []) {
    if (!r || !r.abc_event_id) continue
    if (String(r.event_date) < fromDate) continue
    byId.set(String(r.abc_event_id), String(r.event_date))
  }

  for (const e of abcEvents || []) {
    if (!e || !e.event_id) continue
    const id = String(e.event_id)
    if (byId.has(id)) continue // linked wins over inference
    if (!matchesSeries(e, series)) continue
    const date = String(e.event_timestamp_local || '').slice(0, 10)
    if (date < fromDate) continue
    byId.set(id, date)
  }

  return [...byId.entries()]
    .map(([event_id, date]) => ({ event_id, date }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.event_id.localeCompare(b.event_id))
}

// Reconciles the classes being replaced against the classes being created,
// matched by date. A date on both sides is a genuine edit of one occurrence
// (create the replacement, cancel the original -- applyClassEdit's ordering,
// reused as-is); a date only on the new side is a plain create (a weekday
// added to the series); a date only on the old side is a plain cancel (a
// weekday removed). Nothing is silently dropped either way.
function pairOccurrences(targets, occurrences) {
  const targetsByDate = new Map()
  for (const t of targets || []) {
    // Two old targets sharing a date should not happen in practice, but if
    // the calendar has drifted, only the first pairs -- the rest fall
    // through to cancelOnly rather than being silently ignored.
    if (!targetsByDate.has(t.date)) targetsByDate.set(t.date, t)
  }

  // Tracks the specific target object paired, not just its date -- with a
  // duplicate-date pair, excluding by date alone would drop both instead of
  // just the one that was actually used.
  const usedTargets = new Set()
  const paired = []
  const createOnly = []
  for (const occ of occurrences || []) {
    const t = targetsByDate.get(occ.date)
    if (t) {
      paired.push({ old: t, occ })
      usedTargets.add(t)
    } else {
      createOnly.push(occ)
    }
  }

  const cancelOnly = (targets || []).filter(t => !usedTargets.has(t))
  return { paired, createOnly, cancelOnly }
}

module.exports = { seriesBelongsToClub, selectSeriesTargets, pairOccurrences }

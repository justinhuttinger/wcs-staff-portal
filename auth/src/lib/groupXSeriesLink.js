// Turning a series fan-out result into link rows for group_x_series_events.
//
// Pure, so the "which creates actually produced a usable id" judgement is
// testable without touching ABC or Supabase.
const { supabaseAdmin } = require('../services/supabase')

function linkRows(clubNumber, seriesId, results) {
  return (results || [])
    // A create can report success without an id. Keying a row on undefined
    // would collide with every other such row on the primary key.
    .filter(r => r && r.ok && r.event_id)
    .map(r => ({
      club_number: String(clubNumber),
      abc_event_id: String(r.event_id),
      series_id: seriesId,
      event_date: r.date,
    }))
}

// Best-effort, exactly like badging: the classes exist in ABC either way, and
// failing the whole request over a missing link would be worse than a missing
// link, which the shape-match fallback covers anyway.
async function recordSeriesEvents(clubNumber, seriesId, results) {
  const rows = linkRows(clubNumber, seriesId, results)
  if (!rows.length) return null
  const { error } = await supabaseAdmin
    .from('group_x_series_events')
    .upsert(rows, { onConflict: 'club_number,abc_event_id' })
  if (error) {
    console.error('[groupX] could not link series events:', error.message)
    return error.message
  }
  return null
}

module.exports = { linkRows, recordSeriesEvents }

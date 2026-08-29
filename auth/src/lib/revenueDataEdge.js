// Where the revenue data actually stops.
//
// abc_revenue_transactions is IMPORTED, not live, and runs about a day behind.
// A month-to-date window that ends today therefore includes a day with no
// revenue in it, which drags every total and every comparison down by roughly
// one day's takings — silently, and worst on the 1st of a month when a single
// empty day is the whole window.
//
// So the reports clamp their window to the last day revenue exists for, AND SAY
// THAT THEY HAVE. Clamping quietly would be its own trap: a reader who picked
// "to today" and got a number for a shorter period has no way to know the
// number is not what they asked for.
//
// THE EDGE IS READ FROM THE DATA, NOT ASSUMED TO BE "YESTERDAY". The import can
// catch up or fall further behind, and hardcoding one day means a two-day lag
// produces the exact bug this exists to prevent.

const EDGE_TTL_MS = 5 * 60 * 1000

/**
 * The latest payment_date present, as YYYY-MM-DD, or null if the table is
 * empty. Cached briefly: every revenue report asks for it on every load and it
 * changes once a day.
 */
async function latestRevenueDay(supabaseAdmin, wrap) {
  return wrap('analytics:revenue-edge', EDGE_TTL_MS, async () => {
    const { data, error } = await supabaseAdmin
      .from('abc_revenue_transactions')
      .select('payment_date')
      .order('payment_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data?.payment_date ? String(data.payment_date).slice(0, 10) : null
  })
}

/**
 * Pull `end` back to the last day that has revenue.
 *
 * Only ever moves the END, and only ever backwards. Moving the start would
 * change which month the reader is looking at; extending the end would invent
 * data. If the whole window is already past the edge the window is left alone
 * and reported as having no data, rather than being silently rewritten into a
 * different period.
 */
function clampToRevenueEdge(start, end, edge) {
  if (!edge || !end || end <= edge) {
    return { start, end, clamped: false, edge, empty: false }
  }
  // The window begins after the last day of data: nothing to show, and pulling
  // `end` back to `edge` would produce end < start.
  if (start > edge) {
    return { start, end, clamped: false, edge, empty: true }
  }
  return { start, end: edge, clamped: true, edge, empty: false }
}

/** One sentence for the report, or null when the window needed no change. */
function edgeNote(clamp) {
  if (!clamp) return null
  if (clamp.empty) {
    return `Revenue is imported daily and currently runs to ${clamp.edge}. This window ` +
      'starts after that, so there is nothing to show yet.'
  }
  if (clamp.clamped) {
    return `Revenue is imported daily and currently runs to ${clamp.edge}, so this window ` +
      `ends there rather than at ${clamp.requestedEnd || 'today'}. Including the missing ` +
      'day would understate every total and every comparison.'
  }
  return null
}

module.exports = { latestRevenueDay, clampToRevenueEdge, edgeNote, EDGE_TTL_MS }

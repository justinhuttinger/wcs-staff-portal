/**
 * Revenue report gap detection.
 *
 * The Revenue report is fed by ABC's daily "Revenue by Profit Center" email,
 * which lands at POST /revenue/webhook (auth API) and writes one
 * abc_revenue_imports row per day. A *missed* email produces NO row at all
 * (only arrivals are logged), so a missing day is otherwise invisible and the
 * report silently under-reports until someone notices (see the 2026-06-04 gap).
 *
 * This job runs daily, finds any recent day with no successful import covering
 * it, and fires the same GHL alert webhook the ABC sync uses for error SMS.
 * sendAlert() dedupes identical messages within its cooldown, so a persistent
 * gap won't text every run.
 */

const { sendAlert } = require('../alerts')

const iso = (d) => d.toISOString().slice(0, 10)

function addDaysUTC(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}

/**
 * Pure: return the days in the inspection window that no import covers.
 *
 * Window = the `lookbackDays` days ending *yesterday*. Today is excluded
 * because its email is still in flight (it arrives the next morning).
 *
 * @param {Array<{period_start: string, period_end: string}>} coveredRanges
 *        Successful imports; each may span one day (daily email) or many (backfill).
 * @param {{today: string, lookbackDays: number}} opts  ISO 'YYYY-MM-DD' today.
 * @returns {string[]} missing days, ascending 'YYYY-MM-DD'.
 */
function findMissingRevenueDays(coveredRanges, { today, lookbackDays }) {
  const windowStart = addDaysUTC(today, -lookbackDays)
  const windowEnd = addDaysUTC(today, -1) // yesterday — exclude the in-flight day
  const missing = []
  for (let d = windowStart; d <= windowEnd; d = addDaysUTC(d, 1)) {
    const covered = coveredRanges.some((r) => r.period_start <= d && d <= r.period_end)
    if (!covered) missing.push(d)
  }
  return missing
}

const LOOKBACK_DAYS = parseInt(process.env.REVENUE_GAP_LOOKBACK_DAYS, 10) || 7

/**
 * Query recent successful imports, detect gaps, and alert on any found.
 */
async function checkRevenueGaps() {
  const supabase = require('../db/supabase')
  const today = iso(new Date())
  const windowStart = addDaysUTC(today, -LOOKBACK_DAYS)

  const { data, error } = await supabase
    .from('abc_revenue_imports')
    .select('period_start, period_end')
    .eq('status', 'success')
    .gte('period_end', windowStart)
  if (error) throw new Error(`revenue gap check query failed: ${error.message}`)

  const missing = findMissingRevenueDays(data || [], { today, lookbackDays: LOOKBACK_DAYS })
  if (missing.length === 0) {
    console.log(`[RevenueGapCheck] No gaps in last ${LOOKBACK_DAYS} day(s).`)
    return { missing: [] }
  }

  const days = missing.join(', ')
  console.warn(`[RevenueGapCheck] ${missing.length} missing day(s): ${days}`)
  await sendAlert(
    `Revenue report gap: no ABC revenue import for ${days}. ` +
      `Those day(s) are missing from the Revenue report — re-pull "Revenue by Profit Center" ` +
      `from ABC and upload via Admin > Revenue Backfill.`
  )
  return { missing }
}

module.exports = { findMissingRevenueDays, checkRevenueGaps }

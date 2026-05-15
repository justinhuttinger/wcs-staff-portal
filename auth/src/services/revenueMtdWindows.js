// Build N month windows ending at `endDate` (oldest first). Each window's
// period_end is the same day-of-month as endDate, capped to the last day of
// that month for shorter months. So a May 31 cutoff still produces sensible
// April / February buckets.
//
// Pure helper — kept out of the route file so tests can import it without
// pulling in express.
function buildMtdMonthWindows(endDate, n) {
  const pad = v => String(v).padStart(2, '0')
  const endD = new Date(endDate + 'T00:00:00Z')
  const cutoffDay = endD.getUTCDate()
  const months = []
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(endD.getUTCFullYear(), endD.getUTCMonth() - i, 1))
    const year = d.getUTCFullYear()
    const month = d.getUTCMonth() + 1
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const day = Math.min(cutoffDay, daysInMonth)
    months.push({
      month: `${year}-${pad(month)}`,
      period_start: `${year}-${pad(month)}-01`,
      period_end: `${year}-${pad(month)}-${pad(day)}`,
    })
  }
  return months.reverse() // oldest first so the chart reads left-to-right
}

module.exports = { buildMtdMonthWindows }

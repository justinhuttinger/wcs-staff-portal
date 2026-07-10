// Pure daily till reconciliation. All inputs are dollars (numbers); counts may
// be null when the Operandio submission is missing.
//
//   expectedClose = openingFloat + cashSales - cashRefunds - cashDrops
//   overShort     = countedClose - expectedClose
//   bagDrop       = countedClose - standardFloat   (cash pulled to deposit)
//   floatVariance = openingCount - standardFloat   (overnight drift; null if no AM count)
//
// When the AM count is missing we assume the drawer was left at par.
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

function reconcileDay({ standardFloat, openingCount, closingCount, cashSales = 0, cashRefunds = 0, cashDrops = 0 }) {
  const par = Number(standardFloat) || 0
  const hasOpen = openingCount != null
  const hasClose = closingCount != null
  const openingFloat = hasOpen ? Number(openingCount) : par
  const expectedClose = r2(openingFloat + Number(cashSales) - Number(cashRefunds) - Number(cashDrops))
  const countedClose = hasClose ? Number(closingCount) : null
  const overShort = hasClose ? r2(countedClose - expectedClose) : null
  const bagDrop = hasClose ? r2(countedClose - par) : null
  const floatVariance = hasOpen ? r2(openingFloat - par) : null

  let status = 'complete'
  if (!hasOpen && !hasClose) status = 'missing_both'
  else if (!hasOpen) status = 'missing_open'
  else if (!hasClose) status = 'missing_close'

  return { openingFloat, expectedClose, countedClose, overShort, bagDrop, floatVariance, status }
}

// Resolve the standard float in effect for a business date from a club's float
// history — an array of { effective_date: 'YYYY-MM-DD', standard_float }. Picks
// the row with the greatest effective_date <= businessDate (ISO date strings
// compare lexicographically). Falls back to `fallback` when history is empty or
// the date precedes every row.
function resolveFloatForDate(history, businessDate, fallback = 100) {
  let best = null
  for (const h of history || []) {
    const eff = String(h.effective_date).slice(0, 10)
    if (eff <= businessDate && (best === null || eff > best.eff)) {
      best = { eff, value: h.standard_float }
    }
  }
  return best ? Number(best.value) : Number(fallback)
}

module.exports = { reconcileDay, resolveFloatForDate }

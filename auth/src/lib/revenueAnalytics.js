// Pure shaping for Analytics > Revenue. No I/O; the route fetches.
//
// THREE WINDOWS OF THE SAME LENGTH: this period, the same span a month earlier,
// the same span a year earlier. Length matters — comparing 27 days of August
// against all 31 of July would report a 13% fall that is nothing but a shorter
// window, and month-to-date is the default view. The route cuts all three to
// the same number of days and this module never second-guesses it.
//
// EVERY PROFIT CENTER APPEARS. The eight that get managed lead; the rest follow
// individually rather than collapsing into "Other", because a report that hides
// $289,021 of guest fees behind one row is not a revenue report.
//
// A CENTER FOLDS ITS OWN SPELLINGS, NEVER TWO DIFFERENT PRODUCTS. Training
// folds a rename; Dues is DUES alone, with A2 Exec, First Month and Paid In Full
// dues each keeping their own row (migration 171). Folding two spellings of one
// thing is repair; folding two things is data loss.
//
// EACH ROW OPENS INTO THE RAW CENTERS BEHIND IT, because a reader has no way to
// check that mapping — or to notice a new code landing in the wrong place —
// unless the report shows its working.
//
// REFUNDS AND CHARGEBACKS ARE NEGATIVE CENTERS. They are not attributable to a
// category, so they are neither netted into one nor hidden. The totals say
// plainly whether they are included.

// Centers that reduce revenue rather than earning it. Surfaced separately so a
// total can be read either way round.
const NEGATIVE_CENTERS = new Set(['Refunds', 'Chargeback', 'Chargeback Repost', 'Balance Refunds', 'Prior System Chargeback', 'Return'])

function num(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function r2(v) {
  return Math.round(v * 100) / 100
}

/**
 * Percentage change, or null when there is no base to change from.
 *
 * Guarded on zero AND on sign: a category that went from -$500 to $500 has not
 * improved by 200%, and printing that would be worse than printing nothing.
 */
function pctChange(now, before) {
  if (before === null || before === undefined) return null
  if (before === 0) return null
  if (before < 0 || now < 0) return null
  return Math.round(((now - before) / before) * 1000) / 10
}

function indexRows(rows) {
  const byCategory = new Map()
  for (const r of rows || []) {
    const cat = r.category
    const cur = byCategory.get(cat) || {
      category: cat,
      headlinePosition: r.headline_position === null || r.headline_position === undefined
        ? null : num(r.headline_position),
      revenue: 0,
      txns: 0,
      centers: new Map(),
    }
    cur.revenue += num(r.revenue)
    cur.txns += num(r.txns)
    const c = cur.centers.get(r.profit_center) || { profitCenter: r.profit_center, revenue: 0, txns: 0 }
    c.revenue += num(r.revenue)
    c.txns += num(r.txns)
    cur.centers.set(r.profit_center, c)
    byCategory.set(cat, cur)
  }
  return byCategory
}

/**
 * @param current     analytics_revenue_by_center for the window
 * @param lastMonth   the same span a month earlier
 * @param lastYear    the same span a year earlier
 * @param opts        { monthly, byClub }
 */
function buildRevenue(current, lastMonth, lastYear, opts = {}) {
  const now = indexRows(current)
  const prevM = indexRows(lastMonth)
  const prevY = indexRows(lastYear)

  // Every category seen in ANY window. A category that earned last year and
  // nothing this year is the most interesting row on the report and must not
  // vanish because it has no current rows to iterate.
  const allCategories = new Set([...now.keys(), ...prevM.keys(), ...prevY.keys()])

  const rows = [...allCategories].map(cat => {
    const a = now.get(cat)
    const m = prevM.get(cat)
    const y = prevY.get(cat)
    const revenue = r2(a ? a.revenue : 0)
    const lastMonthRevenue = r2(m ? m.revenue : 0)
    const lastYearRevenue = r2(y ? y.revenue : 0)

    // The centers behind the category, so the mapping can be audited.
    const centerNames = new Set([
      ...(a ? a.centers.keys() : []),
      ...(m ? m.centers.keys() : []),
      ...(y ? y.centers.keys() : []),
    ])
    const centers = [...centerNames].map(name => ({
      profitCenter: name,
      revenue: r2(a && a.centers.get(name) ? a.centers.get(name).revenue : 0),
      lastMonthRevenue: r2(m && m.centers.get(name) ? m.centers.get(name).revenue : 0),
      lastYearRevenue: r2(y && y.centers.get(name) ? y.centers.get(name).revenue : 0),
    })).sort((x, z) => z.revenue - x.revenue)

    return {
      category: cat,
      headlinePosition: (a || m || y).headlinePosition,
      revenue,
      txns: a ? a.txns : 0,
      lastMonthRevenue,
      lastYearRevenue,
      momChange: pctChange(revenue, lastMonthRevenue),
      yoyChange: pctChange(revenue, lastYearRevenue),
      momDelta: r2(revenue - lastMonthRevenue),
      yoyDelta: r2(revenue - lastYearRevenue),
      negative: NEGATIVE_CENTERS.has(cat),
      centers,
    }
  })

  const headline = rows
    .filter(r => r.headlinePosition !== null)
    .sort((a, b) => a.headlinePosition - b.headlinePosition)

  const others = rows
    .filter(r => r.headlinePosition === null)
    .sort((a, b) => b.revenue - a.revenue)

  const sum = (list, key) => r2(list.reduce((acc, r) => acc + r[key], 0))

  // Gross excludes the negative centers; net includes them. Both are shown
  // because "revenue" means different things to different readers and a single
  // number would be quietly answering only one of them.
  const earning = rows.filter(r => !r.negative)
  const reducing = rows.filter(r => r.negative)

  const grossNow = sum(earning, 'revenue')
  const grossM = sum(earning, 'lastMonthRevenue')
  const grossY = sum(earning, 'lastYearRevenue')

  return {
    summary: {
      gross: grossNow,
      grossLastMonth: grossM,
      grossLastYear: grossY,
      grossMom: pctChange(grossNow, grossM),
      grossYoy: pctChange(grossNow, grossY),
      refunds: sum(reducing, 'revenue'),
      net: r2(grossNow + sum(reducing, 'revenue')),
      categories: rows.length,
    },
    headline,
    others,
    // Every center, ALPHABETICAL. This is a lookup table, not a ranking: the
    // Priority table above already answers "what is big", and someone reading
    // this one has a center in mind and wants to find it. Sorting by size means
    // hunting for a known name in a list of sixty whose order changes with the
    // date filter.
    all: [...rows].sort((a, b) => a.category.localeCompare(b.category)),
    notes: {
      totals:
        'Gross excludes refunds and chargebacks; net includes them. Both are shown ' +
        'because a single "revenue" figure would quietly answer only one of the two ' +
        'questions people ask.',
      mapping:
        'Profit centers have been renamed and respelled over time, so a center folds ' +
        'its own SPELLINGS before anything is compared — Training includes the Personal ' +
        'Training label Eugene used until September 2024. Different products are never ' +
        'folded together: Dues is DUES alone, and A2 Exec, First Month and Paid In Full ' +
        'dues each keep their own row. Open a center to see what is behind it.',
    },
  }
}

module.exports = { buildRevenue, pctChange, NEGATIVE_CENTERS }

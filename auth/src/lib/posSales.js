// Pure shaping for Analytics > POS Sales. No I/O; the route fetches.
//
// TWO STREAMS CROSS THE TILL AND THEY MUST NEVER BE BLENDED.
//
//   RETAIL        goods. Revenue, COGS, margin, units, products.
//   PASS-THROUGH  dues, personal training, guest fees, enrolment, club account
//                 payments. Money taken at the desk for something that is not a
//                 product. Revenue only; a margin is never computed on it.
//
// Only 10.9% of POS revenue carries a unit cost, because 89% of it is
// pass-through. Treating the missing costs as zero — the obvious
// implementation — reports a 92.7% gross margin against a true 33.5%. A 59
// point error that would have looked entirely plausible.
//
// MARGIN IS COMPUTED OVER COSTED REVENUE ONLY, AND SUPPRESSED WHEN COVERAGE IS
// TOO THIN. Six clubs cost 79-91% of their retail lines. Milwaukie costs 1.9%,
// so its "margin" would be derived from $55 of a $2,955 month — a number with
// no relationship to reality. Below the threshold the report shows the revenue
// and says the cost data is missing, rather than printing a figure.
//
// RETURNS ARE SPLIT BY STREAM. Clackamas returned $19,280 in August against
// $8,249 of retail. Almost all of it is reversed dues and account payments;
// actual product returns were $36. One combined figure printed beside retail
// would read as a catastrophic return rate on goods.

// Below this share of retail revenue carrying a cost, a margin is a guess.
const MIN_COST_COVERAGE_PCT = 50

function num(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round(v, dp = 1) {
  const f = 10 ** dp
  return Math.round(v * f) / f
}

function pct(part, whole) {
  if (!whole) return null
  return round((part / whole) * 100, 1)
}

/**
 * Margin, or null when there is not enough cost data to mean anything.
 *
 * Returns the coverage alongside so the caller can explain the absence rather
 * than showing an unexplained blank.
 */
function marginOf(costedRevenue, cogs, retailRevenue) {
  const coverage = pct(costedRevenue, retailRevenue)
  if (coverage === null || coverage < MIN_COST_COVERAGE_PCT) {
    return { marginPct: null, costCoverage: coverage, reliable: false }
  }
  return {
    marginPct: pct(costedRevenue - cogs, costedRevenue),
    costCoverage: coverage,
    reliable: true,
  }
}

function accum() {
  return {
    transactions: 0, retailRevenue: 0, retailCogs: 0, retailUnits: 0,
    retailCostedRevenue: 0, passthroughRevenue: 0, retailReturns: 0, passthroughReturns: 0,
  }
}

function add(acc, r) {
  acc.transactions += num(r.transactions)
  acc.retailRevenue += num(r.retail_revenue)
  acc.retailCogs += num(r.retail_cogs)
  acc.retailUnits += num(r.retail_units)
  acc.retailCostedRevenue += num(r.retail_costed_revenue)
  acc.passthroughRevenue += num(r.passthrough_revenue)
  acc.retailReturns += num(r.retail_returns)
  acc.passthroughReturns += num(r.passthrough_returns)
  return acc
}

function finish(acc, extra = {}) {
  const m = marginOf(acc.retailCostedRevenue, acc.retailCogs, acc.retailRevenue)
  return {
    ...extra,
    ...acc,
    retailRevenue: round(acc.retailRevenue, 2),
    retailCogs: round(acc.retailCogs, 2),
    passthroughRevenue: round(acc.passthroughRevenue, 2),
    retailReturns: round(acc.retailReturns, 2),
    passthroughReturns: round(acc.passthroughReturns, 2),
    grossProfit: m.reliable ? round(acc.retailCostedRevenue - acc.retailCogs, 2) : null,
    ...m,
  }
}

/**
 * @param monthly   analytics_pos_monthly rows
 * @param products  analytics_pos_products rows
 * @param centers   analytics_pos_centers rows
 * @param opts      { priorMonthly, trendMonthly }
 */
function buildPosSales(monthly, products, centers, opts = {}) {
  const rows = monthly || []

  const byClub = [...rows.reduce((m, r) => {
    m.set(r.slug, add(m.get(r.slug) || accum(), r))
    return m
  }, new Map())]
    .map(([slug, acc]) => finish(acc, { slug }))
    .sort((a, b) => b.retailRevenue - a.retailRevenue)

  const trendRows = opts.trendMonthly || rows
  const months = [...trendRows.reduce((m, r) => {
    const key = String(r.month).slice(0, 10)
    m.set(key, add(m.get(key) || accum(), r))
    return m
  }, new Map())]
    .map(([month, acc]) => finish(acc, { month }))
    .sort((a, b) => a.month.localeCompare(b.month))

  const total = finish(rows.reduce((acc, r) => add(acc, r), accum()))

  const prior = (opts.priorMonthly || []).reduce((acc, r) => add(acc, r), accum())
  const priorRetail = round(prior.retailRevenue, 2)

  // Products are retail only — a "top products" list containing DUES is not a
  // product list.
  const topProducts = (products || []).map(p => ({
    name: p.name,
    profitCenter: p.profit_center,
    units: num(p.units),
    revenue: round(num(p.revenue), 2),
    cogs: round(num(p.cogs), 2),
    costedRevenue: round(num(p.costed_revenue), 2),
    marginPct: p.margin_pct === null || p.margin_pct === undefined ? null : num(p.margin_pct),
  }))

  const profitCenters = (centers || []).map(c => ({
    profitCenter: c.profit_center,
    isRetail: !!c.is_retail,
    lines: num(c.lines),
    revenue: round(num(c.revenue), 2),
    cogs: round(num(c.cogs), 2),
    pctCosted: c.pct_costed === null || c.pct_costed === undefined ? null : num(c.pct_costed),
  }))

  // Named so the gap can be chased, not just noted.
  const lowCoverage = byClub.filter(c => c.retailRevenue > 0 && !c.reliable)

  return {
    summary: {
      retailRevenue: total.retailRevenue,
      passthroughRevenue: total.passthroughRevenue,
      totalRevenue: round(total.retailRevenue + total.passthroughRevenue, 2),
      grossProfit: total.grossProfit,
      marginPct: total.marginPct,
      costCoverage: total.costCoverage,
      retailUnits: total.retailUnits,
      transactions: total.transactions,
      retailReturns: total.retailReturns,
      passthroughReturns: total.passthroughReturns,
      priorRetailRevenue: priorRetail || null,
      retailChange: priorRetail ? pct(total.retailRevenue - priorRetail, priorRetail) : null,
    },
    byClub,
    months,
    topProducts,
    profitCenters,
    lowCoverage: lowCoverage.map(c => ({ slug: c.slug, costCoverage: c.costCoverage, retailRevenue: c.retailRevenue })),
    notes: {
      streams:
        'Retail is goods sold. Pass-through is dues, personal training, guest fees and ' +
        'account payments collected at the desk — money taken, but nothing sold, so no ' +
        'margin is computed on it.',
      coverage: lowCoverage.length === 0 ? null
        : `${lowCoverage.map(c => `${c.slug} (${c.costCoverage}% of retail lines costed)`).join(', ')} ` +
          `${lowCoverage.length === 1 ? 'has' : 'have'} too little cost data for a margin. ` +
          'Revenue is still accurate; the margin is left blank rather than guessed.',
    },
  }
}

module.exports = { buildPosSales, marginOf, MIN_COST_COVERAGE_PCT }

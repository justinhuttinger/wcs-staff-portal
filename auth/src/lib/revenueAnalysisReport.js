const { buildRevenue } = require('./revenueAnalytics')
const { monthToDate, windowLabel } = require('./snapshotWindow')
const { CLUBS } = require('./salespersonPerformance')
const { shiftedWindow, spanDays } = require('./comparisonWindow')
const { latestRevenueDay, clampToRevenueEdge, edgeNote } = require('./revenueDataEdge')

// Supabase, its cache and the paging helper are required lazily, inside the one
// function that uses them. Without that this module cannot be imported at all
// where the env is absent, and resolveWindow and trendStart - which are pure,
// and are where the window arithmetic that matters actually lives - would be
// untestable for no reason. Same pattern services/membershipSnapshot uses.

// ---------------------------------------------------------------------------
// Revenue analysis: every profit center against the same span a month ago and
// a year ago, grouped into the priority categories.
//
// WHY THIS IS A LIBRARY AND NOT A ROUTE. It was the body of GET
// /analytics/revenue, and it is now also what Reporting's Revenue report draws.
// Those two have different audiences and different club scoping, but they must
// never differ about what a month of Dues was — so the arithmetic lives here
// once and each route brings its own gate, its own scope and its own clubs.
//
// THE COMPARISON WINDOWS ARE THE SAME LENGTH, which is the whole game. A
// month-to-date view comparing 27 days of August against all 31 of July would
// report a 13% fall that is nothing but a shorter window. Both comparisons are
// cut to the same number of days as the window on screen, shifted by calendar
// month and calendar year and then clamped to that length — not by subtracting
// 30 or 365 days, because month lengths differ and leap years exist.
// ---------------------------------------------------------------------------

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000
const TREND_MONTHS = 25

const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))

function trendStart(endDate, months) {
  const d = new Date(`${endDate}T00:00:00Z`)
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - (months - 1))
  return d.toISOString().slice(0, 10)
}

/**
 * Resolve the requested window, defaulting to month to date.
 *
 * Returned rather than applied inside build() so a caller can report which
 * window it actually got — `anchoredOn` is the difference between "you asked
 * for this" and "nobody asked, so here is the month".
 */
function resolveWindow({ start, end }) {
  const mtd = monthToDate()
  const requestedStart = isDate(start) ? String(start) : mtd.start
  const requestedEnd = isDate(end) ? String(end) : mtd.end
  if (requestedStart > requestedEnd) {
    const err = new Error('start must not be after end')
    err.status = 400
    throw err
  }
  return { requestedStart, requestedEnd, anchoredOn: isDate(start) ? 'request' : 'month to date' }
}

/**
 * @param start  YYYY-MM-DD, or anything else for month to date
 * @param end    YYYY-MM-DD, or anything else for month to date
 * @param slugs  club slugs to include; every club means no club filter at all
 */
async function buildRevenueAnalysis({ start, end, slugs }) {
  const { supabaseAdmin } = require('../services/supabase')
  const { fetchAll } = require('./supabaseFetchAll')
  const { wrap, wrapSWR } = require('../services/memoryCache')

  const { requestedStart, requestedEnd, anchoredOn } = resolveWindow({ start, end })

  // Revenue is imported and runs about a day behind, so a month-to-date window
  // ending today carries an empty day that drags every total and every
  // comparison down. The window is pulled back to the last day with data — and
  // the report says so, because a number for a shorter period than the one
  // asked for is worse when it is silent.
  const edge = await latestRevenueDay(supabaseAdmin, wrap)
  const clamp = clampToRevenueEdge(requestedStart, requestedEnd, edge)
  clamp.requestedEnd = requestedEnd
  const start_ = clamp.start
  const end_ = clamp.end

  const clubs = slugs || CLUBS.map(c => c.slug)
  if (clubs.length === 0) {
    const err = new Error('no valid clubs requested')
    err.status = 400
    throw err
  }
  const allClubs = clubs.length === CLUBS.length
  const clubSlugs = allClubs ? null : clubs

  const lastMonth = shiftedWindow(start_, end_, { months: 1 })
  const lastYear = shiftedWindow(start_, end_, { years: 1 })
  const tStart = trendStart(end_, TREND_MONTHS)

  const cacheKey = ['analytics:revenue', start_, end_, clubs.slice().sort().join('+')].join('|')

  const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
    const [current, prevMonth, prevYear, monthly, byClub] = await Promise.all([
      fetchAll(supabaseAdmin.rpc('analytics_revenue_by_center', {
        p_start: start_, p_end: end_, p_clubs: clubSlugs,
      })),
      fetchAll(supabaseAdmin.rpc('analytics_revenue_by_center', {
        p_start: lastMonth.start, p_end: lastMonth.end, p_clubs: clubSlugs,
      })),
      fetchAll(supabaseAdmin.rpc('analytics_revenue_by_center', {
        p_start: lastYear.start, p_end: lastYear.end, p_clubs: clubSlugs,
      })),
      fetchAll(supabaseAdmin.rpc('analytics_revenue_monthly', {
        p_start: tStart, p_end: end_, p_clubs: clubSlugs,
      })),
      fetchAll(supabaseAdmin.rpc('analytics_revenue_by_club', {
        p_start: start_, p_end: end_, p_clubs: clubSlugs,
      })),
    ])
    return { current, prevMonth, prevYear, monthly, byClub }
  })

  const built = buildRevenue(payload.current, payload.prevMonth, payload.prevYear)

  // One series per headline category over the trend window. Non-headline
  // centers are left off the chart — 60-odd lines is not a chart — but they
  // are all present in the table below it.
  const months = [...new Set((payload.monthly || []).map(r => String(r.month).slice(0, 10)))].sort()
  const headlineNames = built.headline.map(h => h.category)
  const idx = new Map(
    (payload.monthly || []).map(r => [`${r.category}||${String(r.month).slice(0, 10)}`, r])
  )
  // Six months per category, for the row drill-down. Every category gets one,
  // not just the headline eight: the reason to open a small row is usually to
  // ask whether it is small and shrinking or small and growing.
  const RECENT = 6
  const recentMonths = months.slice(-RECENT)
  const sparkByCategory = {}
  for (const r of payload.monthly || []) {
    const m = String(r.month).slice(0, 10)
    if (!recentMonths.includes(m)) continue
    if (!sparkByCategory[r.category]) sparkByCategory[r.category] = {}
    sparkByCategory[r.category][m] = Math.round(Number(r.revenue) * 100) / 100
  }
  const sparklines = Object.fromEntries(
    Object.entries(sparkByCategory).map(([cat, byMonth]) => [
      cat,
      // A month with no revenue is a real zero here — the category existed and
      // took nothing — so it is emitted as 0 rather than left as a gap.
      recentMonths.map(m => ({ month: m, value: byMonth[m] ?? 0 })),
    ])
  )

  const trendSeries = headlineNames.map(name => ({
    key: name,
    label: name,
    points: months.map(month => {
      const row = idx.get(`${name}||${month}`)
      return { month, value: row ? Math.round(Number(row.revenue) * 100) / 100 : null }
    }),
  }))

  // Club totals, headline categories only, so the bars compare like with like.
  const clubTotals = new Map()
  for (const r of payload.byClub || []) {
    const cur = clubTotals.get(r.slug) || { slug: r.slug, revenue: 0 }
    cur.revenue += Number(r.revenue) || 0
    clubTotals.set(r.slug, cur)
  }

  return {
    ...built,
    trendMonths: months,
    trendSeries,
    recentMonths,
    sparklines,
    byClub: [...clubTotals.values()]
      .map(c => ({ ...c, revenue: Math.round(c.revenue * 100) / 100 }))
      .sort((a, b) => b.revenue - a.revenue),
    notes: { ...built.notes, dataEdge: edgeNote(clamp) },
    meta: {
      start: start_, end: end_,
      requestedEnd,
      revenueEdge: edge,
      clampedToEdge: clamp.clamped,
      noDataYet: clamp.empty,
      spanDays: spanDays(start_, end_),
      lastMonthStart: lastMonth.start, lastMonthEnd: lastMonth.end,
      lastYearStart: lastYear.start, lastYearEnd: lastYear.end,
      trendStart: tStart, trendMonths: TREND_MONTHS,
      windowLabel: windowLabel(start_, end_),
      clubs,
      anchoredOn,
    },
  }
}

module.exports = { buildRevenueAnalysis, trendStart, resolveWindow, TREND_MONTHS }

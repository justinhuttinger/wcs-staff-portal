const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { buildRevenue } = require('../lib/revenueAnalytics')
const { monthToDate, windowLabel } = require('../lib/snapshotWindow')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')
// Kept in their own module, free of this route's dependencies, so the window
// arithmetic can be tested without standing up Supabase.
const { shiftedWindow, spanDays } = require('../lib/comparisonWindow')

// ---------------------------------------------------------------------------
// Revenue — Analytics (admin only)
//
// Every profit centre, against the same span a month ago and a year ago.
// abc_revenue_transactions runs from January 2024 — 32 months, $17.9M, every
// club and every day present — so this is the one source in the rebuild that
// needed no caveat about its own completeness.
//
// THE COMPARISON WINDOWS ARE THE SAME LENGTH, which is the whole game. The
// default view is month-to-date, so comparing 27 days of August against all 31
// of July would report a 13% fall that is nothing but a shorter window. Both
// comparison windows are cut to the same number of days as the one on screen.
//
// SHIFTED BY CALENDAR MONTH AND CALENDAR YEAR, then clamped to that length —
// not by subtracting 30 or 365 days. Month lengths differ and leap years exist,
// and "the same span last year" means the same dates, not 365 days ago.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000
const TREND_MONTHS = 25

function trendStart(endDate, months) {
  const d = new Date(`${endDate}T00:00:00Z`)
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - (months - 1))
  return d.toISOString().slice(0, 10)
}

router.get('/', async (req, res) => {
  try {
    const mtd = monthToDate()
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
    const start = isDate(req.query.start) ? String(req.query.start) : mtd.start
    const end = isDate(req.query.end) ? String(req.query.end) : mtd.end
    if (start > end) return res.status(400).json({ error: 'start must not be after end' })

    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const allClubs = slugs.length === CLUBS.length
    const clubSlugs = allClubs ? null : slugs

    const lastMonth = shiftedWindow(start, end, { months: 1 })
    const lastYear = shiftedWindow(start, end, { years: 1 })
    const tStart = trendStart(end, TREND_MONTHS)

    const cacheKey = ['analytics:revenue', start, end, slugs.slice().sort().join('+')].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const [current, prevMonth, prevYear, monthly, byClub] = await Promise.all([
        fetchAll(supabaseAdmin.rpc('analytics_revenue_by_center', {
          p_start: start, p_end: end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_revenue_by_center', {
          p_start: lastMonth.start, p_end: lastMonth.end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_revenue_by_center', {
          p_start: lastYear.start, p_end: lastYear.end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_revenue_monthly', {
          p_start: tStart, p_end: end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_revenue_by_club', {
          p_start: start, p_end: end, p_clubs: clubSlugs,
        })),
      ])
      return { current, prevMonth, prevYear, monthly, byClub }
    })

    const built = buildRevenue(payload.current, payload.prevMonth, payload.prevYear)

    // One series per headline category over the trend window. Non-headline
    // centres are left off the chart — 60-odd lines is not a chart — but they
    // are all present in the table below it.
    const months = [...new Set((payload.monthly || []).map(r => String(r.month).slice(0, 10)))].sort()
    const headlineNames = built.headline.map(h => h.category)
    const idx = new Map(
      (payload.monthly || []).map(r => [`${r.category}||${String(r.month).slice(0, 10)}`, r])
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

    res.json({
      ...built,
      trendMonths: months,
      trendSeries,
      byClub: [...clubTotals.values()]
        .map(c => ({ ...c, revenue: Math.round(c.revenue * 100) / 100 }))
        .sort((a, b) => b.revenue - a.revenue),
      meta: {
        start, end,
        spanDays: spanDays(start, end),
        lastMonthStart: lastMonth.start, lastMonthEnd: lastMonth.end,
        lastYearStart: lastYear.start, lastYearEnd: lastYear.end,
        trendStart: tStart, trendMonths: TREND_MONTHS,
        windowLabel: windowLabel(start, end),
        clubs: slugs,
        anchoredOn: isDate(req.query.start) ? 'request' : 'month to date',
      },
    })
  } catch (err) {
    console.error('[analytics/revenue] error:', err.message)
    res.status(500).json({ error: 'Failed to build revenue' })
  }
})

module.exports = router

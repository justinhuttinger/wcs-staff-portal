const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { buildCheckins } = require('../lib/checkins')
const { monthToDate, priorMonthWindow, priorLabel, windowLabel } = require('../lib/snapshotWindow')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Check-ins — Analytics (admin only)
//
// VOLUME AND SHAPE COME FROM DIFFERENT TABLES. abc_member_checkin_months is
// complete and carries every total on this report; checkins_hourly has been
// missing about 40% of visits since May 2026 and is used ONLY for hour-of-day
// and weekday, as shares.
//
// The old Check-ins report drew volume from the hourly table and so reported
// check-ins down 43% since January when they were up — 77,080 in January
// against 86,230 in July. Migration 163 has the full comparison.
//
// The trend is a fixed TRAILING 13 MONTHS rather than the selected window. A
// month-to-date selection would otherwise draw a one-point line, and the
// question the chart answers ("are visits growing") is not a question about the
// filter bar.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000

const TREND_MONTHS = 13

/** First of the month, N months back from a YYYY-MM-DD date. */
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

    const prior = priorMonthWindow(start, end)
    const tStart = trendStart(end, TREND_MONTHS)

    const cacheKey = ['analytics:checkins', start, end, slugs.slice().sort().join('+')].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const [windowRows, priorRows, trendRows, hours, dow, coverage] = await Promise.all([
        fetchAll(supabaseAdmin.rpc('analytics_checkins_monthly', {
          p_start: start, p_end: end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_checkins_monthly', {
          p_start: prior.start, p_end: prior.end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_checkins_monthly', {
          p_start: tStart, p_end: end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_checkins_by_hour', {
          p_start: start, p_end: end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_checkins_by_dow', {
          p_start: start, p_end: end, p_clubs: clubSlugs,
        })),
        // Coverage spans the TREND window, not the selection: the point is to
        // show when the hourly feed started falling behind, which is in May and
        // therefore outside a month-to-date selection entirely.
        fetchAll(supabaseAdmin.rpc('analytics_checkins_coverage', {
          p_start: tStart, p_end: end,
        })),
      ])
      return { windowRows, priorRows, trendRows, hours, dow, coverage }
    })

    const built = buildCheckins(
      payload.windowRows, payload.hours, payload.dow, payload.coverage,
      { priorMonthly: payload.priorRows }
    )

    // The trend is shaped by the same builder so months/visits-per-member are
    // computed one way only, then lifted out.
    const trend = buildCheckins(payload.trendRows, [], [], []).months

    res.json({
      ...built,
      trend,
      meta: {
        start, end,
        priorStart: prior.start, priorEnd: prior.end,
        trendStart: tStart, trendMonths: TREND_MONTHS,
        windowLabel: windowLabel(start, end),
        comparisonLabel: priorLabel(start, end),
        clubs: slugs,
        anchoredOn: isDate(req.query.start) ? 'request' : 'month to date',
      },
    })
  } catch (err) {
    console.error('[analytics/checkins] error:', err.message)
    res.status(500).json({ error: 'Failed to build check-ins' })
  }
})

module.exports = router

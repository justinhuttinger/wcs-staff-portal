const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { getSkipList } = require('../utils/membershipSkipList')
const { buildReport } = require('../lib/salespersonPerformance')
const { loadSalespersonWindow } = require('../lib/salespersonData')
const { buildDailySnapshot } = require('../lib/dailySnapshot')
const { loadPendingDayOnes, summarisePending, pendingList } = require('../lib/dayOnePending')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Daily Snapshot — Analytics (corporate+)
//
// ONE DAY, AND ONLY EVER ONE DAY. The same card as Club Snapshot read as a
// morning agenda, compared against the day before rather than the month before.
//
// The day is the ONLY date input. There is no start/end pair, because a range
// is exactly what this report is not — accepting one would let a caller ask for
// a month and get a card whose every label said "day".
//
// Counts, rates and the training half come from the same three sources Club
// Snapshot uses, through the same shapeTotals, so a day here rolls up into the
// month there.
//
// REVENUE IS IMPORTED AND RUNS ABOUT TWO DAYS BEHIND. The route reports the
// latest day that actually has revenue so the card can say when its own figure
// is not in yet; otherwise a snapshot of today says the club took nothing.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate'))

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 30 * 60 * 1000

// Fourteen days: two full weeks, so a Monday sits under a Monday and the
// weekend shape is visible twice. The series function is a lateral over
// per-day window functions and costs about 2s at this width — see migration
// 172 before widening it.
const SERIES_DAYS = 14

const NO_FILTERS = {
  viewBy: 'salesperson',
  membershipType: null, entrySource: null, gender: null, ageGroup: null,
  paymentFrequency: null, term: null, relationship: null, exclusion: 'exclude',
}

function firstRow(res) {
  if (res.error) throw new Error(res.error.message)
  return (res.data || [])[0] || null
}

/** `back` days earlier on the calendar; one day by default. */
function previousDay(iso, back = 1) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

router.get('/', async (req, res) => {
  try {
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
    // Defaults to today in Pacific, which is the club's day rather than the
    // server's — a report opened at 6pm Pacific must not already be on
    // tomorrow's date.
    const todayPacific = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
    const day = isDate(req.query.day) ? String(req.query.day) : todayPacific

    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const allClubs = slugs.length === CLUBS.length
    const clubNumbers = slugs.map(s => CLUB_BY_SLUG[s].clubNumber)
    const rpcClubs = allClubs ? null : clubNumbers
    const yesterday = previousDay(day)

    const cacheKey = ['analytics:daily-snapshot', day, slugs.slice().sort().join('+')].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const skipList = await getSkipList()

      // Start and end are the SAME date. Everything downstream then treats the
      // day as a one-day window, which is what it is.
      const dayFor = async (d) => {
        const [w, sales, pt] = await Promise.all([
          supabaseAdmin.rpc('analytics_topline_window', {
            p_start: d, p_end: d, p_clubs: rpcClubs, p_exclude: true,
          }),
          loadSalespersonWindow(clubNumbers, slugs, d, d),
          supabaseAdmin.rpc('analytics_pt_snapshot', {
            p_start: d, p_end: d, p_clubs: rpcClubs,
          }),
        ])
        return {
          pt: firstRow(pt),
          window: { ...(firstRow(w) || {}), total_members: null },
          summary: buildReport(
            sales.members, sales.dayOnes, sales.contactsById, NO_FILTERS, skipList,
            { vips: sales.vips, tours: sales.tours }
          ).summary,
        }
      }

      // The chart's own window, so the fourteen-day pending line is built from
      // the same rows as the card rather than from fourteen separate calls.
      const seriesStart = previousDay(day, SERIES_DAYS - 1)

      const [current, prior, membersAtClose, series, revenueEdge, pendingRows] = await Promise.all([
        dayFor(day),
        dayFor(yesterday),
        supabaseAdmin.rpc('analytics_topline_members_as_of', {
          p_at: day, p_clubs: rpcClubs, p_exclude: true,
        }),
        fetchAll(supabaseAdmin.rpc('analytics_daily_series', {
          p_end: day, p_days: SERIES_DAYS, p_clubs: rpcClubs,
        })),
        // The latest day revenue actually exists for, so the card can say when
        // its own revenue is not in yet rather than printing a confident zero.
        supabaseAdmin
          .from('abc_revenue_transactions')
          .select('payment_date')
          .order('payment_date', { ascending: false })
          .limit(1)
          .maybeSingle(),
        loadPendingDayOnes(rpcClubs, seriesStart, day),
      ])

      if (membersAtClose.error) throw new Error(membersAtClose.error.message)
      current.window.total_members = membersAtClose.data

      // One fetch covers card, comparison and chart: the rows carry their own
      // scheduled_date, so the day slices come out of the same list.
      const forDay = d => (pendingRows || []).filter(r => String(r.scheduled_date).slice(0, 10) === d)
      const dayRows = forDay(day)

      return {
        current,
        prior,
        series,
        pending: {
          ...summarisePending(dayRows),
          priorTotal: forDay(yesterday).length,
          list: pendingList(dayRows),
        },
        pendingByDay: summarisePending(pendingRows).byDay,
        latestRevenueDay: revenueEdge?.data?.payment_date
          ? String(revenueEdge.data.payment_date).slice(0, 10)
          : null,
      }
    })

    const built = buildDailySnapshot(payload.current, payload.prior, payload.series, {
      day,
      latestRevenueDay: payload.latestRevenueDay,
      pending: payload.pending,
      pendingByDay: payload.pendingByDay,
    })

    res.json({
      ...built,
      meta: {
        day,
        priorDay: yesterday,
        seriesDays: SERIES_DAYS,
        clubs: slugs,
        today: todayPacific,
        anchoredOn: isDate(req.query.day) ? 'request' : 'today',
      },
    })
  } catch (err) {
    console.error('[analytics/daily-snapshot] error:', err.message)
    res.status(500).json({ error: 'Failed to build daily snapshot' })
  }
})

module.exports = router

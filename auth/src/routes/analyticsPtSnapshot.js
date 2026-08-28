const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { buildPtSnapshot } = require('../lib/ptSnapshot')
const { monthToDate, priorMonthWindow, priorLabel, windowLabel } = require('../lib/snapshotWindow')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// PT Snapshot — Analytics (admin only)
//
// The whole club's training in one card: the Day One funnel including why the
// ones that did not close did not close, what the ones that did close bought,
// and the new-against-lost balance in both clients and money.
//
// Every definition is in migration 148 rather than here, taken from PT Health,
// so the two reports cannot drift on what counts as a resign. The loss side is
// recurring-service deactivations only and says so on the card — burned
// paid-in-full packages need a per-member ABC call that PT Health can afford to
// make and a thirteen-month series cannot.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 30 * 60 * 1000
const SERIES_MONTHS = 13

/** One row, or null. rpc() returns an array even for a single-row function. */
function firstRow(res) {
  if (res.error) throw new Error(res.error.message)
  return (res.data || [])[0] || null
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
    const clubNumbers = allClubs ? null : slugs.map(s => CLUB_BY_SLUG[s].clubNumber)
    const prior = priorMonthWindow(start, end)

    const cacheKey = ['analytics:pt-snapshot', start, end, slugs.slice().sort().join('+')].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const args = { p_clubs: clubNumbers }
      const [current, priorRow, breakdown, series] = await Promise.all([
        supabaseAdmin.rpc('analytics_pt_snapshot', { p_start: start, p_end: end, ...args }),
        supabaseAdmin.rpc('analytics_pt_snapshot', { p_start: prior.start, p_end: prior.end, ...args }),
        // fetchAll rather than a bare rpc: PostgREST truncates at 1000 rows in
        // ORDER BY order without saying so, and a breakdown is many rows.
        fetchAll(supabaseAdmin.rpc('analytics_pt_snapshot_breakdown', { p_start: start, p_end: end, ...args })),
        fetchAll(supabaseAdmin.rpc('analytics_pt_monthly', { p_end: end, p_months: SERIES_MONTHS, ...args })),
      ])
      return {
        current: firstRow(current),
        prior: firstRow(priorRow),
        breakdown,
        series,
      }
    })

    const built = buildPtSnapshot(
      payload.current,
      payload.prior,
      payload.breakdown,
      payload.series,
      { comparisonLabel: priorLabel(start, end) },
    )

    res.json({
      ...built,
      meta: {
        start, end,
        priorStart: prior.start, priorEnd: prior.end,
        windowLabel: windowLabel(start, end),
        comparisonLabel: priorLabel(start, end),
        clubs: slugs,
        seriesMonths: SERIES_MONTHS,
        anchoredOn: isDate(req.query.start) ? 'request' : 'month to date',
      },
    })
  } catch (err) {
    console.error('[analytics/pt-snapshot] error:', err.message)
    res.status(500).json({ error: 'Failed to build PT snapshot' })
  }
})

module.exports = router

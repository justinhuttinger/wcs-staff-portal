const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { buildTill } = require('../lib/tillAnalytics')
const { monthToDate, priorLabel, windowLabel } = require('../lib/snapshotWindow')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Till — Analytics (corporate+)
//
// THE OVER/SHORT ARITHMETIC IS NOT REDEFINED. reconcileDay() in
// tillReconcile.js remains the one definition of expected close and over/short;
// this route feeds it and aggregates the result. Two definitions of "short" is
// how a reconciliation report loses the trust it exists to earn.
//
// The cash side comes from analytics_till_cash_by_day (migration 166), which
// does in one query what tillCashMovements.js does in many round trips — it
// batches line-UPC lookups 200 transactions at a time because
// inventory_transaction_payments has no embeddable FK to the items table. Fine
// for one club and one day; not for seven clubs across a window.
//
// CASH DROPS ARE ALL BUT UNUSED. Exactly one line in the whole table carries
// the configured sentinel. Every other DROP-ish UPC is childcare drop-in, which
// is a product; matching loosely on '%DROP%' would classify $1,516 of childcare
// revenue as cash pulled from the drawer.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate'))

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000

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

    const cacheKey = ['analytics:till', start, end, slugs.slice().sort().join('+')].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const [cash, counts, settings, floatHistory] = await Promise.all([
        fetchAll(supabaseAdmin.rpc('analytics_till_cash_by_day', {
          p_start: start, p_end: end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_till_counts', {
          p_start: start, p_end: end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.from('till_settings').select('club_number, standard_float, drop_upc')),
        // The whole history, not the window: the float in effect on a given day
        // may have been set months earlier, and resolveFloatForDate needs the
        // row that precedes the date.
        fetchAll(supabaseAdmin.from('till_float_history').select('club_number, effective_date, standard_float')),
      ])
      return { cash, counts, settings, floatHistory }
    })

    const built = buildTill(payload.cash, payload.counts, {
      settings: payload.settings,
      floatHistory: payload.floatHistory,
      clubs: slugs,
    })

    res.json({
      ...built,
      meta: {
        start, end,
        windowLabel: windowLabel(start, end),
        comparisonLabel: priorLabel(start, end),
        clubs: slugs,
        anchoredOn: isDate(req.query.start) ? 'request' : 'month to date',
      },
    })
  } catch (err) {
    console.error('[analytics/till] error:', err.message)
    res.status(500).json({ error: 'Failed to build till' })
  }
})

module.exports = router

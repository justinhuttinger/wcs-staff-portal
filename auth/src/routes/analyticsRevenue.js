const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')
const { buildRevenueAnalysis } = require('../lib/revenueAnalysisReport')

// ---------------------------------------------------------------------------
// Revenue — Analytics (corporate+)
//
// Every profit center, against the same span a month ago and a year ago.
// abc_revenue_transactions runs from January 2024 — 32 months, $17.9M, every
// club and every day present — so this is the one source in the rebuild that
// needed no caveat about its own completeness.
//
// The arithmetic moved to lib/revenueAnalysisReport when Reporting's Revenue
// report started drawing the same tables. What is left here is this report's
// gate and its club handling: corporate and above, any club they ask for.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate'))

router.get('/', async (req, res) => {
  try {
    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    res.json(await buildRevenueAnalysis({
      start: req.query.start, end: req.query.end, slugs,
    }))
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    console.error('[analytics/revenue] error:', err.message)
    res.status(500).json({ error: 'Failed to build revenue' })
  }
})

module.exports = router

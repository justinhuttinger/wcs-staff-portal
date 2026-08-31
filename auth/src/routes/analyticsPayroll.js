const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { buildPayroll } = require('../lib/payrollAnalytics')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Payroll — Analytics (admin only)
//
// Commission per person for one PERIOD, from the two sources that pay it.
// Deliberately plain: this is a document somebody reconciles against a payroll
// run, and every extra number on it is one more thing to have to explain.
//
// THE PERIOD IS A MONTH, NOT A DATE RANGE. Commission is calculated and paid
// per period, and a window that straddled two would produce a figure nobody
// pays anyone. The shell's date range is ignored; the report picks from the
// periods that actually exist.
//
// Migration 174 carries the join, and the double-space discovery that makes it
// work at all.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 30 * 60 * 1000

router.get('/', async (req, res) => {
  try {
    const isPeriod = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))

    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const allClubs = slugs.length === CLUBS.length
    const clubSlugs = allClubs ? null : slugs

    // The list of periods is cheap and shared by every request, so it is
    // resolved before the per-period cache key can be built.
    const periods = await wrapSWR('analytics:payroll-periods', FRESH_MS, STALE_MS, () =>
      fetchAll(supabaseAdmin.rpc('analytics_payroll_periods', {})))

    const latest = periods && periods[0] ? String(periods[0].period).slice(0, 10) : null
    const period = isPeriod(req.query.period) ? String(req.query.period) : latest

    if (!period) {
      return res.json({
        period: null, periods: [], summary: { people: 0, sales: 0, recurring: 0, total: 0 },
        people: [], byClub: [], shared: [], notes: {},
        meta: { clubs: slugs },
      })
    }

    const cacheKey = ['analytics:payroll', period, slugs.slice().sort().join('+')].join('|')

    const rows = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, () =>
      fetchAll(supabaseAdmin.rpc('analytics_payroll', {
        p_period: period, p_clubs: clubSlugs,
      })))

    const built = buildPayroll(rows, periods, { period })

    res.json({
      ...built,
      meta: {
        period,
        clubs: slugs,
        anchoredOn: isPeriod(req.query.period) ? 'request' : 'latest period',
      },
    })
  } catch (err) {
    console.error('[analytics/payroll] error:', err.message)
    res.status(500).json({ error: 'Failed to build payroll' })
  }
})

module.exports = router

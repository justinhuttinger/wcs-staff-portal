const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { buildGroupX } = require('../lib/groupXAnalytics')
const { monthToDate, windowLabel } = require('../lib/snapshotWindow')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Group X — Analytics (corporate+)
//
// Attendance per class, hour, weekday, month, instructor and club, against the
// schedule those classes were meant to run to.
//
// BUILT BEFORE THE DATA. Headcount capture starts now and one class has ever
// been counted, so the coverage half — how many scheduled classes actually got
// a headcount — is what this report is for until the attendance half fills in.
//
// Both halves are fetched per row rather than pre-aggregated: a month is a few
// hundred classes at most, and aggregating in one place means a new dimension
// costs no SQL. Migration 173 holds the two source functions.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate'))

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 30 * 60 * 1000

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

    const cacheKey = ['analytics:group-x', start, end, slugs.slice().sort().join('+')].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const [attendance, scheduled] = await Promise.all([
        fetchAll(supabaseAdmin.rpc('analytics_groupx_attendance', {
          p_start: start, p_end: end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_groupx_scheduled', {
          p_start: start, p_end: end, p_clubs: clubSlugs,
        })),
      ])
      return { attendance, scheduled }
    })

    const built = buildGroupX(payload.attendance, payload.scheduled)

    res.json({
      ...built,
      meta: {
        start, end,
        windowLabel: windowLabel(start, end),
        clubs: slugs,
        anchoredOn: isDate(req.query.start) ? 'request' : 'month to date',
      },
    })
  } catch (err) {
    console.error('[analytics/group-x] error:', err.message)
    res.status(500).json({ error: 'Failed to build Group X' })
  }
})

module.exports = router

const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { wrapSWR } = require('../services/memoryCache')
const { buildScorecard, GOAL_KEYS, DEFAULT_GOAL_PCT } = require('../lib/ptScorecard')
const { CLUBS, CLUB_BY_SLUG, clubName } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// PT Scorecard — Analytics (admin only)
//
// The Day One funnel and PT money, per club, for a date window.
//
//   Book   Day Ones booked in the window
//   Set    appointments scheduled from the window start; to-date stops at
//          today so Show % is not diluted by appointments yet to happen
//   Show   status = completed
//   Close  completed with a Sale outcome
//
// Goals are query parameters rather than stored: three numbers that the reader
// moves while looking at the table. Persisting them would need a settings
// table and an owner, and nobody has asked for one goal per club yet.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

// Short: the goals move on every slider drag, and each combination is its own
// cache key, so a long TTL would pile up entries for settings nobody keeps.
const FRESH_MS = 2 * 60 * 1000
const STALE_MS = 15 * 60 * 1000

function monthToDate(today = new Date()) {
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  return { start: start.toISOString().slice(0, 10), end: today.toISOString().slice(0, 10) }
}

router.get('/', async (req, res) => {
  try {
    const mtd = monthToDate()
    const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
    const start = isDate(req.query.start) ? String(req.query.start) : mtd.start
    const end = isDate(req.query.end) ? String(req.query.end) : mtd.end
    if (start > end) return res.status(400).json({ error: 'start must not be after end' })

    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const exclude = req.query.exclusion !== 'include'
    const allClubs = slugs.length === CLUBS.length

    const goals = {}
    for (const key of GOAL_KEYS) {
      goals[key] = req.query[`${key}Goal`] !== undefined ? req.query[`${key}Goal`] : DEFAULT_GOAL_PCT
    }

    // Only the query shape is cached — the goals are applied afterwards, so
    // moving a slider re-derives from cached counts instead of re-querying.
    const cacheKey = ['analytics:pt-scorecard', start, end, slugs.slice().sort().join('+'), exclude].join('|')

    const rows = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const { data, error } = await supabaseAdmin.rpc('analytics_pt_scorecard', {
        p_start: start,
        p_end: end,
        p_clubs: allClubs ? null : slugs.map(s => CLUB_BY_SLUG[s].clubNumber),
        p_exclude: exclude,
      })
      if (error) throw new Error(error.message)
      return data || []
    })

    const built = buildScorecard(rows, {
      goals,
      clubNameFor: (n) => clubName(n),
    })

    res.json({
      ...built,
      meta: {
        start,
        end,
        clubs: slugs,
        exclusion: exclude ? 'exclude' : 'include',
        definitions: {
          book: 'Day Ones booked during the window.',
          set: 'Appointments scheduled from the window start. To-date stops at today; including future adds the ones still ahead, so it is always the larger of the two.',
          show: 'A set appointment marked completed.',
          close: 'A completed appointment whose outcome was a Sale.',
          goals: 'Each goal applies to the same denominator as its rate: Book against new members, Show against sets to date, Close against shows.',
          money: 'EFT draft figures are the monthly draft (ABC invoiceTotal on a recurring service). PT revenue is net of refunds and excludes PT CONSULT and INBODY SCAN, which are not training.',
        },
      },
    })
  } catch (err) {
    console.error('[analytics/pt-scorecard] error:', err.message)
    res.status(500).json({ error: 'Failed to build PT scorecard' })
  }
})

module.exports = router

const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { wrapSWR } = require('../services/memoryCache')
const { buildScorecard, GOAL_KEYS, DEFAULT_GOAL_PCT } = require('../lib/ptScorecard')
const { loadPendingDayOnes, summarisePending, pendingList } = require('../lib/dayOnePending')
const { CLUBS, CLUB_BY_SLUG, clubName } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// PT Scorecard — Analytics (corporate+)
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
router.use(requireRole('corporate'))

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

    const rpcClubs = allClubs ? null : slugs.map(s => CLUB_BY_SLUG[s].clubNumber)

    const cached = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const [scorecard, pendingRows] = await Promise.all([
        supabaseAdmin.rpc('analytics_pt_scorecard', {
          p_start: start,
          p_end: end,
          p_clubs: rpcClubs,
          p_exclude: exclude,
        }),
        // Its own key: the scorecard's Book column counts Day Ones BOOKED in the
        // window, while pending has to be the ones DUE in it. Merged per club
        // rather than added to the SQL function for exactly that reason — see
        // migration 180.
        loadPendingDayOnes(rpcClubs, start, end),
      ])
      if (scorecard.error) throw new Error(scorecard.error.message)
      const pending = summarisePending(pendingRows)
      return {
        rows: (scorecard.data || []).map(r => ({
          ...r,
          pending_count: pending.byClub[r.club_number] || 0,
        })),
        pending: { ...pending, list: pendingList(pendingRows) },
      }
    })

    const built = buildScorecard(cached.rows, {
      goals,
      clubNameFor: (n) => clubName(n),
    })

    res.json({
      ...built,
      pending: cached.pending,
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
          pending: 'A set appointment whose date has passed with no outcome recorded. Counted against sets to date, and deliberately kept out of Show and Close — a pending Day One is unknown, not a no-show.',
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

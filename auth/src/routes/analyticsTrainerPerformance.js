const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { buildTrainerPerformance, SORTS } = require('../lib/trainerPerformance')
const { CLUBS, CLUB_BY_SLUG, CLUB_BY_NUMBER } = require('../lib/salespersonPerformance')

/**
 * Club name from a club number, tolerating a leading zero.
 *
 * abc_calendar_events stores '7655' while abc_pt_services can store '07655',
 * and CLUB_BY_NUMBER is keyed by the unpadded form — so the padded one misses
 * and the table prints a bare number where a club name belongs.
 */
function clubNameFor(n) {
  const raw = String(n ?? '')
  const hit = CLUB_BY_NUMBER[raw] || CLUB_BY_NUMBER[raw.replace(/^0+/, '')]
  return hit ? hit.name : raw
}

// ---------------------------------------------------------------------------
// Trainer Performance — Analytics (corporate+)
//
// What each trainer delivered, and what they closed. See migration 144 for how
// the three sources are stitched together and why the join is on a name.
//
// TWO CALLS, ON PURPOSE. The per-trainer rows cannot produce the headline:
// unique members trained is not additive, because a member who trains with two
// trainers is one member and two rows. For July 2026 the true total is 583 and
// the sum of the column is 634.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate'))

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 30 * 60 * 1000

/** Last complete month: a month still running has partial sessions. */
function lastCompleteMonth(today = new Date()) {
  const firstThis = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  const end = new Date(firstThis.getTime() - 86400000)
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

router.get('/', async (req, res) => {
  try {
    const lc = lastCompleteMonth()
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
    const start = isDate(req.query.start) ? String(req.query.start) : lc.start
    const end = isDate(req.query.end) ? String(req.query.end) : lc.end
    if (start > end) return res.status(400).json({ error: 'start must not be after end' })

    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const sort = SORTS.some(s => s.key === req.query.sort) ? String(req.query.sort) : 'sessions_desc'
    const allClubs = slugs.length === CLUBS.length
    const clubNumbers = allClubs ? null : slugs.map(s => CLUB_BY_SLUG[s].clubNumber)

    // Sorting is applied after the fetch, so changing it re-derives from the
    // cached rows instead of re-querying.
    const cacheKey = ['analytics:trainer-performance', start, end, slugs.slice().sort().join('+')].join('|')

    const { rows, totals } = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const [rows, totalsRows] = await Promise.all([
        // Paged: ~56 trainers today, but a wide range across seven clubs is one
        // segment change away from the 1000-row cap, and it truncates silently.
        fetchAll(supabaseAdmin.rpc('analytics_trainer_performance', {
          p_start: start, p_end: end, p_clubs: clubNumbers,
        })),
        supabaseAdmin.rpc('analytics_trainer_performance_totals', {
          p_start: start, p_end: end, p_clubs: clubNumbers,
        }),
      ])
      if (totalsRows.error) throw new Error(totalsRows.error.message)
      return { rows, totals: (totalsRows.data || [])[0] || null }
    })

    const built = buildTrainerPerformance(rows, totals, { sort, clubNameFor })

    res.json({
      ...built,
      meta: {
        start,
        end,
        sort,
        clubs: slugs,
        anchoredOn: isDate(req.query.start) ? 'request' : 'last complete month',
      },
    })
  } catch (err) {
    console.error('[analytics/trainer-performance] error:', err.message)
    res.status(500).json({ error: 'Failed to build trainer performance' })
  }
})

module.exports = router

const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { buildNetMembership, SORTS } = require('../lib/netMembership')
const { MEMBER_SEGMENTS, isValidSegment } = require('../lib/analyticsSegments')
const { CLUBS, CLUB_BY_SLUG, clubName } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Net Membership — Analytics (admin only)
//
// New in, lost out, and the net, per segment, against the same window a year
// earlier.
//
// SEGMENTS OFFERED: all ten, for the same reason as Membership Trends — this
// counts people, and every segment describes one. Salesperson is especially
// worth having here: it is the only report that can show whose members leave.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 30 * 60 * 1000

function yearToDate(today = new Date()) {
  return {
    start: `${today.getUTCFullYear()}-01-01`,
    end: today.toISOString().slice(0, 10),
  }
}

router.get('/', async (req, res) => {
  try {
    const ytd = yearToDate()
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
    const start = isDate(req.query.start) ? String(req.query.start) : ytd.start
    const end = isDate(req.query.end) ? String(req.query.end) : ytd.end
    if (start > end) return res.status(400).json({ error: 'start must not be after end' })

    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const segment = isValidSegment(String(req.query.segment || ''), MEMBER_SEGMENTS)
      ? String(req.query.segment)
      : 'club'
    const sort = SORTS.some(s => s.key === req.query.sort) ? String(req.query.sort) : 'net_desc'
    const exclude = req.query.exclusion !== 'include'
    const allClubs = slugs.length === CLUBS.length

    // The sort is applied after the fetch, so changing it re-derives from the
    // cached counts instead of re-querying.
    const cacheKey = ['analytics:net-membership', start, end, slugs.slice().sort().join('+'), segment, exclude].join('|')

    const rows = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      return fetchAll(supabaseAdmin.rpc('analytics_net_membership', {
        p_start: start,
        p_end: end,
        p_clubs: allClubs ? null : slugs.map(s => CLUB_BY_SLUG[s].clubNumber),
        p_segment: segment,
        p_exclude: exclude,
      }))
    })

    const built = buildNetMembership(rows, {
      sort,
      labelFor: (v) => (segment === 'club' ? (clubName(v)) : v),
    })

    res.json({
      ...built,
      segments: MEMBER_SEGMENTS,
      sorts: SORTS,
      meta: {
        start,
        end,
        segment,
        sort,
        clubs: slugs,
        exclusion: exclude ? 'exclude' : 'include',
        priorStart: new Date(Date.parse(start) - 31536000000).toISOString().slice(0, 10),
        priorEnd: new Date(Date.parse(end) - 31536000000).toISOString().slice(0, 10),
        notes: {
          flow: 'New members never take the conditional membership rule — joining is a fact about the day it happened. Lost members do, so the net is not measured against a base that never contained them.',
          prior: 'The prior-year figures cover the same span one year earlier, so a part-year is never set against a full one.',
          other: built.other.length
            ? `The ${built.other.length} smallest segments are pooled into Other: ${built.other.slice(0, 12).join(', ')}${built.other.length > 12 ? '…' : ''}.`
            : undefined,
        },
      },
    })
  } catch (err) {
    console.error('[analytics/net-membership] error:', err.message)
    res.status(500).json({ error: 'Failed to build net membership' })
  }
})

module.exports = router

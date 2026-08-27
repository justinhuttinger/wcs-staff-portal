const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { buildMembershipTrends } = require('../lib/membershipTrends')
const { MEMBER_SEGMENTS, isValidSegment } = require('../lib/analyticsSegments')
const { CLUBS, CLUB_BY_SLUG, clubName } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Membership Trends — Analytics (admin only)
//
// Total members and new members per month, split by one segment.
//
// SEGMENTS OFFERED: all ten. Every one of them describes a person, and this
// report counts people, so each can genuinely change the answer — "are we
// growing on annual or monthly terms" and "which salesperson's members stay"
// are both real questions here.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000
const MONTHS = 25

router.get('/', async (req, res) => {
  try {
    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const segment = isValidSegment(String(req.query.segment || ''), MEMBER_SEGMENTS)
      ? String(req.query.segment)
      : 'club'
    const exclude = req.query.exclusion !== 'include'
    const allClubs = slugs.length === CLUBS.length
    const end = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.end || ''))
      ? String(req.query.end)
      : new Date().toISOString().slice(0, 10)

    const cacheKey = ['analytics:membership-trends', end, slugs.slice().sort().join('+'), segment, exclude].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      // PAGED. 25 months times a high-cardinality segment runs past PostgREST's
      // 1000-row reply cap — salesperson alone is ~100 values, so 2,400 rows —
      // and the cap truncates silently, which reads as a chart that simply
      // stops partway through the year.
      const data = await fetchAll(supabaseAdmin.rpc('analytics_membership_trends', {
        p_end: end,
        p_months: MONTHS,
        p_clubs: allClubs ? null : slugs.map(s => CLUB_BY_SLUG[s].clubNumber),
        p_segment: segment,
        p_exclude: exclude,
      }))

      const built = buildMembershipTrends(data || [], {
        asOf: end,
        // Only the club segment carries numbers a reader cannot read; every
        // other segment is already its own label.
        labelFor: (v) => (segment === 'club' ? (clubName(v)) : v),
      })

      return {
        ...built,
        segments: MEMBER_SEGMENTS,
        meta: {
          end,
          segment,
          clubs: slugs,
          exclusion: exclude ? 'exclude' : 'include',
          notes: {
            level: 'Total Members is a level, not a running total: the headline is the latest complete month, never twelve months added together.',
            conditional: 'Members on A2 CORE and Active and Fit Limited count only if they checked in this month or last month, or joined within that window. New members never take that rule, since joining is a fact about the day it happened.',
            series: 'The chart starts at the first month the two-month rule can be answered, since check-in history reaches back only so far. Include shows more months than Exclude for that reason.',
            other: built.other.length
              ? `The ${built.other.length} smallest segments are pooled into Other: ${built.other.slice(0, 12).join(', ')}${built.other.length > 12 ? '…' : ''}.`
              : undefined,
          },
        },
      }
    })

    res.json(payload)
  } catch (err) {
    console.error('[analytics/membership-trends] error:', err.message)
    res.status(500).json({ error: 'Failed to build membership trends' })
  }
})

module.exports = router

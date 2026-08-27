const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { wrapSWR } = require('../services/memoryCache')
const { buildRevenuePerMember } = require('../lib/revenuePerMember')
const { BREAKDOWNS } = require('../lib/membershipMix')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Revenue Per Member — Analytics (admin only)
//
// Members and revenue over time, and average revenue per member split by any
// of the Membership Mix dimensions.
//
// Anchored on the last COMPLETE month. A month still running pairs a full
// month's members with a partial month's revenue, which drops the rate for a
// reason that has nothing to do with the business.
//
// Check-in frequency is not offered as a breakdown here: it is a rolling
// measure of the last few months, and pinning a member's whole revenue history
// to their recent visit rate would read as a finding rather than an artefact.
// ---------------------------------------------------------------------------

const CHART_MONTHS = 25
const MAX_SEGMENTS = 6

// The Mix dimensions that describe a member durably enough to carry revenue.
const SUPPORTED = new Set(BREAKDOWNS.map(b => b.key).filter(k => k !== 'checkin_frequency'))

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000

function lastCompleteMonthEnd(today = new Date()) {
  const firstOfThisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  return new Date(firstOfThisMonth.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

router.get('/', async (req, res) => {
  try {
    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const breakdown = SUPPORTED.has(req.query.breakdown) ? req.query.breakdown : 'membership_type'
    const exclude = req.query.exclusion !== 'include'
    const endParam = String(req.query.end || '')
    const end = /^\d{4}-\d{2}-\d{2}$/.test(endParam) ? endParam : lastCompleteMonthEnd()
    const allClubs = slugs.length === CLUBS.length

    const cacheKey = [
      'analytics:revenue-per-member', end, slugs.slice().sort().join('+'), breakdown, exclude,
    ].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const { data, error } = await supabaseAdmin.rpc('analytics_revenue_per_member', {
        p_end: end,
        p_months: CHART_MONTHS,
        p_clubs: allClubs ? null : slugs.map(s => CLUB_BY_SLUG[s].clubNumber),
        p_breakdown: breakdown,
        p_exclude: exclude,
      })
      if (error) throw new Error(error.message)

      const built = buildRevenuePerMember(data || [], { months: CHART_MONTHS, maxSegments: MAX_SEGMENTS })

      return {
        ...built,
        breakdown,
        breakdowns: BREAKDOWNS.filter(b => SUPPORTED.has(b.key)),
        meta: {
          end,
          clubs: slugs,
          exclusion: exclude ? 'exclude' : 'include',
          rowsRead: (data || []).length,
          // Named so the report can be honest about what the split is and is
          // not, rather than presenting an approximation as a measurement.
          caveats: {
            join: 'Revenue is matched to members through the agreement number; about 10% of transactions (5% of revenue) belong to guests, non-members or purged accounts and are not attributed to any segment.',
            split: 'A payment sits on an agreement, so it is divided evenly across the members sharing that agreement.',
            currentSegment: 'A member is grouped by the plan, age and payment details they hold TODAY, so a member who changed plan carries their whole revenue history under the new one.',
            conditional: 'Members on A2 CORE and Active and Fit Limited count only if they checked in within 60 days, or joined within the last 60 days. Those two insurance plans bill whether or not anybody turns up and only about 10% of them do, against 66% on every other plan. It is a check-in test rather than a plan exclusion because A2 EXEC is also an insurance plan and 76% of its members do come in.',
            conditionalRevenue: 'Only the member COUNT takes that rule; revenue does not. A payment that cleared is money we received whether or not the payer counts as a member, so revenue per member runs high on those two plans.',
            series: 'The chart starts at the first month the 60-day rule can be answered, since check-in history reaches back only so far. Include shows more months than Exclude for that reason.',
          },
        },
      }
    })

    res.json(payload)
  } catch (err) {
    console.error('[analytics/revenue-per-member] error:', err.message)
    res.status(500).json({ error: 'Failed to build revenue per member' })
  }
})

module.exports = router
module.exports.__test__ = { lastCompleteMonthEnd }

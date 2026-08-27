const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { wrapSWR } = require('../services/memoryCache')
const { buildTrends } = require('../lib/clubActivityTrends')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Club Activity Trends — Analytics (admin only)
//
// Ten small multiples, each a metric against the same month a year earlier.
// The aggregation is a SQL function (migration 124) rather than row-fetching:
// the window is 25 months across ~101k members and ~540k revenue transactions,
// which is not something to pull over the wire and add up in JS.
//
// We fetch 12 months more than we display so the OLDEST displayed month still
// has a partner to compare against. Without that, the left edge of every chart
// would have no dashed line and the year-over-year bars would start blank.
//
// Membership skip list gates the member counts, matching Salesperson
// Performance. Revenue and check-ins carry no membership type, so the
// exclusion cannot apply to them — see the report's own note.
// ---------------------------------------------------------------------------

const DISPLAY_MONTHS = 13
const COMPARISON_MONTHS = 12

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000

// The anchor is the last COMPLETE month: a month still in progress would draw
// a cliff on every chart and report a year-over-year collapse that is just the
// month not being over yet.
function lastCompleteMonthEnd(today = new Date()) {
  const firstOfThisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  const lastMonthEnd = new Date(firstOfThisMonth.getTime() - 24 * 60 * 60 * 1000)
  return lastMonthEnd.toISOString().slice(0, 10)
}

router.get('/', async (req, res) => {
  try {
    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const exclude = req.query.exclusion !== 'include'
    const endParam = String(req.query.end || '')
    const end = /^\d{4}-\d{2}-\d{2}$/.test(endParam) ? endParam : lastCompleteMonthEnd()

    const allClubs = slugs.length === CLUBS.length
    const cacheKey = ['analytics:club-activity', end, slugs.slice().sort().join('+'), exclude].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const { data, error } = await supabaseAdmin.rpc('analytics_club_activity', {
        p_end: end,
        p_months: DISPLAY_MONTHS + COMPARISON_MONTHS,
        // null means every club, which lets Postgres skip the club predicate
        // entirely on the all-clubs read rather than matching a 7-element array
        // against every row.
        p_clubs: allClubs ? null : slugs.map(s => CLUB_BY_SLUG[s].clubNumber),
        p_exclude: exclude,
      })
      if (error) throw new Error(error.message)

      const trends = buildTrends(data || [], DISPLAY_MONTHS)
      return {
        ...trends,
        meta: {
          end,
          clubs: slugs,
          exclusion: exclude ? 'exclude' : 'include',
          monthsFetched: (data || []).length,
          // Named so the report can say why three tiles have a short prior-year
          // line rather than leaving it looking like a bug.
          checkinGapMonths: trends.checkinGapMonths,
          conditional: {
            rule: 'Members on A2 CORE and Active and Fit Limited count only if they checked in this month or last month, or joined within that window. Those two insurance plans bill whether or not anybody turns up and only about 10% of them do, against 66% on every other plan. It is a check-in test rather than a plan exclusion because A2 EXEC is also an insurance plan and 76% of its members do come in.',
            flow: 'New members never take the rule: joining is a fact about the day it happened. Losses do take it, so attrition is not measured against a base that never contained them.',
            series: 'The chart starts at the first month the two-month rule can be answered, since check-in history reaches back only so far. Include shows more months than Exclude for that reason.',
          },
        },
      }
    })

    res.json(payload)
  } catch (err) {
    console.error('[analytics/club-activity] error:', err.message)
    res.status(500).json({ error: 'Failed to build club activity trends' })
  }
})

module.exports = router
module.exports.__test__ = { lastCompleteMonthEnd }

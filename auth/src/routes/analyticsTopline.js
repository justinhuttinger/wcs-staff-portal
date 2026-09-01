const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { wrapSWR } = require('../services/memoryCache')
const { buildTopline } = require('../lib/toplineMetrics')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Topline — Analytics (corporate+)
//
// Eight headline cards, each against the periods that make it mean something.
// Windows come from analytics_topline() (migration 125); the shaping is in
// lib/toplineMetrics.js.
//
// Anchored on the last day revenue actually landed rather than on today: the
// revenue import runs behind, and anchoring on today would show a month to date
// missing its most recent days while comparing it against complete prior
// periods — every card would report a collapse that is only the data not being
// in yet.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate'))

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000

async function latestRevenueDate() {
  const { data, error } = await supabaseAdmin
    .from('abc_revenue_transactions')
    .select('payment_date')
    .order('payment_date', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  return data?.[0]?.payment_date ? String(data[0].payment_date).slice(0, 10) : null
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
    const explicitEnd = /^\d{4}-\d{2}-\d{2}$/.test(endParam) ? endParam : null
    const end = explicitEnd || (await latestRevenueDate()) || new Date().toISOString().slice(0, 10)

    const allClubs = slugs.length === CLUBS.length
    const cacheKey = ['analytics:topline', end, slugs.slice().sort().join('+'), exclude].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const { data, error } = await supabaseAdmin.rpc('analytics_topline', {
        p_end: end,
        // null lets Postgres skip the club predicate entirely on the all-clubs
        // read rather than matching a 7-element array against every row.
        p_clubs: allClubs ? null : slugs.map(s => CLUB_BY_SLUG[s].clubNumber),
        p_exclude: exclude,
      })
      if (error) throw new Error(error.message)

      const built = buildTopline(data)
      return {
        ...built,
        meta: {
          end,
          anchoredOn: explicitEnd ? 'request' : 'latest revenue date',
          clubs: slugs,
          exclusion: exclude ? 'exclude' : 'include',
          // Check-ins moved off checkins_hourly, which lost the minutes after
          // each hour's last sync tick and undercounted recent months by ~43%.
          // abc_member_checkin_months is complete but monthly, so the card
          // compares whole months instead of the last 30 days.
          notes: {
            conditional:
              'Members on A2 CORE and Active and Fit Limited count only if they checked in this month or last month, or joined within that window. Those two insurance plans bill whether or not anybody turns up and only about 10% of them do, against 66% on every other plan. It is a check-in test rather than a plan exclusion because A2 EXEC is also an insurance plan and 76% of its members do come in. New members never take the rule, since joining is a fact about the day it happened; losses do, so attrition is not measured against a base that never contained them.',
            checkins:
              'Check-ins are a whole-month comparison: the last complete month against the same month a year earlier. The accurate source records one row per member per month, so a 30-day or month-to-date window is not available for them.',
          },
        },
      }
    })

    res.json(payload)
  } catch (err) {
    console.error('[analytics/topline] error:', err.message)
    res.status(500).json({ error: 'Failed to build topline' })
  }
})

module.exports = router

const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { wrapSWR } = require('../services/memoryCache')
const { buildPtPenetration, METRICS } = require('../lib/ptPenetration')
const { CLUBS, CLUB_BY_SLUG, clubName } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// PT Penetration — Analytics (corporate+)
//
// What share of members are personal training clients, per club, over time.
//
// Counts MEMBERS, from abc_pt_services (ABC /members/recurringservices), which
// carries a real memberId plus saleDate and inactiveDate.
//
// The first version inferred clients from training revenue and was wrong twice:
// revenue.member_number is the AGREEMENT number despite its name, so it counted
// agreements against a denominator of people, and "paid recently" stood in for
// "was a client".
//
// Recurring services answer the question exactly. Paid in Full cannot — every
// PIF row is returned inactive with no inactiveDate, marked inactive at sale
// because nothing recurring remains to bill — so a package counts for a chosen
// number of months after the sale. That setting moves only the PIF figure;
// recurring is unaffected.
// ---------------------------------------------------------------------------

const CHART_MONTHS = 32
const DEFAULT_PIF_MONTHS = 3

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate'))

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

    const metric = METRICS.some(m => m.key === req.query.metric) ? req.query.metric : 'penetration'
    // No longer a reader-facing choice. A prepaid package's length is now
    // derived per package from invoice_total / unit_price against a measured
    // consumption rate (migration 134), so this only reaches the handful of
    // rows with no usable price. Offering "PIF counts for 3 / 6 / 12 months"
    // would describe a knob that no longer moves anything real.
    const windowMonths = DEFAULT_PIF_MONTHS
    const exclude = req.query.exclusion !== 'include'
    const end = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.end || ''))
      ? String(req.query.end)
      : lastCompleteMonthEnd()
    const allClubs = slugs.length === CLUBS.length

    const cacheKey = [
      'analytics:pt-penetration', end, slugs.slice().sort().join('+'), windowMonths, exclude,
    ].join('|')

    // The metric only changes which number is plotted from rows we already
    // have, so it is applied after the cache rather than splitting it four ways.
    const raw = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const { data, error } = await supabaseAdmin.rpc('analytics_pt_penetration_v2', {
        p_end: end,
        p_months: CHART_MONTHS,
        p_clubs: allClubs ? null : slugs.map(s => CLUB_BY_SLUG[s].clubNumber),
        p_pif_months: windowMonths,
        p_exclude: exclude,
      })
      if (error) throw new Error(error.message)
      return data || []
    })

    const built = buildPtPenetration(raw, {
      metric,
      clubNameFor: (n) => clubName(n),
    })

    res.json({
      ...built,
      pifFallbackMonths: windowMonths,
      meta: {
        end,
        clubs: slugs,
        exclusion: exclude ? 'exclude' : 'include',
        rowsRead: raw.length,
        pifFallbackMonths: windowMonths,
        definition: {
          source: 'Counts members holding a PT service, from ABC /members/recurringservices — a real member id, not the agreement number that training revenue carries.',
          recurring: 'Recurring services are exact: counted from their sale date until the date they went inactive.',
          pif: 'Paid in Full is estimated per package. ABC marks a prepaid package inactive at the moment of sale and records no end date, so its length is worked out from the sessions bought (invoice total divided by unit price) against a measured rate of 5.3 sessions per 30 days. A typical 8-session package therefore counts for about 2 months and a 24-session package for about 5, rather than every package counting for the same 3.',
          pifCalibration: 'That rate comes from actual PT appointments for packages sold since 15 Jan 2026: 157 packages that trained averaged 8.45 sessions over 61 days. The appointment feed itself only reaches back to January, so it calibrates the rate rather than driving the window directly — using it directly would put a step in the chart where the feed starts.',
          overlap: 'A member holding both a recurring service and a package is counted once in the total, so recurring and PIF do not sum to it.',
          conditional: 'Members on A2 CORE and Active and Fit Limited count only if they checked in this month or last month, or joined within that window. Those two insurance plans bill whether or not anybody turns up and only about 10% of them do, against 66% on every other plan. It is a check-in test rather than a plan exclusion because A2 EXEC is also an insurance plan and 76% of its members do come in. It applies to both sides of the ratio, so penetration stays a share of the same population.',
          series: 'The chart starts at the first month the two-month rule can be answered, since check-in history reaches back only so far. Include shows more months than Exclude for that reason.',
        },
      },
    })
  } catch (err) {
    console.error('[analytics/pt-penetration] error:', err.message)
    res.status(500).json({ error: 'Failed to build PT penetration' })
  }
})

module.exports = router

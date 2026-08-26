const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { wrapSWR } = require('../services/memoryCache')
const { buildPtPenetration, METRICS, WINDOWS } = require('../lib/ptPenetration')
const { CLUBS, CLUB_BY_SLUG, CLUB_BY_NUMBER } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// PT Penetration — Analytics (admin only)
//
// What share of members are personal training clients, per club, over time.
//
// A PT member is one who PAID for training inside a trailing window. That is a
// measurement rather than a status, and it is the only option available:
// abc_recurring_pt_services holds 303 rows describing currently active
// recurring services, with no start dates and no paid-in-full rows, so there is
// no PT agreement history to read. Revenue goes back to 2024-01-01 and does.
//
// The window is a setting because it changes the answer materially — July 2026
// reads 1.97% on a one-month test and 3.26% on three months. Three is the
// default: a prepaid block covers months of sessions with a single
// transaction, and a one-month test drops those clients for every month except
// the one they bought in.
// ---------------------------------------------------------------------------

const CHART_MONTHS = 32
const DEFAULT_WINDOW = 3

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

    const metric = METRICS.some(m => m.key === req.query.metric) ? req.query.metric : 'penetration'
    const windowMonths = WINDOWS.some(w => String(w.key) === String(req.query.window))
      ? Number(req.query.window)
      : DEFAULT_WINDOW
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
      const { data, error } = await supabaseAdmin.rpc('analytics_pt_penetration', {
        p_end: end,
        p_months: CHART_MONTHS,
        p_clubs: allClubs ? null : slugs.map(s => CLUB_BY_SLUG[s].clubNumber),
        p_window_months: windowMonths,
        p_exclude: exclude,
      })
      if (error) throw new Error(error.message)
      return data || []
    })

    const built = buildPtPenetration(raw, {
      metric,
      clubNameFor: (n) => CLUB_BY_NUMBER[n]?.name || n,
    })

    res.json({
      ...built,
      windowMonths,
      meta: {
        end,
        clubs: slugs,
        exclusion: exclude ? 'exclude' : 'include',
        rowsRead: raw.length,
        definition: {
          ptMember: `Paid for personal training within the last ${windowMonths} month${windowMonths === 1 ? '' : 's'}.`,
          excluded: 'PT CONSULT (the free consultation, ~1,900 members a year at $0) and INBODY SCAN are not personal training and would inflate penetration several-fold.',
          revenue: 'PT revenue is net of refunds; PT member counts ignore refunds, since a refund does not make someone a client.',
          history: 'Built from training revenue because ABC gives us no PT agreement history — abc_recurring_pt_services is a current snapshot with no start dates.',
        },
      },
    })
  } catch (err) {
    console.error('[analytics/pt-penetration] error:', err.message)
    res.status(500).json({ error: 'Failed to build PT penetration' })
  }
})

module.exports = router

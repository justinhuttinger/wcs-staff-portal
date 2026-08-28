const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { buildPosSales } = require('../lib/posSales')
const { monthToDate, priorMonthWindow, priorLabel, windowLabel } = require('../lib/snapshotWindow')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// POS Sales — Analytics (admin only)
//
// TWO STREAMS CROSS THE TILL AND ARE NEVER BLENDED. Retail is goods;
// pass-through is dues, personal training, guest fees and account payments
// collected at the desk. Only 10.9% of POS revenue carries a unit cost because
// 89% of it is pass-through, so a naive margin reads 92.7% against a true
// 33.5%. Migration 165 has the full breakdown.
//
// History starts MAY 2026 — there is no earlier POS data — so the trend is
// short by nature rather than by filtering, and asking for 13 months simply
// returns what exists.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000
const TREND_MONTHS = 13

function trendStart(endDate, months) {
  const d = new Date(`${endDate}T00:00:00Z`)
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - (months - 1))
  return d.toISOString().slice(0, 10)
}

router.get('/', async (req, res) => {
  try {
    const mtd = monthToDate()
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
    const start = isDate(req.query.start) ? String(req.query.start) : mtd.start
    const end = isDate(req.query.end) ? String(req.query.end) : mtd.end
    if (start > end) return res.status(400).json({ error: 'start must not be after end' })

    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const allClubs = slugs.length === CLUBS.length
    const clubSlugs = allClubs ? null : slugs

    const prior = priorMonthWindow(start, end)
    const tStart = trendStart(end, TREND_MONTHS)

    const cacheKey = ['analytics:pos-sales', start, end, slugs.slice().sort().join('+')].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const [monthly, priorMonthly, trendMonthly, products, centers] = await Promise.all([
        fetchAll(supabaseAdmin.rpc('analytics_pos_monthly', {
          p_start: start, p_end: end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_pos_monthly', {
          p_start: prior.start, p_end: prior.end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_pos_monthly', {
          p_start: tStart, p_end: end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_pos_products', {
          p_start: start, p_end: end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_pos_centers', {
          p_start: start, p_end: end, p_clubs: clubSlugs,
        })),
      ])
      return { monthly, priorMonthly, trendMonthly, products, centers }
    })

    const built = buildPosSales(payload.monthly, payload.products, payload.centers, {
      priorMonthly: payload.priorMonthly,
      trendMonthly: payload.trendMonthly,
    })

    res.json({
      ...built,
      meta: {
        start, end,
        priorStart: prior.start, priorEnd: prior.end,
        trendStart: tStart, trendMonths: TREND_MONTHS,
        windowLabel: windowLabel(start, end),
        comparisonLabel: priorLabel(start, end),
        clubs: slugs,
        anchoredOn: isDate(req.query.start) ? 'request' : 'month to date',
      },
    })
  } catch (err) {
    console.error('[analytics/pos-sales] error:', err.message)
    res.status(500).json({ error: 'Failed to build POS sales' })
  }
})

module.exports = router

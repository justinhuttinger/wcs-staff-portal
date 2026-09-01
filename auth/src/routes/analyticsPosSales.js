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
// POS Sales — Analytics (corporate+)
//
// GOODS ONLY. Retail is the four stocked categories — Drinks, Snacks,
// Supplements, Merchandise (migration 168). Dues, personal training, guest
// fees and club account payments are real money and belong on a revenue
// report, not on one about product: keeping them here made the headline eight
// times the size of the thing being managed and invited exactly the blend that
// wrecks the margin. Migration 165 has the arithmetic that made the case.
//
// History starts MAY 2026 — there is no earlier POS data — so the trend is
// short by nature rather than by filtering, and asking for 13 months simply
// returns what exists.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate'))

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
      const [monthly, priorMonthly, trendMonthly, products, centers, byCategory, items] = await Promise.all([
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
        // One line per category on the trend, and the per-item table.
        fetchAll(supabaseAdmin.rpc('analytics_pos_by_category', {
          p_start: tStart, p_end: end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_pos_items', {
          p_start: start, p_end: end, p_clubs: clubSlugs,
        })),
      ])
      return { monthly, priorMonthly, trendMonthly, products, centers, byCategory, items }
    })

    const built = buildPosSales(payload.monthly, payload.products, payload.centers, {
      priorMonthly: payload.priorMonthly,
      trendMonthly: payload.trendMonthly,
    })

    // One series per category over the trend window. Months come from the
    // trend rollup so a category with no sales in a month breaks its line
    // rather than being dropped from the axis.
    const catMonths = [...new Set((payload.byCategory || []).map(r => String(r.month).slice(0, 10)))].sort()
    const catNames = [...new Set((payload.byCategory || []).map(r => r.profit_center))].sort()
    const catIndex = new Map(
      (payload.byCategory || []).map(r => [`${r.profit_center}||${String(r.month).slice(0, 10)}`, r])
    )
    const categorySeries = catNames.map(name => ({
      key: name,
      label: name.replace(/^WCS /, ''),
      points: catMonths.map(month => {
        const row = catIndex.get(`${name}||${month}`)
        return { month, value: row ? Math.round(Number(row.revenue) * 100) / 100 : null }
      }),
    }))

    res.json({
      ...built,
      categoryMonths: catMonths,
      categorySeries,
      items: (payload.items || []).map(r => ({
        name: r.name,
        profitCenter: r.profit_center,
        units: Number(r.units) || 0,
        revenue: Math.round((Number(r.revenue) || 0) * 100) / 100,
        costedUnits: Number(r.costed_units) || 0,
        unitCost: r.unit_cost === null || r.unit_cost === undefined ? null : Number(r.unit_cost),
        unitPrice: r.unit_price === null || r.unit_price === undefined ? null : Number(r.unit_price),
        marginPct: r.margin_pct === null || r.margin_pct === undefined ? null : Number(r.margin_pct),
      })),
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

const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { buildAttritionTrends, METRICS } = require('../lib/attritionTrends')
const { MEMBER_SEGMENTS } = require('../lib/analyticsSegments')
const { CLUBS, CLUB_BY_SLUG, CLUB_BY_NUMBER } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Attrition Trends — Analytics (corporate+)
//
// Month by month: how many members left, what share of the base that was, and
// what their dues and total spend were worth. Overall on top, split by a
// chosen segment underneath.
//
// The ten metrics are DERIVED IN JS from four raw quantities the SQL returns,
// so switching metric is a re-render rather than a re-query. Migration 152
// carries the definitions, including why dues cannot come from next_due_amount.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate'))

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000
// 13 by default, not 25. Measured on production: 13 months is 3.2s, 25 is 5.9s,
// and the whole thing was 11.2s before migration 153. The base function this
// leans on gets dearer with every month added, so the default is the range that
// loads promptly and longer ones are an explicit choice.
const DEFAULT_MONTHS = 13
const MAX_MONTHS = 37

// Overall is offered here even though it is not a member segment: the top chart
// is always pooled, and picking Overall below simply stops splitting it.
const SEGMENTS = [{ key: 'overall', label: 'Overall' }, ...MEMBER_SEGMENTS]
const SEGMENT_KEYS = new Set(SEGMENTS.map(s => s.key))

function clubNameFor(n) {
  const raw = String(n ?? '')
  const hit = CLUB_BY_NUMBER[raw] || CLUB_BY_NUMBER[raw.replace(/^0+/, '')]
  return hit ? hit.name : raw
}

router.get('/', async (req, res) => {
  try {
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
    const end = isDate(req.query.end) ? String(req.query.end) : new Date().toISOString().slice(0, 10)

    const monthsRaw = Number(req.query.months)
    const months = Number.isFinite(monthsRaw)
      ? Math.min(MAX_MONTHS, Math.max(2, Math.round(monthsRaw)))
      : DEFAULT_MONTHS

    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const allClubs = slugs.length === CLUBS.length
    const clubNumbers = allClubs ? null : slugs.map(s => CLUB_BY_SLUG[s].clubNumber)

    const segment = SEGMENT_KEYS.has(String(req.query.segment)) ? String(req.query.segment) : 'club'
    const metric = String(req.query.metric || 'attrition_pct')
    const exclude = String(req.query.exclude ?? 'true') !== 'false'

    // Cached on the SHAPE of the data, not on the chosen metric: all ten come
    // out of the same four quantities, so flipping metric costs nothing.
    const cacheKey = [
      'analytics:attrition-trends', end, months, segment, exclude,
      slugs.slice().sort().join('+'),
    ].join('|')

    const rows = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () =>
      // fetchAll, not a bare rpc: 25 months across a wide segment runs past the
      // 1000-row cap PostgREST applies silently, in ORDER BY order.
      fetchAll(supabaseAdmin.rpc('analytics_attrition_trends', {
        p_end: end,
        p_months: months,
        p_clubs: clubNumbers,
        p_segment: segment,
        p_exclude: exclude,
      }))
    )

    const built = buildAttritionTrends(rows, metric, { segment, clubNameFor })

    res.json({
      ...built,
      segments: SEGMENTS,
      meta: {
        end, months, segment, exclude,
        clubs: slugs,
        metrics: METRICS,
      },
    })
  } catch (err) {
    console.error('[analytics/attrition-trends] error:', err.message)
    res.status(500).json({ error: 'Failed to build attrition trends' })
  }
})

module.exports = router

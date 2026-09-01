const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { buildRevenueTrends } = require('../lib/revenueTrends')
const { REVENUE_SEGMENTS, MEMBER_ATTRIBUTED, isValidSegment } = require('../lib/analyticsSegments')
const { CLUBS, CLUB_BY_SLUG, clubName } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Revenue Trends — Analytics (corporate+)
//
// The same revenue at two grains — monthly and daily — split by one segment.
// Monthly is month-to-date comparable; see migration 143.
//
// SEGMENTS OFFERED: the transaction-level ones (profit centre, item, payment
// type, dues vs discretionary) are exact and are the point of this report. The
// member-level ones are offered too but carry an attribution caveat.
//
// Salesperson and relationship are NOT offered here, unlike the member reports:
// who signed somebody in 2019 does not explain what the club took on a Tuesday,
// and Item alone already runs to hundreds of values.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate'))

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000

const DEFAULT_YEARS = 3
// How far the daily panel reaches back, and the FLOOR on the monthly series.
// Monthly is a floor rather than a cap because the point of a trend is the
// months before the one you selected — the default range is a single month.
const DAILY_DAYS = 180
const MONTHLY_MONTHS = 13

/**
 * The day of the month every monthly bucket is cut at, mirroring migration 143.
 * Sent to the report so it can say which day it is comparing at, rather than
 * leaving a reader to assume these are whole months.
 */
function dayCutFor(end) {
  const d = new Date(`${end}T00:00:00Z`)
  const lastOfMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  const day = d.getUTCDate()
  return day === lastOfMonth ? null : day
}

router.get('/', async (req, res) => {
  try {
    const today = new Date()
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
    const end = isDate(req.query.end) ? String(req.query.end) : today.toISOString().slice(0, 10)
    const defaultStart = `${Number(end.slice(0, 4)) - DEFAULT_YEARS}-01-01`
    const start = isDate(req.query.start) ? String(req.query.start) : defaultStart
    if (start > end) return res.status(400).json({ error: 'start must not be after end' })

    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const segment = isValidSegment(String(req.query.segment || ''), REVENUE_SEGMENTS)
      ? String(req.query.segment)
      : 'overall'
    const allClubs = slugs.length === CLUBS.length

    const cacheKey = ['analytics:revenue-trends', start, end, slugs.slice().sort().join('+'), segment].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      // PAGED, and this one is not theoretical: three grains x ~44 months x 9
      // series is ~1,400 rows, past PostgREST's 1000-row cap. The union orders
      // by grain name, so with three grains 'annual' and 'daily' fitted and
      // 'monthly' fell off the end — the middle panel rendered empty and the
      // headline read $0. Daily is gone now, but the paging stays: a
      // high-cardinality segment over 30-odd months still clears 1000 rows.
      const data = await fetchAll(supabaseAdmin.rpc('analytics_revenue_trends', {
        p_start: start,
        p_end: end,
        p_clubs: allClubs ? null : slugs.map(s => CLUB_BY_SLUG[s].clubNumber),
        p_segment: segment,
        p_daily_days: DAILY_DAYS,
        p_monthly_months: MONTHLY_MONTHS,
      }))

      const built = buildRevenueTrends(data || [], {
        labelFor: (v) => (segment === 'club' ? (clubName(v)) : v),
      })

      return {
        ...built,
        // NOT `segments` — the builder already returns that, and it means the
        // chart's SERIES (the clubs, the profit centres, whatever is being
        // drawn). Overwriting it fed the legend the list of segment TYPES
        // instead, so the key read "Overall, Club, Dues vs Discretionary, ..."
        // in colours matching no line on the chart, and never hid itself
        // because that list is always 13 long.
        segmentOptions: REVENUE_SEGMENTS,
        meta: {
          start,
          end,
          segment,
          clubs: slugs,
          dailyDays: DAILY_DAYS,
          monthlyMonths: MONTHLY_MONTHS,
          // null when the range ends on a month end and nothing is truncated.
          dayCut: dayCutFor(end),
          definitions: {
            grains: 'Each panel has its own vertical scale. A month of revenue and a year of it on one axis would flatten the monthly line, so the two are separate charts that share a segment rather than one chart with two scales.',
            attribution: MEMBER_ATTRIBUTED.has(segment)
              ? 'This segment describes the MEMBER, so a payment has to be matched to one through the agreement number. Payments that match nobody appear as Unattributed, and a payment on a shared agreement is split evenly across the members on it.'
              : 'This segment comes from the transaction itself, so the split is exact — no member matching involved.',
            other: built.other.length
              ? `Ranked once across all three panels so a series is never named in one and pooled in another. The ${built.other.length} smallest are pooled into Other: ${built.other.slice(0, 10).join(', ')}${built.other.length > 10 ? '…' : ''}.`
              : undefined,
          },
        },
      }
    })

    res.json(payload)
  } catch (err) {
    console.error('[analytics/revenue-trends] error:', err.message)
    res.status(500).json({ error: 'Failed to build revenue trends' })
  }
})

module.exports = router

const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { buildRevenueByProfitCenter, SORTS } = require('../lib/revenueByProfitCenter')
const { CLUBS, CLUB_BY_SLUG, clubName } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Revenue by Profit Center — Analytics (admin only)
//
// One stacked bar per row, segmented by profit centre group.
//
// VIEW-BY OPTIONS ARE DELIBERATELY SHORT. Club and Payment Type live on the
// transaction itself, so they are exact. The member-level views need the
// agreement join, which does not resolve for guests, non-members and purged
// accounts — that revenue shows as Unattributed rather than vanishing.
//
// Salesperson, payment term and relationship are NOT offered: they describe how
// somebody joined, which tells you nothing about which profit centre a drink
// purchase landed in, and each extra option is another way to read the chart
// wrong.
//
// There is no sales-tax control either. Their tool has one; we have nothing to
// control, because tax_amount is 0 on every row — Oregon has no sales tax.
// ---------------------------------------------------------------------------

const VIEWS = [
  { key: 'club', label: 'Club' },
  { key: 'payment_type', label: 'Payment Type' },
  { key: 'membership_type', label: 'Membership Type' },
  { key: 'age_group', label: 'Age Group' },
  { key: 'gender', label: 'Gender' },
  { key: 'generation', label: 'Generation' },
  { key: 'join_source', label: 'Join Source' },
]
const EXACT_VIEWS = new Set(['club', 'payment_type'])

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000

/** Last complete month — revenue for a month still running is not comparable. */
function lastCompleteMonth(today = new Date()) {
  const firstThis = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  const end = new Date(firstThis.getTime() - 86400000)
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

router.get('/', async (req, res) => {
  try {
    const lc = lastCompleteMonth()
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
    const start = isDate(req.query.start) ? String(req.query.start) : lc.start
    const end = isDate(req.query.end) ? String(req.query.end) : lc.end
    if (start > end) return res.status(400).json({ error: 'start must not be after end' })

    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const view = VIEWS.some(v => v.key === req.query.view) ? String(req.query.view) : 'club'
    const sort = SORTS.some(s => s.key === req.query.sort) ? String(req.query.sort) : 'total_desc'
    const allClubs = slugs.length === CLUBS.length

    const cacheKey = ['analytics:revenue-profit-center', start, end, slugs.slice().sort().join('+'), view].join('|')

    const rows = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      return fetchAll(supabaseAdmin.rpc('analytics_revenue_by_profit_center', {
        p_start: start,
        p_end: end,
        p_clubs: allClubs ? null : slugs.map(s => CLUB_BY_SLUG[s].clubNumber),
        p_view: view,
      }))
    })

    const built = buildRevenueByProfitCenter(rows, {
      sort,
      labelFor: (v) => (view === 'club' ? (clubName(v)) : v),
    })

    res.json({
      ...built,
      views: VIEWS,
      sorts: SORTS,
      meta: {
        start,
        end,
        view,
        sort,
        clubs: slugs,
        definitions: {
          groups: 'Annual Fee, Dues, Training, WCS Drinks, WCS Snacks, WCS Merchandise, WCS Supplements and Swim each get their own segment; every other profit centre is pooled into Other. Supplements earned a place because it out-earns both Merchandise and Snacks.',
          other: 'Other is led by Guest Fees, Camp Programs and Enrolment Fees. It also carries refunds and chargebacks, which are negative, so revenue here is net of what we gave back rather than a gross figure.',
          tax: 'No sales-tax toggle: Oregon has no sales tax and every row records zero, so there is nothing for it to change.',
          attribution: EXACT_VIEWS.has(view)
            ? 'Club and Payment Type come from the transaction itself, so this view is exact.'
            : 'This view needs to match a payment to a member through the agreement number. Payments that match no member — guests, non-members, purged accounts — are shown as Unattributed rather than dropped, and a payment on a shared agreement is split evenly across the members on it.',
        },
      },
    })
  } catch (err) {
    console.error('[analytics/revenue-by-profit-center] error:', err.message)
    res.status(500).json({ error: 'Failed to build revenue by profit center' })
  }
})

module.exports = router

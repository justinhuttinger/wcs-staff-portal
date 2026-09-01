const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { buildFirstPtPurchase } = require('../lib/firstPtPurchase')
const { isValidSegment } = require('../lib/analyticsSegments')
const { CLUBS, CLUB_BY_SLUG, clubName } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// First Purchases by Join Month — Analytics (corporate+)
//
// Of the members we signed, how many go on to buy PT, and how long after
// joining.
//
// SEGMENTS OFFERED: the ones that plausibly change whether somebody buys
// training — club, membership type, age, gender, generation, join source and
// the salesperson who signed them.
//
// Payment method and relationship are NOT offered: how a member's dues are
// collected has no bearing on whether they buy PT, and a control that cannot
// change the answer only invites reading noise as signal.
// ---------------------------------------------------------------------------

const SEGMENTS = [
  { key: 'club', label: 'Club' },
  { key: 'membership_type', label: 'Membership Type' },
  { key: 'age_group', label: 'Age Group' },
  { key: 'gender', label: 'Gender' },
  { key: 'generation', label: 'Generation' },
  { key: 'join_source', label: 'Join Source' },
  { key: 'payment_term', label: 'Payment Term' },
  { key: 'salesperson', label: 'Salesperson' },
]

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate'))

const FRESH_MS = 15 * 60 * 1000
const STALE_MS = 2 * 60 * 60 * 1000

// Joins from this far back by default. The PT services feed reaches to mid-2022,
// so a wider default would add cohorts we can say almost nothing about.
const DEFAULT_JOIN_FROM = '2022-01-01'

router.get('/', async (req, res) => {
  try {
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
    const joinFrom = isDate(req.query.joinFrom) ? String(req.query.joinFrom) : DEFAULT_JOIN_FROM
    const joinTo = isDate(req.query.joinTo) ? String(req.query.joinTo) : new Date().toISOString().slice(0, 10)
    if (joinFrom > joinTo) return res.status(400).json({ error: 'joinFrom must not be after joinTo' })

    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const segment = isValidSegment(String(req.query.segment || ''), SEGMENTS)
      ? String(req.query.segment)
      : 'club'
    const exclude = req.query.exclusion !== 'include'
    const allClubs = slugs.length === CLUBS.length

    const cacheKey = ['analytics:first-pt-purchase', joinFrom, joinTo, slugs.slice().sort().join('+'), segment, exclude].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      // PAGED: six buckets per segment value, so a salesperson split is well
      // past the 1000-row cap.
      const data = await fetchAll(supabaseAdmin.rpc('analytics_first_pt_purchase', {
        p_join_from: joinFrom,
        p_join_to: joinTo,
        p_clubs: allClubs ? null : slugs.map(s => CLUB_BY_SLUG[s].clubNumber),
        p_segment: segment,
        p_exclude: exclude,
      }))

      const built = buildFirstPtPurchase(data || [], {
        labelFor: (v) => (segment === 'club' ? (clubName(v)) : v),
      })

      return {
        ...built,
        segments: SEGMENTS,
        meta: {
          joinFrom,
          joinTo,
          segment,
          clubs: slugs,
          exclusion: exclude ? 'exclude' : 'include',
          definitions: {
            cohort: 'The cohort is members who JOINED inside the window, not members who bought inside it. The question is what share of the people we sign go on to buy training, so the denominator has to be the intake.',
            denominators: 'The bars are a share of PURCHASERS and add to 100%. The tiles are a share of MEMBERS, which is a much smaller number. The bars say when buyers buy; the tiles say how many members buy at all.',
            perSegment: 'Each segment is scaled against its own purchasers, so a small club is comparable with a large one rather than the chart simply redrawing club size.',
            source: 'First purchase comes from ABC recurring services, which lists what is still on the account and reaches back to mid-2022. A package bought and long since purged is not in it, so the older tenure buckets read low. Training revenue reaches further back but keys on the agreement rather than the member, so on a family agreement it cannot say who bought.',
            resign: 'A member who re-signed can show a purchase before their current join date, because that date moves on a re-sign. Those land in Month 1 rather than being dropped.',
          },
        },
      }
    })

    res.json(payload)
  } catch (err) {
    console.error('[analytics/first-pt-purchase] error:', err.message)
    res.status(500).json({ error: 'Failed to build first PT purchase' })
  }
})

module.exports = router

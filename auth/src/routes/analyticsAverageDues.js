const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { getSkipList } = require('../utils/membershipSkipList')
const { loadCategoryMap, parseBasis } = require('../lib/analyticsMemberFilters')
const { CLUBS, CLUB_BY_SLUG, isExcludedType, clubName } = require('../lib/salespersonPerformance')
const { buildAverageDues } = require('../lib/averageDues')

// ---------------------------------------------------------------------------
// Average Monthly Dues — Analytics (corporate+)
//
// What a dues-paying member is worth per month. See lib/averageDues for who
// counts as one and why next_due_amount cannot simply be summed.
//
// A LIVE SNAPSHOT, not a window. Dues are what the base is billed right now, so
// there is no date range: a member's current charge has no history in
// abc_members to slice by. The report says so rather than accepting a range it
// would ignore.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate'))

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000

const VIEW_BY = ['club', 'membership_type']

router.get('/', async (req, res) => {
  try {
    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const viewBy = VIEW_BY.includes(String(req.query.viewBy)) ? String(req.query.viewBy) : 'club'
    // The shared basis control. Dues are billed per AGREEMENT either way — the
    // basis only decides what the average divides by, a membership or a person
    // covered by one.
    const basis = parseBasis(req.query.basis)
    const exclude = req.query.exclusion !== 'include'
    const clubNumbers = slugs.map(s => CLUB_BY_SLUG[s].clubNumber)

    const cacheKey = ['analytics:average-dues', slugs.slice().sort().join('+'), exclude].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const [rows, skip, categoryMap] = await Promise.all([
        fetchAll(supabaseAdmin.from('abc_members')
          // agreement_number and is_primary_member are load-bearing: a family
          // is several rows on one agreement, each stamped with an amount, and
          // without these the column sums to several times the real bill.
          .select('member_id, club_number, agreement_number, is_primary_member, membership_type, next_due_amount, payment_frequency')
          .in('club_number', clubNumbers)
          .eq('is_active', true)
          .eq('member_status', 'Active')
          .order('member_id', { ascending: true })),
        getSkipList(),
        // Read per request rather than cached: the mapping is edited from Admin,
        // and a stale copy would quietly move the denominator.
        loadCategoryMap(supabaseAdmin),
      ])

      // The Dues category is an EXPLICIT list, so a membership type nobody has
      // mapped reads 'Other' and is left out rather than being assumed to pay
      // dues. Counted, so the report can say how many were set aside — an
      // unmapped type silently dropped from a denominator is how an average
      // drifts without anybody noticing.
      let unmapped = 0
      const dues = []
      for (const r of rows) {
        if (exclude && isExcludedType(r.membership_type, skip)) continue
        const category = categoryMap.get(String(r.membership_type || '').toLowerCase())
        if (!category) { unmapped += 1; continue }
        if (category !== 'Dues') continue
        dues.push(r)
      }
      return { dues, unmapped, activeRows: rows.length }
    })

    const built = buildAverageDues(payload.dues, { viewBy, basis, clubName })

    res.json({
      ...built,
      meta: {
        clubs: slugs,
        asOf: new Date().toISOString().slice(0, 10),
        duesMembers: payload.dues.length,
        basis,
        unmappedTypes: payload.unmapped,
        exclusion: exclude ? 'exclude' : 'include',
      },
    })
  } catch (err) {
    console.error('[analytics/average-dues] failed:', err.message)
    res.status(500).json({ error: 'average dues failed' })
  }
})

module.exports = router

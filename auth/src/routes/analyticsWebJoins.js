const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { narrowClubsToScope } = require('../services/locationScope')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { getSkipList } = require('../utils/membershipSkipList')
const { parseCategory, parseBasis, filterNote, matchesFilters, loadCategoryMap } = require('../lib/analyticsMemberFilters')
const { buildWebJoins, monthsBack } = require('../lib/webJoins')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Web Joins — Analytics (manager+, club-scoped)
//
// How many new members joined on the web, and what share of all joins that
// is: for the selected range (headline + per club) and month by month over
// the trailing 13 months. Definitions live in lib/webJoins.js.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('manager'))

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000
const TREND_MONTHS = 13

router.get('/', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
    const end = isDate(req.query.end) ? String(req.query.end) : today
    const start = isDate(req.query.start) ? String(req.query.start) : `${end.slice(0, 7)}-01`
    if (start > end) return res.status(400).json({ error: 'start must not be after end' })

    const clubsParam = String(req.query.clubs || 'all')
    const asked = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (asked.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })
    // Managers are narrowed to the clubs they are assigned; corporate+ keep what they asked for.
    const slugs = await narrowClubsToScope(req, asked)
    if (slugs.length === 0) return res.status(403).json({ error: 'no access to the requested clubs' })

    const category = parseCategory(req.query.category)
    const basis = parseBasis(req.query.basis)
    const clubs = slugs.map(s => CLUB_BY_SLUG[s])
    const trendStart = monthsBack(end, TREND_MONTHS - 1)
    const fetchStart = start < trendStart ? start : trendStart

    const cacheKey = ['analytics:web-joins', start, end, slugs.slice().sort().join('+'), category, basis].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const [raw, skip, categoryMap] = await Promise.all([
        fetchAll(supabaseAdmin
          .from('abc_members')
          .select('club_number, member_id, since_date, agreement_entry_source, membership_type, is_primary_member')
          .in('club_number', clubs.map(c => c.clubNumber))
          .gte('since_date', fetchStart)
          .lte('since_date', end)
          .order('member_id', { ascending: true })),
        getSkipList(),
        category === 'all' ? null : loadCategoryMap(supabaseAdmin),
      ])

      const rows = raw.filter(r =>
        !skip.has(String(r.membership_type || '').toLowerCase())
        && matchesFilters(r, { category, basis, categoryMap }))

      return {
        ...buildWebJoins(rows, { start, end, trendStart, clubs }),
        meta: {
          start, end, trendStart, clubs: slugs,
          notes: {
            filter: filterNote({ category, basis }),
            definition: 'A web join is a new member whose agreement ABC records as entered on the web (ABC\'s signup page or our Online Join flow). Joins count on the original join date with the skip list applied, the same as Club Snapshot\'s Joined.',
            caveat: 'Entry source belongs to the member\'s current agreement, so a web joiner who later re-signed in club reads as in-club.',
          },
        },
      }
    })

    res.json(payload)
  } catch (err) {
    console.error('[analytics/web-joins] error:', err.message)
    res.status(500).json({ error: 'Failed to build web joins' })
  }
})

module.exports = router

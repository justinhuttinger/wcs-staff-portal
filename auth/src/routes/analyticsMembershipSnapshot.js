const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { getSkipList } = require('../utils/membershipSkipList')
const { buildReport } = require('../lib/salespersonPerformance')
const { loadSalespersonWindow } = require('../lib/salespersonData')
const { buildMembershipSnapshot } = require('../lib/membershipSnapshot')
const { monthToDate, priorMonthWindow } = require('../lib/snapshotWindow')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Membership Snapshot — Analytics (admin only)
//
// One salesperson at a time, month to date by default, with the SAME window a
// month earlier beside it and a month-by-month trend underneath.
//
// The stats come from buildReport — the very function behind Salesperson
// Performance — rather than being recomputed here, so the snapshot and the
// table it drills into can never disagree about what a Day One Book % is. That
// also means the whole window is loaded, not just one person's rows: % of Club
// Total needs the rest of the club to divide by.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 30 * 60 * 1000
const SERIES_MONTHS = 13

const NO_FILTERS = {
  viewBy: 'salesperson',
  membershipType: null, entrySource: null, gender: null, ageGroup: null,
  paymentFrequency: null, term: null, relationship: null, exclusion: 'exclude',
}

const norm = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase()

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

    const person = String(req.query.person || '').trim()
    const prior = priorMonthWindow(start, end)
    const allClubs = slugs.length === CLUBS.length
    const clubNumbers = slugs.map(s => CLUB_BY_SLUG[s].clubNumber)

    const cacheKey = ['analytics:membership-snapshot', start, end, slugs.slice().sort().join('+')].join('|')

    // Both windows and the roster are cached together and independently of the
    // chosen person, so flipping between people costs nothing.
    const base = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const skipList = await getSkipList()
      const [cur, prev] = await Promise.all([
        loadSalespersonWindow(clubNumbers, slugs, start, end),
        loadSalespersonWindow(clubNumbers, slugs, prior.start, prior.end),
      ])
      return {
        current: buildReport(cur.members, cur.dayOnes, cur.contactsById, NO_FILTERS, skipList),
        prior: buildReport(prev.members, prev.dayOnes, prev.contactsById, NO_FILTERS, skipList),
      }
    })

    const people = (base.current.rows || [])
      .map(r => r.salesperson)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))

    // Default to whoever signed the most this window, so the report opens on
    // something rather than on an empty picker.
    const chosen = person || (base.current.rows || [])
      .slice()
      .sort((a, b) => (b.newMemberUnits || 0) - (a.newMemberUnits || 0))[0]?.salesperson || null

    const findRow = (report) =>
      (report.rows || []).find(r => norm(r.salesperson) === norm(chosen)) || null

    const series = chosen
      ? await fetchAll(supabaseAdmin.rpc('analytics_salesperson_monthly', {
        p_end: end,
        p_months: SERIES_MONTHS,
        p_clubs: allClubs ? null : clubNumbers,
        p_person: chosen,
      }))
      : []

    const built = buildMembershipSnapshot(findRow(base.current), findRow(base.prior), series, { person: chosen })

    res.json({
      ...built,
      people,
      meta: {
        start, end,
        priorStart: prior.start, priorEnd: prior.end,
        clubs: slugs,
        seriesMonths: SERIES_MONTHS,
        anchoredOn: isDate(req.query.start) ? 'request' : 'month to date',
      },
    })
  } catch (err) {
    console.error('[analytics/membership-snapshot] error:', err.message)
    res.status(500).json({ error: 'Failed to build membership snapshot' })
  }
})

module.exports = router

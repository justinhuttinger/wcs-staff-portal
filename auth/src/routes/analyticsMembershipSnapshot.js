const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { getSkipList } = require('../utils/membershipSkipList')
const { buildReport } = require('../lib/salespersonPerformance')
const { loadSalespersonWindow } = require('../lib/salespersonData')
const { buildClubMembershipSnapshot } = require('../lib/clubMembershipSnapshot')
const { monthToDate, priorMonthWindow, priorLabel, windowLabel } = require('../lib/snapshotWindow')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Membership Snapshot — Analytics (admin only)
//
// The whole club month to date, with the same window a month earlier beside it.
// The per-person version of this is Salesperson Snapshot.
//
// Counts come from analytics_topline_window and rates from buildReport; the
// reason for splitting them that way is written out in clubMembershipSnapshot.
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

function firstRow(res) {
  if (res.error) throw new Error(res.error.message)
  return (res.data || [])[0] || null
}

/**
 * Tours given and how many joined, straight from tour_intakes.
 *
 * Only COMPLETED tours count as given: a row still sitting at 'ready' is a
 * check-in nobody has closed out, not a tour that happened.
 */
async function loadTours(slugs, clubNumbers, start, end) {
  let q = supabaseAdmin
    .from('tour_intakes')
    .select('outcome')
    .eq('status', 'completed')
    .gte('completed_at', `${start}T00:00:00`)
    .lte('completed_at', `${end}T23:59:59.999`)
  if (clubNumbers) q = q.in('club_number', clubNumbers)

  // Which outcomes count as a join is read from the table, not embedded:
  // migration 147 deliberately put NO foreign key on tour_intakes.outcome, so
  // there is no relationship for PostgREST to traverse. Adding one would also
  // mean an unrecognised outcome rejected the whole tour, which is the failure
  // that migration set out to avoid.
  const [rows, outcomes] = await Promise.all([
    fetchAll(q),
    fetchAll(supabaseAdmin.from('tour_outcomes').select('outcome, is_sale')),
  ])
  const sold = new Set(outcomes.filter(o => o.is_sale).map(o => o.outcome))
  return { given: rows.length, joined: rows.filter(r => sold.has(r.outcome)).length }
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
    const clubNumbers = slugs.map(s => CLUB_BY_SLUG[s].clubNumber)
    const rpcClubs = allClubs ? null : clubNumbers
    const prior = priorMonthWindow(start, end)

    const cacheKey = ['analytics:club-membership-snapshot', start, end, slugs.slice().sort().join('+')].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const skipList = await getSkipList()

      const windowFor = async (s, e) => {
        const [w, sales, tours] = await Promise.all([
          supabaseAdmin.rpc('analytics_topline_window', {
            p_start: s, p_end: e, p_clubs: rpcClubs, p_exclude: true,
          }),
          loadSalespersonWindow(clubNumbers, slugs, s, e),
          loadTours(slugs, rpcClubs, s, e),
        ])
        const row = firstRow(w)
        return {
          window: {
            ...(row || {}),
            // The stock is a point in time, not a window, so it is asked for
            // separately at the window's end.
            total_members: null,
          },
          summary: buildReport(sales.members, sales.dayOnes, sales.contactsById, NO_FILTERS, skipList).summary,
          tours,
        }
      }

      const [current, priorWindow, membersNow, membersPrior, series] = await Promise.all([
        windowFor(start, end),
        windowFor(prior.start, prior.end),
        supabaseAdmin.rpc('analytics_topline_members_as_of', {
          p_at: end, p_clubs: rpcClubs, p_exclude: true,
        }),
        supabaseAdmin.rpc('analytics_topline_members_as_of', {
          p_at: prior.end, p_clubs: rpcClubs, p_exclude: true,
        }),
        fetchAll(supabaseAdmin.rpc('analytics_membership_monthly', {
          p_end: end, p_months: SERIES_MONTHS, p_clubs: rpcClubs, p_exclude: true,
        })),
      ])

      if (membersNow.error) throw new Error(membersNow.error.message)
      if (membersPrior.error) throw new Error(membersPrior.error.message)
      current.window.total_members = membersNow.data
      priorWindow.window.total_members = membersPrior.data

      return { current, prior: priorWindow, series }
    })

    const built = buildClubMembershipSnapshot(
      payload.current,
      payload.prior,
      payload.series,
      { comparisonLabel: priorLabel(start, end) },
    )

    res.json({
      ...built,
      meta: {
        start, end,
        priorStart: prior.start, priorEnd: prior.end,
        windowLabel: windowLabel(start, end),
        comparisonLabel: priorLabel(start, end),
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

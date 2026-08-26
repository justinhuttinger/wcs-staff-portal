const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { getSkipList } = require('../utils/membershipSkipList')
const { buildMembershipMix, BREAKDOWNS, VIEW_BY } = require('../lib/membershipMix')
const { CLUBS, CLUB_BY_SLUG, CLUB_BY_NUMBER } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Membership Mix — Analytics (admin only)
//
// Who our members are, split by whichever dimension you pick.
//
// The counted base is the same everywhere in this tab, so a total here agrees
// with a total there:
//   * abc_members_counted, so dormant insurance plans do not inflate it
//     (migration 126)
//   * active only, minus Return For Collection / Cancelled / Expired /
//     Pending Cancel
//   * minus the abc_membership_skip_list types
//
// The check-in frequency breakdown reads abc_member_checkin_months. A member
// with no rows there is Unknown rather than Never — we may simply hold no
// history for the club or period.
// ---------------------------------------------------------------------------

const EXCLUDED_STATUSES = ['Return For Collection', 'Cancelled', 'Expired', 'Pending Cancel']
const CHECKIN_WINDOW_MONTHS = 6

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000

const FIELDS = [
  'member_id', 'club_number', 'membership_type', 'gender', 'birth_date',
  'agreement_term', 'agreement_payment_method', 'agreement_entry_source',
  'sales_person_name', 'is_primary_member', 'since_date', 'counts_as_member',
].join(', ')

async function loadMembers(clubNumbers) {
  return fetchAll(
    supabaseAdmin
      .from('abc_members_counted')
      .select(FIELDS)
      .in('club_number', clubNumbers)
      .eq('is_active', true)
      .eq('counts_as_member', true)
      .not('member_status', 'in', `(${EXCLUDED_STATUSES.map(s => `"${s}"`).join(',')})`)
      .order('member_id', { ascending: true })
  )
}

/**
 * Average check-ins per month over the trailing window, per member.
 *
 * Divided by the number of months we actually hold for that member's club, not
 * by the window length — a club whose history starts part-way through would
 * otherwise look half as active as it is.
 */
async function loadCheckinRates(clubNumbers) {
  const since = new Date()
  since.setUTCMonth(since.getUTCMonth() - CHECKIN_WINDOW_MONTHS)
  const from = since.toISOString().slice(0, 8) + '01'

  const rows = await fetchAll(
    supabaseAdmin
      .from('abc_member_checkin_months')
      .select('member_id, club_number, month, checkins')
      .in('club_number', clubNumbers)
      .gte('month', from)
      .order('member_id', { ascending: true })
  )

  const monthsPerClub = new Map()
  const totals = new Map()
  for (const r of rows) {
    if (!monthsPerClub.has(r.club_number)) monthsPerClub.set(r.club_number, new Set())
    monthsPerClub.get(r.club_number).add(String(r.month).slice(0, 7))
    totals.set(r.member_id, (totals.get(r.member_id) || 0) + (Number(r.checkins) || 0))
  }

  const clubMonths = new Map(
    [...monthsPerClub.entries()].map(([club, months]) => [club, months.size])
  )

  return { totals, clubMonths, rows: rows.length }
}

router.get('/', async (req, res) => {
  try {
    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const breakdown = BREAKDOWNS.some(b => b.key === req.query.breakdown)
      ? req.query.breakdown
      : 'membership_type'
    const viewBy = VIEW_BY.includes(req.query.viewBy) ? req.query.viewBy : 'club'
    const exclude = req.query.exclusion !== 'include'
    const clubNumbers = slugs.map(s => CLUB_BY_SLUG[s].clubNumber)

    const cacheKey = [
      'analytics:membership-mix', slugs.slice().sort().join('+'), breakdown, viewBy, exclude,
    ].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const skipList = await getSkipList()
      // The check-in table is only read when the breakdown needs it — it is the
      // largest table in play and irrelevant to the other nine dimensions.
      const needsCheckins = breakdown === 'checkin_frequency'
      const [raw, checkins] = await Promise.all([
        loadMembers(clubNumbers),
        needsCheckins ? loadCheckinRates(clubNumbers) : Promise.resolve(null),
      ])

      const members = exclude
        ? raw.filter(m => !skipList.has((m.membership_type || '').toLowerCase()))
        : raw

      const checkinRateFor = (m) => {
        if (!checkins) return undefined
        const months = checkins.clubMonths.get(m.club_number)
        if (!months) return undefined
        const total = checkins.totals.get(m.member_id)
        // Present in a club we hold history for, but with no rows of their own,
        // means they genuinely did not come in.
        return (total || 0) / months
      }

      const mix = buildMembershipMix(members, {
        breakdown,
        viewBy,
        asOf: new Date().toISOString().slice(0, 10),
        clubNameFor: (n) => CLUB_BY_NUMBER[n]?.name || n,
        checkinRateFor,
      })

      return {
        ...mix,
        breakdowns: BREAKDOWNS,
        meta: {
          clubs: slugs,
          exclusion: exclude ? 'exclude' : 'include',
          excludedStatuses: EXCLUDED_STATUSES,
          checkinWindowMonths: needsCheckins ? CHECKIN_WINDOW_MONTHS : null,
          // Zero here means the backfill has not run for these clubs yet, which
          // is why every member would land in Unknown.
          checkinRowsRead: checkins ? checkins.rows : null,
        },
      }
    })

    res.json(payload)
  } catch (err) {
    console.error('[analytics/membership-mix] error:', err.message)
    res.status(500).json({ error: 'Failed to build membership mix' })
  }
})

module.exports = router

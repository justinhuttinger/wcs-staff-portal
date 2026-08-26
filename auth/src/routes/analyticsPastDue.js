const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { getSkipList } = require('../utils/membershipSkipList')
const { buildPastDue, isChaseable, EXCLUDED_STATUSES, VIEW_BY } = require('../lib/pastDueReport')
const { CLUBS, CLUB_BY_SLUG, CLUB_BY_NUMBER } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Past Due — Analytics (admin only)
//
// Who owes money and is still worth calling. Collections, cancelled, expired
// and pending-cancel accounts are excluded outright, not offered as a filter:
// collections alone is ~$468k against ~$59k for everyone else, so including it
// would bury the members a front desk can actually recover.
//
// Small enough to aggregate in JS — the past-due set is a couple of thousand
// rows even before the status filter, not the 101k of the full member table.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 30 * 60 * 1000

const MEMBER_FIELDS = [
  'member_id', 'club_number', 'first_name', 'last_name', 'email', 'mobile_phone', 'primary_phone',
  'member_status', 'is_active', 'membership_type', 'agreement_payment_method', 'agreement_term',
  'past_due_balance', 'total_past_due_balance', 'late_fee_amount', 'next_due_amount',
  'since_date', 'sales_person_name', 'counts_as_member', 'is_conditional_type',
].join(', ')

async function loadPastDue(clubNumbers) {
  return fetchAll(
    supabaseAdmin
      // The view, not the table: it carries counts_as_member, which excludes
      // insurance-plan members who have not checked in recently. See
      // migration 126.
      .from('abc_members_counted')
      .select(MEMBER_FIELDS)
      .in('club_number', clubNumbers)
      .gt('past_due_balance', 0)
      .order('past_due_balance', { ascending: false })
  )
}

// The denominator for "% of members past due" — the same population the
// numerator is drawn from, so the percentage is of chaseable members rather
// than of everyone who ever held a membership.
async function loadMemberBase(clubNumbers, skipList) {
  const rows = await fetchAll(
    supabaseAdmin
      .from('abc_members_counted')
      .select('club_number, member_status, membership_type, counts_as_member')
      .in('club_number', clubNumbers)
      .eq('is_active', true)
      .eq('counts_as_member', true)
      .order('club_number', { ascending: true })
  )
  const totals = {}
  for (const r of rows) {
    if (EXCLUDED_STATUSES.has(r.member_status)) continue
    if (skipList.has((r.membership_type || '').toLowerCase())) continue
    totals[r.club_number] = (totals[r.club_number] || 0) + 1
  }
  return totals
}

router.get('/', async (req, res) => {
  try {
    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const exclude = req.query.exclusion !== 'include'
    const viewBy = VIEW_BY.includes(req.query.viewBy) ? req.query.viewBy : 'club'
    const clubNumbers = slugs.map(s => CLUB_BY_SLUG[s].clubNumber)

    const cacheKey = ['analytics:past-due', slugs.slice().sort().join('+'), exclude, viewBy].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const skipList = await getSkipList()
      const [raw, totals] = await Promise.all([
        loadPastDue(clubNumbers),
        loadMemberBase(clubNumbers, skipList),
      ])

      // Applied to the numerator as well as the denominator. Someone who does
      // not count as a member cannot be a member who is past due, and letting
      // them into one side but not the other would make "% of members past
      // due" compare two different populations.
      let notCounted = 0
      const members = raw.filter(m => {
        if (!isChaseable(m)) return false
        if (exclude && skipList.has((m.membership_type || '').toLowerCase())) return false
        if (m.counts_as_member === false) { notCounted += 1; return false }
        return true
      })

      const report = buildPastDue(members, totals, {
        viewBy,
        clubNameFor: (n) => CLUB_BY_NUMBER[n]?.name || n,
      })

      // The worst balances, for a call list. Capped, and the cap is reported
      // rather than left as a silent truncation.
      const TOP = 100
      const worst = members.slice(0, TOP).map(m => ({
        memberId: m.member_id,
        name: [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Unknown',
        club: CLUB_BY_NUMBER[m.club_number]?.name || m.club_number,
        status: m.member_status,
        membershipType: m.membership_type,
        paymentMethod: m.agreement_payment_method,
        email: m.email || null,
        phone: m.mobile_phone || m.primary_phone || null,
        pastDue: Number(m.past_due_balance) || 0,
        lateFees: Number(m.late_fee_amount) || 0,
        totalOwed: Number(m.total_past_due_balance) || 0,
        memberSince: m.since_date,
      }))

      return {
        ...report,
        worst,
        meta: {
          clubs: slugs,
          exclusion: exclude ? 'exclude' : 'include',
          excludedStatuses: [...EXCLUDED_STATUSES].sort(),
          pastDueRowsBeforeStatusFilter: raw.length,
          // Dormant insurance-plan members carrying a balance. Excluded as
          // members, but reported so the debt is not silently invisible.
          notCountedAsMembers: notCounted,
          worstListCap: TOP,
          worstListTruncated: members.length > TOP,
        },
      }
    })

    res.json(payload)
  } catch (err) {
    console.error('[analytics/past-due] error:', err.message)
    res.status(500).json({ error: 'Failed to build past due report' })
  }
})

module.exports = router

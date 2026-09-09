const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { getSkipList } = require('../utils/membershipSkipList')
const { parseCategory, parseBasis, filterNote, matchesFilters, loadCategoryMap } = require('../lib/analyticsMemberFilters')
const { monthToDate, windowLabel, priorMonthWindow, priorLabel } = require('../lib/snapshotWindow')
const { CLUBS, CLUB_BY_SLUG, isExcludedType } = require('../lib/salespersonPerformance')
const {
  buildAttritionAnalysis, isInsuranceType, LOST_STATUSES,
} = require('../lib/attritionAnalysis')

// ---------------------------------------------------------------------------
// Attrition Analysis — Analytics (corporate+)
//
// The old Reporting view's Cancels report, rebuilt: who left, what they were
// on, how long they lasted, who sold them, and what is queued to leave next.
//
// See lib/attritionAnalysis for why this total can sit above Club Snapshot's
// Left, and why the insurance split is the reason.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate'))

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 30 * 60 * 1000
const SERIES_MONTHS = 13

// PostgREST caps how long an `in` list may be, and a busy quarter of losses is
// well past a few hundred members.
const CHUNK = 200

const MEMBER_FIELDS =
  'first_name, last_name, member_id, membership_type, agreement_number, member_status, ' +
  // is_primary_member is here for the agreements basis; without it the filter
  // would silently keep everybody.
  'member_status_date, sales_person_name, since_date, club_number, is_primary_member'

/** First day of the month `back` months before `iso`. */
function monthStart(iso, back = 0) {
  const d = new Date(`${String(iso).slice(0, 7)}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() - back)
  return d.toISOString().slice(0, 10)
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
    const clubNumbers = allClubs ? null : slugs.map(s => CLUB_BY_SLUG[s].clubNumber)
    const exclude = req.query.exclusion !== 'include'
    const category = parseCategory(req.query.category)
    const basis = parseBasis(req.query.basis)

    // The same window one month back, day-of-month clamped to the shorter
    // month. Shared with the Snapshot reports so "vs last month" means the same
    // thing everywhere it is written.
    const prior = priorMonthWindow(start, end)

    const cacheKey = [
      'analytics:attrition-analysis', start, end, slugs.slice().sort().join('+'), exclude,
      category, basis,
    ].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const skip = await getSkipList()
      const categoryMap = await loadCategoryMap(supabaseAdmin)
      // Both exclusions compose: the skip list answers "is this a member at
      // all", the category and basis answer "is this the kind of member being
      // asked about". Applied in one predicate so the window rows, the
      // thirteen-month series and the pending queue can never disagree.
      const keep = r =>
        (!exclude || !isExcludedType(r.membership_type, skip))
        && matchesFilters(r, { category, basis, categoryMap })

      const scoped = (q) => (clubNumbers ? q.in('club_number', clubNumbers) : q)

      // The thirteen-month series is one scan, not thirteen: the rows carry
      // their own status date, so the months fall out of a single list.
      const seriesStart = monthStart(end, SERIES_MONTHS - 1)

      const [windowRows, priorRows, seriesRows, pendingRows] = await Promise.all([
        fetchAll(scoped(supabaseAdmin.from('abc_members')
          .select(MEMBER_FIELDS)
          .in('member_status', LOST_STATUSES)
          .gte('member_status_date', start)
          .lte('member_status_date', end))),
        // The prior window, fetched alongside rather than after: it is the same
        // query over a shifted range, and two round trips in series would
        // double the wait for a card that is read at a glance.
        fetchAll(scoped(supabaseAdmin.from('abc_members')
          .select(MEMBER_FIELDS)
          .in('member_status', LOST_STATUSES)
          .gte('member_status_date', prior.start)
          .lte('member_status_date', prior.end))),
        fetchAll(scoped(supabaseAdmin.from('abc_members')
          .select('membership_type, member_status_date, is_primary_member')
          .in('member_status', LOST_STATUSES)
          .gte('member_status_date', seriesStart)
          .lte('member_status_date', end))),
        // The queue: still active, already scheduled to end. Not a cancel yet,
        // which is exactly why it is worth seeing.
        fetchAll(scoped(supabaseAdmin.from('abc_members')
          .select(MEMBER_FIELDS)
          .eq('member_status', 'Pending Cancel')
          .eq('is_active', true))),
      ])

      const byMonth = new Map()
      for (const r of seriesRows.filter(keep)) {
        if (!r.member_status_date) continue
        const m = `${String(r.member_status_date).slice(0, 7)}-01`
        const cur = byMonth.get(m) || { month: m, count: 0, insurance: 0, membership: 0 }
        cur.count += 1
        if (isInsuranceType(r.membership_type)) cur.insurance += 1
        else cur.membership += 1
        byMonth.set(m, cur)
      }
      // Every month in the span, so a month with no cancels draws a zero rather
      // than closing the gap and implying it never happened.
      const monthly = []
      for (let i = SERIES_MONTHS - 1; i >= 0; i--) {
        const m = monthStart(end, i)
        monthly.push(byMonth.get(m) || { month: m, count: 0, insurance: 0, membership: 0 })
      }

      const kept = windowRows.filter(keep)

      // Why they cancelled, from Click2Save. Fetched for THESE members rather
      // than for a date range: a member who requested cancellation in one month
      // and ended in the next still gave their reason, and a range on the event
      // would lose them.
      const memberIds = [...new Set(kept.map(r => String(r.member_id)).filter(Boolean))]
      const events = []
      for (let i = 0; i < memberIds.length; i += CHUNK) {
        events.push(...(await fetchAll(supabaseAdmin
          .from('click2save_events_expanded')
          .select('member_id, cancel_reason, cancel_code, occurred_at')
          .eq('request_type', 'CANCEL')
          .in('member_id', memberIds.slice(i, i + CHUNK)))))
      }

      // The most recent cancel request per member. A member who joined, left,
      // came back and left again has two, and the one that ended the membership
      // this report is looking at is the later one.
      const reasons = {}
      const seenAt = {}
      for (const e of events) {
        const reason = e.cancel_reason || e.cancel_code
        if (!reason) continue
        const at = String(e.occurred_at || '')
        const id = String(e.member_id)
        if (!seenAt[id] || at > seenAt[id]) {
          seenAt[id] = at
          reasons[id] = reason
        }
      }

      return {
        rows: kept,
        priorRows: priorRows.filter(keep),
        pending: pendingRows.filter(keep),
        monthly,
        reasons,
      }
    })

    const built = buildAttritionAnalysis(payload.rows, payload.pending, {
      monthly: payload.monthly,
      reasonByMember: new Map(Object.entries(payload.reasons || {})),
      priorRows: payload.priorRows,
      comparisonLabel: priorLabel(start, end),
    })

    res.json({
      ...built,
      meta: {
        filter: filterNote({ category, basis }),
        start, end,
        priorStart: prior.start, priorEnd: prior.end,
        windowLabel: windowLabel(start, end),
        comparisonLabel: priorLabel(start, end),
        clubs: slugs,
        seriesMonths: SERIES_MONTHS,
        exclusion: exclude ? 'exclude' : 'include',
      },
    })
  } catch (err) {
    console.error('[analytics/attrition-analysis] error:', err.message)
    res.status(500).json({ error: 'Failed to build attrition analysis' })
  }
})

module.exports = router

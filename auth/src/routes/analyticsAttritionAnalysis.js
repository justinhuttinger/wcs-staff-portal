const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { getSkipList } = require('../utils/membershipSkipList')
const { monthToDate, windowLabel } = require('../lib/snapshotWindow')
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

const MEMBER_FIELDS =
  'first_name, last_name, member_id, membership_type, agreement_number, member_status, ' +
  'member_status_date, sales_person_name, since_date, club_number'

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

    const cacheKey = [
      'analytics:attrition-analysis', start, end, slugs.slice().sort().join('+'), exclude,
    ].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const skip = await getSkipList()
      const keep = r => !exclude || !isExcludedType(r.membership_type, skip)

      const scoped = (q) => (clubNumbers ? q.in('club_number', clubNumbers) : q)

      // The thirteen-month series is one scan, not thirteen: the rows carry
      // their own status date, so the months fall out of a single list.
      const seriesStart = monthStart(end, SERIES_MONTHS - 1)

      const [windowRows, seriesRows, pendingRows] = await Promise.all([
        fetchAll(scoped(supabaseAdmin.from('abc_members')
          .select(MEMBER_FIELDS)
          .in('member_status', LOST_STATUSES)
          .gte('member_status_date', start)
          .lte('member_status_date', end))),
        fetchAll(scoped(supabaseAdmin.from('abc_members')
          .select('membership_type, member_status_date')
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

      return {
        rows: windowRows.filter(keep),
        pending: pendingRows.filter(keep),
        monthly,
      }
    })

    const built = buildAttritionAnalysis(payload.rows, payload.pending, { monthly: payload.monthly })

    res.json({
      ...built,
      meta: {
        start, end,
        windowLabel: windowLabel(start, end),
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

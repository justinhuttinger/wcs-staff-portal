const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { monthToDate, priorMonthWindow, priorLabel, windowLabel } = require('../lib/snapshotWindow')
const { CLUBS, CLUB_BY_SLUG, clubName } = require('../lib/salespersonPerformance')
const { buildSessionFrequency } = require('../lib/ptRosterAnalytics')

// ---------------------------------------------------------------------------
// Session Frequency — Analytics (corporate+)
//
// How often PT clients actually train, this window against the last. The old
// Reporting view's report, rebuilt: completed calendar appointments, per member,
// per week.
//
// PER WEEK RATHER THAN PER WINDOW, because the two windows are rarely the same
// length — month to date on the 3rd is three days against a full prior month,
// and comparing raw counts there says everybody stopped training.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate'))

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 30 * 60 * 1000

const FIELDS =
  'member_id, member_first_name, member_last_name, club_number, ' +
  'employee_first_name, employee_last_name, event_timestamp_local, status, category'

/** Whole and part weeks in a window, inclusive of both ends. */
function weeksIn(start, end) {
  const a = Date.parse(`${start}T00:00:00Z`)
  const b = Date.parse(`${end}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 1
  return Math.max(0.1, ((b - a) / 86400000 + 1) / 7)
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
    const prior = priorMonthWindow(start, end)

    const cacheKey = [
      'analytics:session-frequency', start, end, slugs.slice().sort().join('+'),
    ].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const scoped = q => (clubNumbers ? q.in('club_number', clubNumbers) : q)
      const window = (s, e) => fetchAll(scoped(supabaseAdmin
        .from('abc_calendar_events')
        .select(FIELDS)
        // Completed appointments only. A class is not a PT session, and a
        // cancelled one did not happen — counting either would make the
        // per-week figure something nobody trained.
        .eq('status', 'Completed')
        .eq('category', 'Appointment')
        .gte('event_timestamp_local', `${s}T00:00:00`)
        .lte('event_timestamp_local', `${e}T23:59:59.999`)))

      const [current, priorRows] = await Promise.all([
        window(start, end),
        window(prior.start, prior.end),
      ])
      return { current, prior: priorRows }
    })

    const built = buildSessionFrequency(payload.current, payload.prior, {
      currentWeeks: weeksIn(start, end),
      priorWeeks: weeksIn(prior.start, prior.end),
    })

    const withClub = r => ({ ...r, club: clubName(r.clubNumber) })

    res.json({
      ...built,
      rows: built.rows.map(withClub),
      lapsed: built.lapsed.map(withClub),
      meta: {
        start, end,
        priorStart: prior.start, priorEnd: prior.end,
        windowLabel: windowLabel(start, end),
        comparisonLabel: priorLabel(start, end),
        currentWeeks: Math.round(weeksIn(start, end) * 10) / 10,
        priorWeeks: Math.round(weeksIn(prior.start, prior.end) * 10) / 10,
        clubs: slugs,
      },
    })
  } catch (err) {
    console.error('[analytics/session-frequency] error:', err.message)
    res.status(500).json({ error: 'Failed to build session frequency' })
  }
})

module.exports = router

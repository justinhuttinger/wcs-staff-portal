const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { buildTrainerPerformance } = require('../lib/trainerPerformance')
const { buildTrainerSnapshot } = require('../lib/trainerSnapshot')
const {
  loadPendingDayOnes, summarisePending, pendingForTrainer, pendingList,
} = require('../lib/dayOnePending')
const { monthToDate, priorMonthWindow, priorLabel, windowLabel } = require('../lib/snapshotWindow')
const { CLUBS, CLUB_BY_SLUG, CLUB_BY_NUMBER } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Trainer Snapshot — Analytics (corporate+)
//
// One trainer at a time, month to date by default, with the SAME window a month
// earlier beside it and a month-by-month trend underneath.
//
// The stats come from buildTrainerPerformance — the very function behind the
// Trainer Performance table — rather than being recomputed, so the snapshot and
// the table can never disagree. That carries the attribution split with it:
// sessions and clients belong to whoever DELIVERED them, PT Close Amount to
// whoever the COMMISSION was paid to.
// ---------------------------------------------------------------------------

/** Club name from a club number, tolerating the zero padding revenue rows use. */
function clubNameFor(n) {
  const raw = String(n ?? '')
  const hit = CLUB_BY_NUMBER[raw] || CLUB_BY_NUMBER[raw.replace(/^0+/, '')]
  return hit ? hit.name : raw
}

const router = Router()
router.use(authenticate)
router.use(requireRole('corporate'))

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 30 * 60 * 1000
const SERIES_MONTHS = 13

// Must match the key migration 150 builds, or every merge below misses.
const norm = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase()

async function windowRows(start, end, clubNumbers) {
  const args = { p_start: start, p_end: end, p_clubs: clubNumbers }
  const [rows, totals, breakdown, pendingRows] = await Promise.all([
    fetchAll(supabaseAdmin.rpc('analytics_trainer_performance', args)),
    supabaseAdmin.rpc('analytics_trainer_performance_totals', args),
    // The recurring/paid-in-full split and the loss side, from migration 150.
    // A companion function rather than four more columns on the one above, so
    // migration 144 stays the single definition of who is credited for what.
    fetchAll(supabaseAdmin.rpc('analytics_trainer_pt_breakdown', args)),
    // Keyed on the appointment date. buildTrainerPerformance merges it per
    // trainer and adds a row for anyone whose only mark on the window is an
    // un-closed intro, which is the person this metric exists to find.
    loadPendingDayOnes(clubNumbers, start, end),
  ])
  if (totals.error) throw new Error(totals.error.message)

  const report = buildTrainerPerformance(rows, (totals.data || [])[0] || null, {
    clubNameFor,
    pending: summarisePending(pendingRows),
  })
  // Carried through so the chosen trainer's own chase list can be cut from it
  // without a second fetch.
  report.pendingRows = pendingRows
  const byKey = new Map((breakdown || []).map(b => [b.trainer_key, b]))

  // Merged onto the row rather than carried alongside it, so the snapshot reads
  // every stat from one object. A trainer with no PT activity keeps zeroes: the
  // breakdown only lists people who sold or lost something.
  for (const row of report.rows || []) {
    const b = byKey.get(norm(row.trainer)) || {}
    row.closeAmountRs = Math.round(Number(b.close_amount_rs || 0) * 100) / 100
    row.closeAmountPif = Math.round(Number(b.close_amount_pif || 0) * 100) / 100
    row.lostClients = Number(b.lost_count || 0)
    row.lostValue = Math.round(Number(b.lost_value || 0) * 100) / 100
    row.netValue = Math.round((Number(row.closeAmount || 0) - Number(b.lost_value || 0)) * 100) / 100
  }
  return report
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

    const person = String(req.query.person || '').trim()
    const prior = priorMonthWindow(start, end)
    const allClubs = slugs.length === CLUBS.length
    const clubNumbers = allClubs ? null : slugs.map(s => CLUB_BY_SLUG[s].clubNumber)

    const cacheKey = ['analytics:trainer-snapshot', start, end, slugs.slice().sort().join('+')].join('|')

    // Both windows cached independently of the chosen trainer, so flipping
    // between people costs nothing.
    const base = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const [current, priorReport] = await Promise.all([
        windowRows(start, end, clubNumbers),
        windowRows(prior.start, prior.end, clubNumbers),
      ])
      return { current, prior: priorReport }
    })

    const people = (base.current.rows || [])
      .map(r => r.trainer)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))

    // NO DEFAULT PERSON. A snapshot that opens on whoever happens to top the
    // list invites reading someone else's numbers as your own; the report waits
    // to be asked.
    const chosen = person || null
    const compare = String(req.query.compare || '').trim() || null

    const rowIn = (report, who) =>
      (report.rows || []).find(r => norm(r.trainer) === norm(who)) || null

    // Comparison is EITHER another trainer over the same window, or the same
    // trainer a month earlier. Never both.
    const comparison = compare
      ? { label: compare, person: compare, row: rowIn(base.current, compare) }
      : { label: priorLabel(start, end), person: null, row: rowIn(base.prior, chosen) }

    // The monthly series needs the same two extra measures merged in by month,
    // or the trend panels for them would be flat at zero.
    const seriesFor = async (who) => {
      if (!who) return []
      const seriesArgs = { p_end: end, p_months: SERIES_MONTHS, p_clubs: clubNumbers, p_person: who }
      const [months, extra] = await Promise.all([
        fetchAll(supabaseAdmin.rpc('analytics_trainer_monthly', seriesArgs)),
        fetchAll(supabaseAdmin.rpc('analytics_trainer_pt_breakdown_monthly', seriesArgs)),
      ])
      const byMonth = new Map((extra || []).map(e => [String(e.month_start).slice(0, 10), e]))
      // Pending per month, over the same 13 months the series covers. One call
      // for the whole span rather than one per month: the rows carry their own
      // scheduled_date, so the buckets fall out of a single list.
      const seriesStart = String(((months || [])[0] || {}).month_start || '').slice(0, 10)
      const pendingByMonth = new Map()
      if (seriesStart) {
        const rows = pendingForTrainer(
          await loadPendingDayOnes(clubNumbers, seriesStart, end), who
        )
        for (const r of rows) {
          const m = String(r.scheduled_date).slice(0, 7) + '-01'
          pendingByMonth.set(m, (pendingByMonth.get(m) || 0) + 1)
        }
      }
      return (months || []).map(m => {
        const key = String(m.month_start).slice(0, 10)
        return {
          ...m,
          ...(byMonth.get(key) || {}),
          day_ones_pending: pendingByMonth.get(key) || 0,
        }
      })
    }

    const [series, compareSeries] = await Promise.all([
      seriesFor(chosen),
      seriesFor(compare),
    ])

    const chosenPending = chosen
      ? pendingForTrainer(base.current.pendingRows, chosen)
      : []

    const built = buildTrainerSnapshot(rowIn(base.current, chosen), comparison, series, {
      person: chosen,
      pending: chosen
        ? { ...summarisePending(chosenPending), list: pendingList(chosenPending) }
        : null,
    })

    res.json({
      ...built,
      people,
      compareSeries: compare
        ? buildTrainerSnapshot(rowIn(base.current, compare), null, compareSeries, { person: compare }).series
        : [],
      meta: {
        start, end,
        priorStart: prior.start, priorEnd: prior.end,
        windowLabel: windowLabel(start, end),
        comparisonLabel: comparison.label,
        clubs: slugs,
        seriesMonths: SERIES_MONTHS,
        anchoredOn: isDate(req.query.start) ? 'request' : 'month to date',
      },
    })
  } catch (err) {
    console.error('[analytics/trainer-snapshot] error:', err.message)
    res.status(500).json({ error: 'Failed to build trainer snapshot' })
  }
})

module.exports = router

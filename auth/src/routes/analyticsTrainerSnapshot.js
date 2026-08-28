const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { buildTrainerPerformance } = require('../lib/trainerPerformance')
const { buildTrainerSnapshot } = require('../lib/trainerSnapshot')
const { monthToDate, priorMonthWindow, priorLabel, windowLabel } = require('../lib/snapshotWindow')
const { CLUBS, CLUB_BY_SLUG, CLUB_BY_NUMBER } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Trainer Snapshot — Analytics (admin only)
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
router.use(requireRole('admin'))

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 30 * 60 * 1000
const SERIES_MONTHS = 13

const norm = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase()

async function windowRows(start, end, clubNumbers) {
  const args = { p_start: start, p_end: end, p_clubs: clubNumbers }
  const [rows, totals] = await Promise.all([
    fetchAll(supabaseAdmin.rpc('analytics_trainer_performance', args)),
    supabaseAdmin.rpc('analytics_trainer_performance_totals', args),
  ])
  if (totals.error) throw new Error(totals.error.message)
  return buildTrainerPerformance(rows, (totals.data || [])[0] || null, { clubNameFor })
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

    const seriesFor = (who) => (who
      ? fetchAll(supabaseAdmin.rpc('analytics_trainer_monthly', {
        p_end: end,
        p_months: SERIES_MONTHS,
        p_clubs: clubNumbers,
        p_person: who,
      }))
      : Promise.resolve([]))

    const [series, compareSeries] = await Promise.all([
      seriesFor(chosen),
      seriesFor(compare),
    ])

    const built = buildTrainerSnapshot(rowIn(base.current, chosen), comparison, series, { person: chosen })

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

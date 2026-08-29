const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { buildCompliance } = require('../lib/complianceAnalytics')
const { monthToDate, priorMonthWindow, priorLabel, windowLabel } = require('../lib/snapshotWindow')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Compliance — Analytics (admin only)
//
// Operational compliance from operandio_api_jobs, with the old report's
// definitions kept exactly: a job is judged once it is done or past due, and
// pending / in_progress jobs are NOT YET DUE and stay out of every rate. That
// is the same rule Problem Areas needed in #740.
//
// THE COMPANY AVERAGE IS NOT THE STORY. Six clubs sit between 72% and 87% task
// completion and one sits at 3.8%, which drags the pooled figure to 56%. The
// median travels beside the pooled number and outliers are named on the report.
//
// The trend is a fixed TRAILING 13 MONTHS, like Check-ins: a month-to-date
// selection would otherwise draw a one-point line.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000
const TREND_MONTHS = 13

function trendStart(endDate, months) {
  const d = new Date(`${endDate}T00:00:00Z`)
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - (months - 1))
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
    const clubSlugs = allClubs ? null : slugs

    const prior = priorMonthWindow(start, end)
    const tStart = trendStart(end, TREND_MONTHS)

    const cacheKey = ['analytics:compliance', start, end, slugs.slice().sort().join('+')].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const [monthly, priorMonthly, trendMonthly, processes, dow, syncState, byJob, byPerson, byDate] = await Promise.all([
        fetchAll(supabaseAdmin.rpc('analytics_compliance_monthly', {
          p_start: start, p_end: end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_compliance_monthly', {
          p_start: prior.start, p_end: prior.end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_compliance_monthly', {
          p_start: tStart, p_end: end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_compliance_by_process', {
          p_start: start, p_end: end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_compliance_by_dow', {
          p_start: start, p_end: end, p_clubs: clubSlugs,
        })),
        // A stale feed looks exactly like a club that stopped doing its work,
        // so the report shows when each club last synced.
        fetchAll(supabaseAdmin.from('operandio_api_sync_state')
          .select('location_slug,last_success_at,last_error')),
        // The three slices from migration 167: is this checklist getting done,
        // who is participating, and what happened on a given day.
        fetchAll(supabaseAdmin.rpc('analytics_compliance_by_job', {
          p_start: start, p_end: end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_compliance_by_person', {
          p_start: start, p_end: end, p_clubs: clubSlugs,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_compliance_by_date', {
          p_start: start, p_end: end, p_clubs: clubSlugs,
        })),
      ])
      return { monthly, priorMonthly, trendMonthly, processes, dow, syncState, byJob, byPerson, byDate }
    })

    const built = buildCompliance(payload.monthly, payload.processes, payload.dow, {
      priorMonthly: payload.priorMonthly,
      trendMonthly: payload.trendMonthly,
      syncState: payload.syncState,
    })

    res.json({
      ...built,
      // Passed straight through: these are already the shape the view needs and
      // reshaping them in the builder would only add a place to disagree.
      byJob: (payload.byJob || []).map(r => ({
        name: r.name, slug: r.slug,
        decided: Number(r.decided) || 0,
        completed: Number(r.completed) || 0,
        missed: Number(r.missed) || 0,
        taskPct: r.task_pct === null || r.task_pct === undefined ? null : Number(r.task_pct),
      })),
      byPerson: (payload.byPerson || []).map(r => ({
        person: r.person,
        jobsTouched: Number(r.jobs_touched) || 0,
        stepsDone: Number(r.steps_done) || 0,
        daysActive: Number(r.days_active) || 0,
        clubs: r.clubs,
      })),
      byDate: (payload.byDate || []).map(r => ({
        date: String(r.job_date).slice(0, 10),
        decided: Number(r.decided) || 0,
        completed: Number(r.completed) || 0,
        missed: Number(r.missed) || 0,
        notYetDue: Number(r.not_yet_due) || 0,
        taskPct: r.task_pct === null || r.task_pct === undefined ? null : Number(r.task_pct),
      })),
      meta: {
        start, end,
        priorStart: prior.start, priorEnd: prior.end,
        trendStart: tStart, trendMonths: TREND_MONTHS,
        windowLabel: windowLabel(start, end),
        comparisonLabel: priorLabel(start, end),
        clubs: slugs,
        anchoredOn: isDate(req.query.start) ? 'request' : 'month to date',
      },
    })
  } catch (err) {
    console.error('[analytics/compliance] error:', err.message)
    res.status(500).json({ error: 'Failed to build compliance' })
  }
})

module.exports = router

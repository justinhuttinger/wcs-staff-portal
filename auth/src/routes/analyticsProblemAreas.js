const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { getSkipList } = require('../utils/membershipSkipList')
const { buildReport } = require('../lib/salespersonPerformance')
const { loadSalespersonWindow } = require('../lib/salespersonData')
const { buildProblemAreas, opsJobPct } = require('../lib/problemAreas')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Problem Areas — Analytics (admin only)
//
// States what is wrong and WHOSE it is, against thresholds set in Admin >
// Problem Thresholds. Every other report answers a question you have to think
// to ask; this one does the asking.
//
// PEOPLE ONLY. A club figure is an average of the people in it, and averages
// are what the other reports are for.
//
// A TRAILING WINDOW, NOT MONTH TO DATE. Run on the 2nd of the month, a
// month-to-date report judges every club on two days of data and either cries
// wolf or abstains entirely. Thirty days is enough to mean something on any day
// of the month.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 30 * 60 * 1000
const DEFAULT_DAYS = 30

// club_salesperson gives BOTH: a row per person, and enough to pool per club.
// Pooling from these rows rather than running buildReport twice keeps the club
// figure and the staff figures arithmetically consistent by construction.
const CLUB_FILTERS = {
  viewBy: 'club_salesperson',
  membershipType: null, entrySource: null, gender: null, ageGroup: null,
  paymentFrequency: null, term: null, relationship: null, exclusion: 'exclude',
}

/** The `problem_` settings from app_config, as a flat map. */
async function loadSettings() {
  // Matched on 'problem%' and narrowed in JS rather than on an escaped
  // 'problem\_%'. An underscore is a single-character wildcard in LIKE, so the
  // pattern needs escaping — and if that escape were not passed through intact
  // the filter would match NOTHING, every threshold would silently fall back to
  // its default, and the Admin tile would appear to save while changing
  // nothing. Filtering here removes that failure mode entirely.
  const rows = await fetchAll(
    supabaseAdmin.from('app_config').select('key, value').like('key', 'problem%')
  )
  return Object.fromEntries(
    (rows || [])
      .filter(r => typeof r.key === 'string' && r.key.startsWith('problem_'))
      .map(r => [r.key, r.value])
  )
}

router.get('/', async (req, res) => {
  try {
    const daysRaw = Number(req.query.days)
    const days = Number.isFinite(daysRaw) ? Math.min(120, Math.max(7, Math.round(daysRaw))) : DEFAULT_DAYS

    const end = new Date()
    const start = new Date(end.getTime() - days * 86400000)
    const iso = d => d.toISOString().slice(0, 10)
    const startISO = iso(start)
    const endISO = iso(end)

    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    const clubNumbers = slugs.map(s => CLUB_BY_SLUG[s].clubNumber)
    const cacheKey = ['analytics:problem-areas', days, slugs.slice().sort().join('+')].join('|')

    const gathered = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const skipList = await getSkipList()

      const [window, dayOnes, openForms, ops] = await Promise.all([
        loadSalespersonWindow(clubNumbers, slugs, startISO, endISO),

        // Close rate, by the SAME predicates PT Snapshot uses: completed on the
        // appointment date, sold where the outcome says so. Queried directly
        // rather than through analytics_pt_snapshot because that returns one
        // pooled row and this needs a row per club.
        fetchAll(
          supabaseAdmin.from('day_one_appointments')
            .select('location_slug, trainer_name, status, outcome')
            .gte('scheduled_date', startISO)
            .lte('scheduled_date', endISO)
            .in('location_slug', slugs)
        ),

        // Day Ones whose date has passed with no outcome recorded, WITHIN THE
        // WINDOW. An all-time count answers "how much has ever piled up", which
        // never improves however hard a club works this month; windowing it
        // makes the number something a manager can actually move.
        fetchAll(
          supabaseAdmin.from('day_one_appointments')
            .select('location_slug, trainer_name, status, outcome, scheduled_date')
            .gte('scheduled_date', startISO)
            .lt('scheduled_date', endISO)
            .in('location_slug', slugs)
        ),

        fetchAll(
          supabaseAdmin.from('operandio_api_jobs')
            .select('id, location_slug, display_name, percent_complete, skip_reason')
            .gte('job_date', startISO)
            .lte('job_date', endISO)
            .in('location_slug', slugs)
        ),
      ])

      // Who actually touched each below-standard job. completed_by on the JOB
      // is only set once a job completes, so on a job that did not complete it
      // is always null — the names have to come from the steps.
      const opsIds = ops.filter(j => !j.skip_reason).map(j => j.id)
      const steps = opsIds.length
        ? await fetchAll(
            supabaseAdmin.from('operandio_api_job_steps')
              .select('job_id, completed_by')
              .in('job_id', opsIds)
              .not('completed_by', 'is', null)
          )
        : []

      return { window, dayOnes, openForms, ops, steps, skipList }
    })

    // Loaded before the folds below, which need the per-job completion bar.
    const settings = await loadSettings()

    const report = buildReport(
      gathered.window.members, gathered.window.dayOnes, gathered.window.contactsById,
      CLUB_FILTERS, gathered.skipList,
      { vips: gathered.window.vips, tours: gathered.window.tours }
    )

    // --- fold the raw rows into per-club and per-person metrics -----------
    //
    // Two tallies keyed the same way, so a club figure is always the sum of the
    // people in it rather than a separately computed number that can disagree.
    const norm = v => String(v || '').trim().replace(/\s+/g, ' ')
    let formsUnowned = 0

    const staffTally = new Map()
    const bump = (map, key, group, field, by = 1) => {
      const c = map.get(key) || {}
      c[group] = c[group] || {}
      c[group][field] = (c[group][field] || 0) + by
      map.set(key, c)
    }

    for (const d of gathered.dayOnes) {
      const trainer = norm(d.trainer_name)
      const staffKey = trainer ? `${d.location_slug}|${trainer}` : null
      if (!staffKey) continue
      if (d.status === 'completed') bump(staffTally, staffKey, 'close', 'completed')
      if (d.outcome === 'Sale') bump(staffTally, staffKey, 'close', 'sold')
    }

    for (const d of gathered.openForms) {
      // Past its date and never closed out: still 'scheduled', or marked
      // completed with nobody recording what happened.
      const open = d.status === 'scheduled' || (d.status === 'completed' && !d.outcome)
      if (!open) continue
      const trainer = norm(d.trainer_name)
      // A form with no trainer on it cannot be laid at anybody's door. Counted
      // so the report can say how many went unattributed rather than dropping
      // them without a word.
      if (trainer) bump(staffTally, `${d.location_slug}|${trainer}`, 'open', 'n')
      else formsUnowned++
    }

    // --- operational jobs, per job and per person -------------------------
    //
    // A job below the completion bar is flagged, and attributed to whoever
    // actually worked it. A job NOBODY touched has no owner to name, so it
    // stays at club level — 489 of 575 below-standard jobs in a 30-day window
    // were never started, and pinning those on whoever happened to be assigned
    // would blame people for work that was never picked up.
    const jobBar = opsJobPct(settings)
    const workersByJob = new Map()
    for (const st of gathered.steps || []) {
      const who = norm(st.completed_by)
      if (!who) continue
      const set = workersByJob.get(st.job_id) || new Set()
      set.add(who)
      workersByJob.set(st.job_id, set)
    }

    let opsUnowned = 0
    let opsBelowTotal = 0
    for (const j of gathered.ops) {
      if (j.skip_reason) continue
      const below = Number(j.percent_complete ?? 0) < jobBar
      if (!below) continue
      opsBelowTotal++
      const workers = [...(workersByJob.get(j.id) || [])]
      if (workers.length === 0) {
        opsUnowned++
        continue
      }
      // Several people can have worked one job. Each is named, because the job
      // is below standard whoever left it there.
      for (const who of workers) {
        bump(staffTally, `${j.location_slug}|${who}`, 'ops', 'below')
        bump(staffTally, `${j.location_slug}|${who}`, 'ops', 'due')
      }
    }

    const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null)

    // --- per-person subjects ----------------------------------------------
    const staff = []

    // Membership: one row per salesperson, straight off buildReport.
    for (const r of report.rows || []) {
      if (!r.salesperson || !r.clubSlug) continue
      staff.push({
        slug: r.clubSlug,
        club: CLUB_BY_SLUG[r.clubSlug]?.name || r.clubSlug,
        name: r.salesperson,
        department: 'Membership',
        metrics: {
          dayone_book_pct: {
            value: r.dayOneBookPct ?? null,
            sample: r.newMemberUnits || 0,
            numerator: r.dayOneBookCount ?? null,
          },
          vip_pct: {
            value: r.vipPct ?? null,
            sample: r.newMemberUnits || 0,
            numerator: r.vipCount ?? null,
          },
        },
      })
    }

    // PT and Operations, from the per-person tallies. One person can appear in
    // both departments; they are separate rows because they answer to different
    // managers for different work.
    for (const [key, t] of staffTally) {
      const [slug, name] = key.split('|')
      const club = CLUB_BY_SLUG[slug]?.name || slug
      const close = t.close || {}
      const ops = t.ops || {}

      if (close.completed || (t.open || {}).n) {
        staff.push({
          slug, club, name, department: 'PT',
          metrics: {
            dayone_close_pct: {
              value: pct(close.sold || 0, close.completed || 0),
              sample: close.completed || 0,
              numerator: close.sold || 0,
            },
            dayone_open_forms: { value: (t.open || {}).n || 0, sample: (t.open || {}).n || 0 },
          },
        })
      }

      if (ops.below) {
        staff.push({
          slug, club, name, department: 'Operations',
          metrics: {
            ops_jobs_below: { value: ops.below, sample: ops.due || 0, numerator: ops.below },
          },
        })
      }
    }

    // No club subjects: every check is staff-scoped now.
    const built = buildProblemAreas([], staff, settings)

    res.json({
      ...built,
      meta: {
        start: startISO, end: endISO, days,
        clubs: slugs,
        staffSubjects: staff.length,
        opsJobPct: jobBar,
        // What could NOT be attributed to a person, and so cannot appear on a
        // people-only report. Returned rather than dropped in silence: 489 of
        // 575 below-standard jobs in a 30-day window were never started by
        // anybody, and an omission that size has to be visible.
        opsUnowned,
        opsBelowTotal,
        formsUnowned,
      },
    })
  } catch (err) {
    console.error('[analytics/problem-areas] error:', err.message)
    res.status(500).json({ error: 'Failed to build problem areas' })
  }
})

module.exports = router

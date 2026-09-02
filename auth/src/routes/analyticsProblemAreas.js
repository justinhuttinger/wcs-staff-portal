const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR, wrap } = require('../services/memoryCache')
const { getSkipList } = require('../utils/membershipSkipList')
const { buildReport } = require('../lib/salespersonPerformance')
const { loadSalespersonWindow } = require('../lib/salespersonData')
const { buildProblemAreas, opsJobPct, isJudgeableJob, jobDay } = require('../lib/problemAreas')
const { attachContactNames } = require('../lib/dayOneContactNames')
const { resolveUntouchedJobs } = require('../lib/shiftCoverage')
const { fetchShiftsOverlapping } = require('../lib/operandioApi')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Problem Areas — Analytics (corporate+)
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
router.use(requireRole('corporate'))

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

      const [window, dayOnes, openForms, opsAll] = await Promise.all([
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
            // contact_name so the drill-down can name WHOSE form is missing.
            // "Four outstanding" is a number; "Jane Doe from 16 August" is a
            // conversation the trainer can actually close out.
            //
            // ghl_contact_id because most Day Ones have no contact_name: the
            // booking widget writes the appointment before anybody types one.
            // 46 of the 66 rows here were showing as "Unnamed member" until
            // this was resolved — see lib/dayOneContactNames.
            .select('location_slug, trainer_name, status, outcome, scheduled_date, contact_name, ghl_contact_id')
            .gte('scheduled_date', startISO)
            .lt('scheduled_date', endISO)
            .in('location_slug', slugs)
        ),

        fetchAll(
          supabaseAdmin.from('operandio_api_jobs')
            // operandio_location_id, available_from and due_at feed the roster
            // pass below. Without them every untouched job resolves to "no
            // location or window" and nobody is ever attributed.
            //
            // job_date was filtered on but never SELECTED, so it arrived
            // undefined and the display date fell back to slicing available_from
            // in UTC — which dates the whole closing shift a day into the future.
            .select('id, job_date, location_slug, display_name, percent_complete, skip_reason, operandio_location_id, available_from, due_at')
            .gte('job_date', startISO)
            .lte('job_date', endISO)
            .in('location_slug', slugs)
        ),
      ])

      // Who actually touched each below-standard job. completed_by on the JOB
      // is only set once a job completes, so on a job that did not complete it
      // is always null — the names have to come from the steps.
      //
      // ONLY THE BELOW-STANDARD JOBS, AND IN CHUNKS. Asking for every job's
      // steps meant an `in` list of 1,728 ids, a URL around 64KB, and a gateway
      // 400 that supabase-js reports as the bare message "Bad Request" — which
      // is precisely how this route broke in production. Filtering to the jobs
      // actually in question cuts it to a few hundred, and chunking keeps the
      // URL bounded however wide the window gets.
      const jobBarForFetch = opsJobPct(await loadSettings())

      // Filtered HERE, above the step fetch, so a job that is not due yet is
      // absent from the score, from the drill-down and from the roster pass
      // alike. Doing it lower down would leave one of the three disagreeing.
      const ops = opsAll.filter(j => isJudgeableJob(j))

      const belowIds = ops
        .filter(j => !j.skip_reason && Number(j.percent_complete ?? 0) < jobBarForFetch)
        .map(j => j.id)

      const steps = []
      const CHUNK = 150
      for (let i = 0; i < belowIds.length; i += CHUNK) {
        const batch = belowIds.slice(i, i + CHUNK)
        steps.push(...await fetchAll(
          supabaseAdmin.from('operandio_api_job_steps')
            .select('job_id, completed_by')
            .in('job_id', batch)
            .not('completed_by', 'is', null)
        ))
      }

      return {
        window, dayOnes, ops, steps, skipList,
        openForms: await attachContactNames(openForms),
      }
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

    // Today in Pacific, for how overdue each outstanding form is. The club's
    // day, not the server's.
    const todayPacific = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
    )
    const daysOverdue = (iso) => {
      const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`)
      if (Number.isNaN(d.getTime())) return null
      return Math.max(0, Math.round((todayPacific - d) / 86400000))
    }

    // The forms behind each trainer's count, so a row opens to show WHOSE
    // outcome is missing rather than only how many are.
    const staffForms = new Map()

    for (const d of gathered.openForms) {
      // Past its date and never closed out: still 'scheduled', or marked
      // completed with nobody recording what happened.
      const open = d.status === 'scheduled' || (d.status === 'completed' && !d.outcome)
      if (!open) continue
      const trainer = norm(d.trainer_name)
      // A form with no trainer on it cannot be laid at anybody's door. Counted
      // so the report can say how many went unattributed rather than dropping
      // them without a word.
      if (trainer) {
        const key = `${d.location_slug}|${trainer}`
        bump(staffTally, key, 'open', 'n')
        const list = staffForms.get(key) || []
        list.push({
          // contact_name is null on a good number of these, so the row still
          // has to read as something rather than as a blank.
          name: d.contact_name || 'Unnamed member',
          date: d.scheduled_date,
          overdue: daysOverdue(d.scheduled_date),
        })
        staffForms.set(key, list)
      } else formsUnowned++
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

    let opsBelowTotal = 0
    const untouched = []
    // The jobs behind each person's count, so a row can be opened to show WHICH
    // checklists were missed rather than only how many.
    const staffJobs = new Map()
    const noteJob = (key, j, via, coverPct = null) => {
      const list = staffJobs.get(key) || []
      list.push({
        name: j.display_name || 'Untitled job',
        pct: Math.round(Number(j.percent_complete ?? 0) * 10) / 10,
        date: jobDay(j),
        // 'worked' — they completed a step on it. 'rostered' — nobody touched
        // it and they were on for coverPct% of the window. Saying which is the
        // difference between a fair conversation and an unfair one.
        via,
        coverPct,
      })
      staffJobs.set(key, list)
    }

    for (const j of gathered.ops) {
      if (j.skip_reason) continue
      const below = Number(j.percent_complete ?? 0) < jobBar
      if (!below) continue
      opsBelowTotal++
      const workers = [...(workersByJob.get(j.id) || [])]
      if (workers.length === 0) {
        // Nobody touched a step, so there is no name on the work itself. Held
        // back for the roster pass below rather than written off.
        untouched.push(j)
        continue
      }
      // Several people can have worked one job. Each is named, because the job
      // is below standard whoever left it there.
      for (const who of workers) {
        const key = `${j.location_slug}|${who}`
        bump(staffTally, key, 'ops', 'below')
        bump(staffTally, key, 'ops', 'due')
        // 'worked' — this person actually completed a step on it.
        noteJob(key, j, 'worked')
      }
    }

    // --- jobs nobody touched, resolved against the roster ------------------
    //
    // A job with no completed step has no name on the work. Asking Operandio
    // who was ROSTERED over the window it was open puts a name back on most of
    // them: 489 of 575 below-standard jobs in a 30-day window are in this spot.
    //
    // Evidence, not proof. A rostered shift is not the same as having been
    // handed the job, so the bar is a MAJORITY of the window, and a job with no
    // clear majority stays unattributed rather than being spread across
    // everybody who happened to be in the building.
    const shiftFetch = (locationId, from, to) =>
      // Cached separately and far longer than the report: a past roster does
      // not change, and this is an external API on a page load.
      wrap(
        `operandio:shifts:${locationId}:${from.toISOString()}:${to.toISOString()}`,
        6 * 60 * 60 * 1000,
        () => fetchShiftsOverlapping(locationId, from, to)
      )

    const roster = await resolveUntouchedJobs(untouched, shiftFetch, {
      majorityPct: Number(settings.problem_ops_majority_pct) || undefined,
    })

    for (const j of untouched) {
      const people = roster.attributed.get(j.id)
      if (!people) continue
      for (const p of people) {
        const key = `${j.location_slug}|${p.name}`
        bump(staffTally, key, 'ops', 'below')
        bump(staffTally, key, 'ops', 'due')
        noteJob(key, j, 'rostered', p.pct)
      }
    }

    const opsUnowned = roster.unresolved.length

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
          details: {
            // Oldest first: the one that has been sitting five weeks is the one
            // to ask about, not yesterday's.
            dayone_open_forms: (staffForms.get(key) || [])
              .slice()
              .sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))),
          },
        })
      }

      if (ops.below) {
        staff.push({
          slug, club, name, department: 'Operations',
          metrics: {
            ops_jobs_below: { value: ops.below, sample: ops.due || 0, numerator: ops.below },
          },
          // Newest first: the checklist missed last night matters more than one
          // missed three weeks ago.
          details: {
            ops_jobs_below: (staffJobs.get(key) || [])
              .slice()
              .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
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
        opsByRoster: roster.attributed.size,
        // Why the rest still have nobody's name on them, so "unattributed" is a
        // diagnosis rather than a shrug.
        opsUnownedReasons: roster.unresolved.reduce((acc, u) => {
          acc[u.reason] = (acc[u.reason] || 0) + 1
          return acc
        }, {}),
        opsRosterUnavailable: roster.fetchFailures > 0,
        formsUnowned,
      },
    })
  } catch (err) {
    console.error('[analytics/problem-areas] error:', err.message)
    res.status(500).json({ error: 'Failed to build problem areas' })
  }
})

module.exports = router

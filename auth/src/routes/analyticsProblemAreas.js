const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { getSkipList } = require('../utils/membershipSkipList')
const { buildReport } = require('../lib/salespersonPerformance')
const { loadSalespersonWindow } = require('../lib/salespersonData')
const { buildProblemAreas } = require('../lib/problemAreas')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Problem Areas — Analytics (admin only)
//
// States what is wrong, per club, against thresholds set in Admin > Problem
// Thresholds. Every other report answers a question you have to think to ask;
// this one does the asking.
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

const CLUB_FILTERS = {
  viewBy: 'club',
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
            .select('location_slug, status, outcome')
            .gte('scheduled_date', startISO)
            .lte('scheduled_date', endISO)
            .in('location_slug', slugs)
        ),

        // Day Ones whose date has passed with no outcome recorded. NOT limited
        // to the window: a form left open in March is still open today, and
        // hiding it behind a 30-day view is how 480 of them accumulated.
        fetchAll(
          supabaseAdmin.from('day_one_appointments')
            .select('location_slug, status, outcome, scheduled_date')
            .lt('scheduled_date', endISO)
            .in('location_slug', slugs)
        ),

        fetchAll(
          supabaseAdmin.from('operandio_api_jobs')
            .select('location_slug, completed, skip_reason')
            .gte('job_date', startISO)
            .lte('job_date', endISO)
            .in('location_slug', slugs)
        ),
      ])

      return { window, dayOnes, openForms, ops, skipList }
    })

    const report = buildReport(
      gathered.window.members, gathered.window.dayOnes, gathered.window.contactsById,
      CLUB_FILTERS, gathered.skipList,
      { vips: gathered.window.vips, tours: gathered.window.tours }
    )

    // --- fold the raw rows down to per-club metrics ------------------------
    const tally = new Map()
    const bump = (slug, key, field, by = 1) => {
      const c = tally.get(slug) || {}
      c[key] = c[key] || {}
      c[key][field] = (c[key][field] || 0) + by
      tally.set(slug, c)
    }

    for (const d of gathered.dayOnes) {
      if (d.status === 'completed') bump(d.location_slug, 'close', 'completed')
      if (d.outcome === 'Sale') bump(d.location_slug, 'close', 'sold')
    }
    for (const d of gathered.openForms) {
      // Past its date and never closed out: still 'scheduled', or marked
      // completed with nobody recording what happened.
      const open = d.status === 'scheduled' || (d.status === 'completed' && !d.outcome)
      if (open) bump(d.location_slug, 'open', 'n')
    }
    for (const j of gathered.ops) {
      if (j.skip_reason) continue
      bump(j.location_slug, 'ops', 'due')
      if (j.completed) bump(j.location_slug, 'ops', 'done')
    }

    const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null)

    const clubs = slugs.map(slug => {
      const meta = CLUB_BY_SLUG[slug]
      const row = (report.rows || []).find(r => r.clubSlug === slug) || {}
      const t = tally.get(slug) || {}
      const close = t.close || {}
      const ops = t.ops || {}

      return {
        slug,
        name: meta.name,
        metrics: {
          dayone_book_pct: { value: row.dayOneBookPct ?? null, sample: row.newMemberUnits ?? 0 },
          vip_pct: { value: row.vipPct ?? null, sample: row.newMemberUnits ?? 0 },
          dayone_close_pct: {
            value: pct(close.sold || 0, close.completed || 0),
            sample: close.completed || 0,
          },
          // A count, so its own value is the sample.
          dayone_open_forms: { value: (t.open || {}).n || 0, sample: (t.open || {}).n || 0 },
          ops_pct: { value: pct(ops.done || 0, ops.due || 0), sample: ops.due || 0 },
        },
      }
    })

    const settings = await loadSettings()
    const built = buildProblemAreas(clubs, settings)

    res.json({
      ...built,
      meta: {
        start: startISO, end: endISO, days,
        clubs: slugs,
        // Stated so the reader knows the open-forms count is not windowed.
        openFormsAllTime: true,
      },
    })
  } catch (err) {
    console.error('[analytics/problem-areas] error:', err.message)
    res.status(500).json({ error: 'Failed to build problem areas' })
  }
})

module.exports = router

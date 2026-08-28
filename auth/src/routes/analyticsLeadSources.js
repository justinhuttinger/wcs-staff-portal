const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { buildLeadSources } = require('../lib/leadSources')
const { monthToDate, priorMonthWindow, priorLabel, windowLabel } = require('../lib/snapshotWindow')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Lead Sources — Analytics (admin only)
//
// Where leads come from and what became of them, on FIRST touch: GHL's
// attribution_source rather than last_attribution_source. 15% of contacts
// differ between the two, so the choice is not cosmetic.
//
// Real and claimed attribution are separate views of the same window, never
// blended. Migrations 155-159 hold the bucketing and the funnel.
//
// The funnel counts OPPORTUNITIES in the membership pipelines so it reconciles
// with GHL's own board. Not Interested / Day Pass is ONE combined outcome
// counted per CONTACT, because both delete the opportunity and a guest who
// never became one is not on that board at all — migration 162.
//
// CLUBS COME FROM ghl_locations.slug, not the ABC club number. This is the one
// report whose world is GHL rather than ABC, and the two number things
// differently.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000

const ATTRIBUTIONS = new Set(['real', 'claimed'])

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

    const attribution = ATTRIBUTIONS.has(String(req.query.attribution))
      ? String(req.query.attribution)
      : 'real'

    const prior = priorMonthWindow(start, end)
    const cacheKey = [
      'analytics:lead-sources', start, end, attribution, slugs.slice().sort().join('+'),
    ].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const [rows, priorRows, outcomes, coverage] = await Promise.all([
        fetchAll(supabaseAdmin.rpc('analytics_lead_sources', {
          p_start: start, p_end: end, p_clubs: clubSlugs, p_attribution: attribution,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_lead_sources', {
          p_start: prior.start, p_end: prior.end, p_clubs: clubSlugs, p_attribution: attribution,
        })),
        // Separate call because both outcomes DELETE the opportunity — see
        // migration 160. Folded onto the source rows for display only.
        fetchAll(supabaseAdmin.rpc('analytics_lead_outcomes', {
          p_start: start, p_end: end, p_clubs: clubSlugs, p_attribution: attribution,
        })),
        // Only for the claimed view, and only to describe the window on screen.
        // The old report quoted a fixed "42%" that averaged across the period
        // before the question existed, which read as a broken field rather than
        // a new one.
        attribution === 'claimed'
          ? fetchAll(supabaseAdmin.rpc('analytics_lead_claimed_coverage', {
              p_start: start, p_end: end, p_clubs: clubSlugs,
            }))
          : Promise.resolve([]),
      ])
      return { rows, priorRows, outcomes, coverage: coverage[0] || null }
    })

    const built = buildLeadSources(payload.rows, payload.priorRows, {
      attribution, outcomes: payload.outcomes, coverage: payload.coverage,
    })

    res.json({
      ...built,
      meta: {
        start, end,
        priorStart: prior.start, priorEnd: prior.end,
        windowLabel: windowLabel(start, end),
        comparisonLabel: priorLabel(start, end),
        clubs: slugs,
        attribution,
        anchoredOn: isDate(req.query.start) ? 'request' : 'month to date',
      },
    })
  } catch (err) {
    console.error('[analytics/lead-sources] error:', err.message)
    res.status(500).json({ error: 'Failed to build lead sources' })
  }
})

module.exports = router

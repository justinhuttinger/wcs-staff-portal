const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { narrowClubsToScope } = require('../services/locationScope')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrapSWR } = require('../services/memoryCache')
const { buildLeadSources } = require('../lib/leadSources')
const { monthToDate, priorMonthWindow, priorLabel, windowLabel } = require('../lib/snapshotWindow')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')
const { buildFacebookBreakdown, buildWebTraffic } = require('../lib/leadSourceBreakdowns')
const { ga4 } = require('./googleAnalytics')

// ---------------------------------------------------------------------------
// Lead Sources — Analytics (manager+, club-scoped)
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
router.use(requireRole('manager'))

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000

const ATTRIBUTIONS = new Set(['real', 'claimed'])

const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))

// Window + clubs, shared by the report and its two breakdowns so all three are
// scoped identically. Returns { error, status } when the request can't run.
async function resolveRequest(req) {
  const mtd = monthToDate()
  const start = isDate(req.query.start) ? String(req.query.start) : mtd.start
  const end = isDate(req.query.end) ? String(req.query.end) : mtd.end
  if (start > end) return { status: 400, error: 'start must not be after end' }

  const clubsParam = String(req.query.clubs || 'all')
  const asked = clubsParam === 'all'
    ? CLUBS.map(c => c.slug)
    : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
  if (asked.length === 0) return { status: 400, error: 'no valid clubs requested' }
  // Managers are narrowed to the clubs they are assigned; corporate+ keep what they asked for.
  const slugs = await narrowClubsToScope(req, asked)
  if (slugs.length === 0) return { status: 403, error: 'no access to the requested clubs' }

  const allClubs = slugs.length === CLUBS.length
  return { start, end, slugs, clubSlugs: allClubs ? null : slugs }
}

router.get('/', async (req, res) => {
  try {
    const scope = await resolveRequest(req)
    if (scope.error) return res.status(scope.status).json({ error: scope.error })
    const { start, end, slugs, clubSlugs } = scope

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

// ---------------------------------------------------------------------------
// GET /analytics/lead-sources/facebook
// The Facebook row split into campaign > ad set > ad, same funnel (migration
// 207). Observed attribution only: "claimed Facebook" names no ad.
// ---------------------------------------------------------------------------
router.get('/facebook', async (req, res) => {
  try {
    const scope = await resolveRequest(req)
    if (scope.error) return res.status(scope.status).json({ error: scope.error })
    const { start, end, slugs, clubSlugs } = scope

    const cacheKey = ['analytics:lead-sources:facebook', start, end, slugs.slice().sort().join('+')].join('|')
    const rows = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, () =>
      fetchAll(supabaseAdmin.rpc('analytics_lead_facebook_ads', {
        p_start: start, p_end: end, p_clubs: clubSlugs,
      })))
    res.json({ campaigns: buildFacebookBreakdown(rows), meta: { start, end, clubs: slugs } })
  } catch (err) {
    console.error('[analytics/lead-sources/facebook] error:', err.message)
    res.status(500).json({ error: 'Failed to build the Facebook breakdown' })
  }
})

// ---------------------------------------------------------------------------
// GET /analytics/lead-sources/web-traffic
// GA4 visits by default channel group (Paid Social, Organic Social, Direct,
// Organic Search, ...) for the clubs' pages. Visits, not leads.
//
// East Side (milwaukie) has its own website, outside this GA4 property, so it
// is left out of the page filter and a selection of only that club says so
// instead of reporting a zero.
// ---------------------------------------------------------------------------
const OWN_WEBSITE = new Set(['milwaukie'])

router.get('/web-traffic', async (req, res) => {
  try {
    const scope = await resolveRequest(req)
    if (scope.error) return res.status(scope.status).json({ error: scope.error })
    const { start, end, slugs, clubSlugs } = scope

    const onSite = slugs.filter(s => !OWN_WEBSITE.has(s))
    const meta = { start, end, clubs: slugs, excluded: slugs.filter(s => OWN_WEBSITE.has(s)) }
    if (onSite.length === 0) {
      return res.json({
        unavailable: 'East Side Athletic Club has its own website, which is not in this Google Analytics property.',
        meta,
      })
    }

    const propertyId = await ga4.getPropertyId()
    if (!propertyId) return res.json({ unavailable: 'Google Analytics is not connected.', meta })

    const cacheKey = ['analytics:lead-sources:web', propertyId, start, end, onSite.slice().sort().join('+')].join('|')
    const rows = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, async () => {
      const body = {
        dateRanges: [{ startDate: start, endDate: end }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }, { name: 'keyEvents' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 25,
      }
      // Every club on screen is on the site: no page filter, the whole site.
      const filter = clubSlugs === null ? null : ga4.buildLocationFilter(onSite.join(','))
      if (filter) body.dimensionFilter = filter
      const report = await ga4.runReport(propertyId, body)
      return (report.rows || []).map(r => ({
        channel: r.dimensionValues[0].value,
        sessions: r.metricValues[0].value,
        keyEvents: r.metricValues[1].value,
      }))
    })
    res.json({ ...buildWebTraffic(rows), meta })
  } catch (err) {
    console.error('[analytics/lead-sources/web-traffic] error:', err.message)
    res.status(500).json({ error: 'Failed to load website traffic' })
  }
})

module.exports = router

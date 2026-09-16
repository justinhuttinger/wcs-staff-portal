const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { resolveScopedSlugs } = require('../services/locationScope')
const { parseExcludedCategories } = require('../lib/analyticsMemberFilters')
const { parsePlan } = require('../lib/planType')
const { wrapSWR } = require('../services/memoryCache')
const { loadRecordSet, setKeys, clubNumbersFor, DEFAULT_LIMIT, MAX_LIMIT } = require('../lib/analyticsRecords')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')

// ---------------------------------------------------------------------------
// Records — Analytics (corporate+)
//
// The rows behind a number. Every drillable figure in Analytics calls this with
// a record-set key and the filters already on screen, and gets back the actual
// members, sales or appointments that were counted.
//
// ONE ROUTE FOR ALL OF THEM. The sets live in lib/analyticsRecords, so adding a
// drill-down to a report is a set key at the call site rather than another
// endpoint here. See that file for why the reports' own payloads cannot serve
// this.
//
// Cached like the reports it sits behind: the same click from three people in a
// meeting should cost one query, and these windows do not change minute to
// minute.
//
// WHO CAN CALL IT, AND FOR WHICH CLUBS
//
// This used to be corporate and above, which was right while every caller was
// an Analytics report — those are corporate-only anyway. Club Health, in
// Reporting, is a manager report, and its cards now drill here too.
//
// So the gate is manager, and the clubs are no longer the caller's to choose:
// `clubs` is intersected with the clubs the caller is actually assigned, the
// same resolveScopedSlugs every /reports handler uses. A manager sees their own
// club's rows and nothing else, whatever they put in the query string.
// Corporate and above resolve to no scope and are unaffected.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authenticate)
router.use(requireRole('manager'))

const FRESH_MS = 5 * 60 * 1000
const STALE_MS = 30 * 60 * 1000

const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))

router.get('/', async (req, res) => {
  try {
    const set = String(req.query.set || '')
    if (!setKeys().includes(set)) {
      return res.status(400).json({ error: 'Unknown record set', sets: setKeys() })
    }

    const start = isDate(req.query.start) ? String(req.query.start) : null
    const end = isDate(req.query.end) ? String(req.query.end) : null
    if (!start || !end) return res.status(400).json({ error: 'start and end are required (YYYY-MM-DD)' })
    if (start > end) return res.status(400).json({ error: 'start must not be after end' })

    const clubsParam = String(req.query.clubs || 'all')
    const asked = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (asked.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })

    // A restricted role gets an explicit slug list back and never "all", so an
    // intersection is the whole rule: ask for seven clubs, get the ones you are
    // assigned. An all-club role resolves to null and keeps what it asked for.
    const scoped = await resolveScopedSlugs(req)
    const slugs = scoped.slugs
      ? asked.filter(s => scoped.slugs.includes(s))
      : asked
    // Asked only for clubs they cannot see. An empty list would silently widen
    // to every club further down, so it is refused here instead.
    if (slugs.length === 0) return res.status(403).json({ error: 'no access to the requested clubs' })

    // Trimmed to nothing means "everybody", which is what a club-wide card wants.
    const person = String(req.query.person || '').trim() || null
    // Which side of the row the person is: who ran it, or who booked it.
    const personField = req.query.personField === 'bookedBy' ? 'bookedBy' : 'trainer'
    const filter = String(req.query.filter || '').trim() || null
    // Which date the window applies to. Only day-ones reads it, and only
    // because the reports themselves disagree — see the set for why.
    const window = req.query.window === 'booked' ? 'booked' : 'scheduled'

    // Membership categories unticked on the Reporting page the list was opened
    // from. Parsed by the shared parser, so an unknown value widens.
    const excludedCategories = parseExcludedCategories(req.query.exclude_categories)

    const params = {
      start, end, slugs,
      clubNumbers: clubNumbersFor(slugs),
      person, personField, filter, window, excludedCategories,
      // One plan type (one-year | mtm | pif), or null.
      plan: parsePlan(req.query.plan),
    }

    // The page bounds are deliberately OUT of the cache key: the set is loaded
    // whole and sliced, so paging through a list re-slices the cached rows
    // instead of re-querying for every hundred.
    const cacheKey = [
      'analytics:records', set, start, end,
      slugs.slice().sort().join('+'),
      person || '-', personField, filter || '-', window,
      excludedCategories.slice().sort().join('+') || '-', params.plan || '-',
    ].join('|')

    const payload = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, () => loadRecordSet(set, params))

    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT))
    const offset = Math.max(0, Number(req.query.offset) || 0)

    res.json({
      label: payload.label,
      columns: payload.columns,
      rows: payload.rows.slice(offset, offset + limit),
      total: payload.total,
      offset,
      limit,
      meta: { set, start, end, clubs: slugs, person, filter, window, plan: params.plan },
    })
  } catch (err) {
    console.error('[analytics/records] error:', err.message)
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Failed to load records' })
  }
})

module.exports = router

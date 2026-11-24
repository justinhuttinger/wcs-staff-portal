const { Router } = require('express')
const { ownerOnly } = require('../lib/ownerGate')
const { supabaseAdmin } = require('../services/supabase')
const { fetchAll } = require('../lib/supabaseFetchAll')
const { wrap, wrapSWR } = require('../services/memoryCache')
const { parseCategory, parseBasis, filterNote } = require('../lib/analyticsMemberFilters')
const { CLUBS, CLUB_BY_SLUG } = require('../lib/salespersonPerformance')
const { shiftedWindow, spanDays } = require('../lib/comparisonWindow')
const { monthToDate, windowLabel } = require('../lib/snapshotWindow')
const { latestRevenueDay, clampToRevenueEdge, edgeNote } = require('../lib/revenueDataEdge')
const { buildL10 } = require('../lib/l10Report')

// ---------------------------------------------------------------------------
// L10 — Analytics (OWNER ONLY)
//
// Net Membership plus dues, PT, POS and total revenue, per club, against last
// month or the six-month average. The shaping lives in lib/l10Report.
//
// GATED BY ownerOnly — admin role AND an email on FOLLOW_UPS_EMAILS, the same
// list as the Hub. The portal hides the report with the same list, but hiding
// a menu entry is not a gate; this is.
//
// ONE WINDOW FOR BOTH HALVES. Revenue is imported a day behind, so the window
// is clamped to the last day of revenue — and the membership counts use the
// clamped window too, so the two halves of a row never describe different days.
// ---------------------------------------------------------------------------

const router = Router()
router.use(ownerOnly)

const FRESH_MS = 10 * 60 * 1000
const STALE_MS = 60 * 60 * 1000
const PRIOR_MONTHS = 6

const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))

function slugForClubNumber(n) {
  const raw = String(n ?? '')
  const hit = CLUBS.find(c => c.clubNumber === raw || c.clubNumber === raw.replace(/^0+/, ''))
  return hit ? hit.slug : null
}

router.get('/', async (req, res) => {
  try {
    const mtd = monthToDate()
    const requestedStart = isDate(req.query.start) ? String(req.query.start) : mtd.start
    const requestedEnd = isDate(req.query.end) ? String(req.query.end) : mtd.end
    if (requestedStart > requestedEnd) return res.status(400).json({ error: 'start must not be after end' })

    const clubsParam = String(req.query.clubs || 'all')
    const slugs = clubsParam === 'all'
      ? CLUBS.map(c => c.slug)
      : clubsParam.split(',').map(s => s.trim().toLowerCase()).filter(s => CLUB_BY_SLUG[s])
    if (slugs.length === 0) return res.status(400).json({ error: 'no valid clubs requested' })
    const allClubs = slugs.length === CLUBS.length

    const category = parseCategory(req.query.category)
    const basis = parseBasis(req.query.basis)

    const edge = await latestRevenueDay(supabaseAdmin, wrap)
    const clamp = clampToRevenueEdge(requestedStart, requestedEnd, edge)
    clamp.requestedEnd = requestedEnd
    const start = clamp.start
    const end = clamp.end

    const windows = [{ start, end }]
    for (let k = 1; k <= PRIOR_MONTHS; k++) windows.push(shiftedWindow(start, end, { months: k }))

    const clubNumbers = allClubs ? null : slugs.map(s => CLUB_BY_SLUG[s].clubNumber)
    const revenueClubs = allClubs ? null : slugs

    const cacheKey = ['analytics:l10:v2', start, end, slugs.slice().sort().join('+'), category, basis].join('|')

    const raw = await wrapSWR(cacheKey, FRESH_MS, STALE_MS, () => Promise.all(windows.map(async w => {
      const [membership, revenue, dayOnes] = await Promise.all([
        fetchAll(supabaseAdmin.rpc('analytics_net_membership', {
          p_start: w.start,
          p_end: w.end,
          p_clubs: clubNumbers,
          p_segment: 'club',
          p_exclude: true,
          p_category: category,
          p_basis: basis,
        })),
        fetchAll(supabaseAdmin.rpc('analytics_revenue_by_club', {
          p_start: w.start, p_end: w.end, p_clubs: revenueClubs,
        })),
        // PT Scorecard's own function, so Set / Show / Close here are the
        // numbers that report shows for the same window.
        fetchAll(supabaseAdmin.rpc('analytics_pt_scorecard', {
          p_start: w.start, p_end: w.end, p_clubs: clubNumbers, p_exclude: true,
        })),
      ])
      return { ...w, membership, revenue, dayOnes }
    })))

    const built = buildL10(raw, {
      clubs: slugs.map(s => CLUB_BY_SLUG[s]),
      slugForClubNumber,
    })

    res.json({
      ...built,
      meta: {
        start,
        end,
        requestedEnd,
        clampedToEdge: clamp.clamped,
        noDataYet: clamp.empty,
        spanDays: spanDays(start, end),
        windowLabel: windowLabel(start, end),
        lastMonthStart: windows[1].start,
        lastMonthEnd: windows[1].end,
        avgStart: windows[PRIOR_MONTHS].start,
        avgEnd: windows[1].end,
        clubs: slugs,
        notes: {
          filter: filterNote({ category, basis }),
          dataEdge: edgeNote(clamp),
          compare: 'Comparisons cover the same number of days as this window, shifted back by calendar month. The 6-month average is the mean of the six prior windows and never includes this one.',
          dues: 'Dues Revenue is every dues product: Dues, A2 Exec Dues, First Month, Last Month, Paid In Full, Summer, Corporate, MBO and Gymstr Dues.',
          pos: 'POS Revenue is goods only: Snacks, Drinks, Merchandise and Supplements. Dues and training paid at the desk stay in their own lines.',
          total: 'Total Revenue is every profit center with refunds and chargebacks netted in, so it is not the sum of the lines above it.',
          members: 'Member counts follow Net Membership: new members as of their join date, lost members under the conditional membership rule.',
          dayOnes: 'PT Day Ones match the PT Scorecard. Set: Day Ones scheduled in the window, up to today. Show: of those, completed. Close: of those, a sale on the outcome form or a PT purchase in ABC within 30 days.',
        },
      },
    })
  } catch (err) {
    console.error('[analytics/l10] error:', err.message)
    res.status(500).json({ error: 'Failed to build L10' })
  }
})

// POST /analytics/l10/export-sheet  { title, spec, rows }
//
// Writes the By Club table to a new Google Sheet in the caller's own Drive,
// using the per-user Google connection Payroll's export uses. Two tabs: By Club,
// laid out to look like the report (lib/l10Sheet), and Data, the raw numbers.
//
// THE TABLE COMES FROM THE PAGE, so the sheet is exactly what is on screen —
// same window, same comparison, same clubs, same formatting — rather than a
// second build that could disagree with it. Safe to accept because the route is
// owner only and the file lands in the owner's own Drive; the shape is still
// checked so a bad body is a 400 and not a half-written sheet.
const MAX_ROWS = 200
const MAX_COLS = 120

function validRows(rows) {
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > MAX_ROWS) return false
  return rows.every(r => Array.isArray(r) && r.length <= MAX_COLS && r.every(c =>
    c === null || typeof c === 'string' || (typeof c === 'number' && Number.isFinite(c))))
}

router.post('/export-sheet', async (req, res) => {
  try {
    const { createStyledSpreadsheet } = require('../services/googleSheets')
    const { getStaffGoogleAccessToken } = require('../services/googleUserToken')
    const { buildL10Sheet, validSpec } = require('../lib/l10Sheet')

    const spec = req.body?.spec
    const rows = req.body?.rows
    if (!validSpec(spec)) return res.status(400).json({ error: 'spec is not a valid L10 table' })
    if (!validRows(rows)) return res.status(400).json({ error: 'rows must be a 2D array of strings and numbers' })
    const title = String(req.body?.title || 'WCS L10 — By Club').slice(0, 200)

    let accessToken
    try {
      ({ accessToken } = await getStaffGoogleAccessToken(req.staff.id))
    } catch (err) {
      if (err.notConnected) {
        return res.status(412).json({ error: 'google_not_connected', message: 'Connect your Google account first.' })
      }
      throw err
    }

    const { sheets, requests } = buildL10Sheet(spec, rows)
    const result = await createStyledSpreadsheet({ accessToken, title, sheets, requests })
    res.json({ url: result.url, id: result.id })
  } catch (err) {
    if (err.notConnected) {
      return res.status(412).json({ error: 'google_not_connected', message: err.message })
    }
    console.error('[analytics/l10/export-sheet] error:', err.message)
    res.status(500).json({ error: err.message || 'Export failed' })
  }
})

module.exports = router

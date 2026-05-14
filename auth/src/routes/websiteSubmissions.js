const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { resolveRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')

const router = Router()
router.use(authenticate)

// Justin asked specifically for corp+admin only — NOT the broader "manager+"
// or even the standard marketing-report gate (which would also let the
// 'marketing' role in via the role hierarchy). We do a tight allowlist
// check here instead of using requireRole().
function requireCorporateOrAdmin(req, res, next) {
  const role = resolveRole(req.staff?.role)
  if (role === 'corporate' || role === 'admin') return next()
  return res.status(403).json({ error: 'forbidden' })
}

router.use(requireCorporateOrAdmin)

const MAX_LIMIT = 2000
const DEFAULT_LIMIT = 500

// Substring matchers for top-of-report summary tiles. Patterns are
// case-insensitive ILIKE; if you add a new variant of a form name in the
// website, add it here so the tile still counts it.
const SUMMARY_PATTERNS = {
  seven_day_trial: ['%7 day%', '%seven day%'],
  pt_interest: ['%pt interest%', '%personal training interest%'],
  swim_interest: ['%swim%'],
}

function parseDate(value, fallback) {
  if (!value) return fallback
  const d = new Date(value)
  if (isNaN(d.getTime())) return fallback
  return d
}

// Build a count query over website_submissions scoped to time + (optional)
// location. The form_name filter is INTENTIONALLY ignored for the summary
// tiles — Justin asked them to reflect the broader time/location window
// while the table can be drilled down by form.
function buildCountBase({ start, end, location }) {
  let q = supabaseAdmin
    .from('website_submissions')
    .select('*', { count: 'exact', head: true })
    .gte('received_at', start.toISOString())
    .lt('received_at', end.toISOString())
  if (location) {
    if (location === 'Unknown') q = q.is('location', null)
    else q = q.eq('location', location)
  }
  return q
}

async function countMatchingPatterns(base, patterns) {
  // For multiple ILIKE patterns, use Supabase's .or() filter which expects
  // a comma-separated string of `column.op.value` clauses. Commas inside
  // values would break it, but our patterns don't contain commas.
  const orFilter = patterns.map(p => `form_name.ilike.${p}`).join(',')
  const { count, error } = await base.or(orFilter)
  if (error) throw error
  return count || 0
}

// GET /reports/website-submissions
// Query: form_name, location, start (ISO), end (ISO, exclusive), limit
router.get('/', async (req, res) => {
  try {
    const now = new Date()
    const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const start = parseDate(req.query.start, defaultStart)
    const end = parseDate(req.query.end, now)
    const formName = req.query.form_name && String(req.query.form_name).trim()
    const location = req.query.location && String(req.query.location).trim()

    let limit = parseInt(req.query.limit, 10)
    if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT
    if (limit > MAX_LIMIT) limit = MAX_LIMIT

    let rowsQuery = supabaseAdmin
      .from('website_submissions')
      .select('id, received_at, form_id, form_name, location, first_name, last_name, email, phone, message, opt_in, raw', { count: 'exact' })
      .gte('received_at', start.toISOString())
      .lt('received_at', end.toISOString())
      .order('received_at', { ascending: false })
      .limit(limit)

    if (formName) rowsQuery = rowsQuery.eq('form_name', formName)
    if (location) {
      if (location === 'Unknown') rowsQuery = rowsQuery.is('location', null)
      else rowsQuery = rowsQuery.eq('location', location)
    }

    // Summary tiles ignore form_name filter so they reflect the broader
    // time + location window. Run in parallel with the rows query.
    const summaryScope = { start, end, location }
    const [rowsResult, totalAll, total7d, totalPt, totalSwim] = await Promise.all([
      rowsQuery,
      buildCountBase(summaryScope).then(r => {
        if (r.error) throw r.error
        return r.count || 0
      }),
      countMatchingPatterns(buildCountBase(summaryScope), SUMMARY_PATTERNS.seven_day_trial),
      countMatchingPatterns(buildCountBase(summaryScope), SUMMARY_PATTERNS.pt_interest),
      countMatchingPatterns(buildCountBase(summaryScope), SUMMARY_PATTERNS.swim_interest),
    ])

    if (rowsResult.error) {
      console.error('[website-submissions] query error:', rowsResult.error.message)
      return res.status(500).json({ error: 'query failed' })
    }

    res.json({
      rows: rowsResult.data || [],
      total: rowsResult.count || 0,
      limit,
      start: start.toISOString(),
      end: end.toISOString(),
      summary: {
        total: totalAll,
        seven_day_trial: total7d,
        pt_interest: totalPt,
        swim_interest: totalSwim,
      },
    })
  } catch (err) {
    console.error('[website-submissions] error:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

// GET /reports/website-submissions/filter-options
// Returns distinct form_names and locations seen in the table for use in
// dropdowns. 'Unknown' is appended to locations if there are any null rows.
router.get('/filter-options', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('website_submissions')
      .select('form_name, location')
      .limit(5000)

    if (error) {
      console.error('[website-submissions] filter-options error:', error.message)
      return res.status(500).json({ error: 'query failed' })
    }

    const formNamesSet = new Set()
    const locationsSet = new Set()
    let hasUnknownLocation = false
    for (const row of data || []) {
      if (row.form_name) formNamesSet.add(row.form_name)
      if (row.location) locationsSet.add(row.location)
      else hasUnknownLocation = true
    }

    const form_names = Array.from(formNamesSet).sort((a, b) => a.localeCompare(b))
    const locations = Array.from(locationsSet).sort((a, b) => a.localeCompare(b))
    if (hasUnknownLocation) locations.push('Unknown')

    res.json({ form_names, locations })
  } catch (err) {
    console.error('[website-submissions] filter-options error:', err.message)
    res.status(500).json({ error: 'internal error' })
  }
})

module.exports = router

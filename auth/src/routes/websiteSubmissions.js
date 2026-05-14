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

function parseDate(value, fallback) {
  if (!value) return fallback
  const d = new Date(value)
  if (isNaN(d.getTime())) return fallback
  return d
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

    let query = supabaseAdmin
      .from('website_submissions')
      .select('id, received_at, form_id, form_name, location, first_name, last_name, email, phone, message, opt_in, raw', { count: 'exact' })
      .gte('received_at', start.toISOString())
      .lt('received_at', end.toISOString())
      .order('received_at', { ascending: false })
      .limit(limit)

    if (formName) query = query.eq('form_name', formName)
    if (location) {
      if (location === 'Unknown') query = query.is('location', null)
      else query = query.eq('location', location)
    }

    const { data, error, count } = await query
    if (error) {
      console.error('[website-submissions] query error:', error.message)
      return res.status(500).json({ error: 'query failed' })
    }

    res.json({
      rows: data || [],
      total: count || 0,
      limit,
      start: start.toISOString(),
      end: end.toISOString(),
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

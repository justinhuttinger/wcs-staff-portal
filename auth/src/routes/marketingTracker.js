const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()
router.use(authenticate)
// Corporate, marketing, and admin can view + edit the marketing tracker.
// (corporate is also the level that gets all-location visibility.)
router.use(requireRole('corporate'))

// Allowed effort types — keep in sync with portal/src/config/marketingTypes.js
const TYPES = new Set([
  'meta_ad', 'social_post', 'flyer', 'facebook_event', 'event',
  'email', 'sms', 'app_blast', 'ad_tvs', 'website',
])
const STATUSES = new Set(['planned', 'approved', 'complete'])

// Canonical location slugs (matches portal/src/config/locations.js)
const LOCATION_SLUGS = new Set([
  'salem', 'keizer', 'eugene', 'springfield', 'clackamas', 'milwaukie', 'medford',
])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Whitelist + normalize an incoming effort payload. Returns { row } or { error }.
function buildRow(body, staff) {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return { error: 'Title is required' }

  const type = String(body.type || '')
  if (!TYPES.has(type)) return { error: 'Invalid type' }

  const status = String(body.status || 'planned')
  if (!STATUSES.has(status)) return { error: 'Invalid status' }

  if (!body.start_at) return { error: 'Start date is required' }
  const start = new Date(body.start_at)
  if (isNaN(start.getTime())) return { error: 'Invalid start date' }

  let end = null
  if (body.end_at) {
    const d = new Date(body.end_at)
    if (isNaN(d.getTime())) return { error: 'Invalid end date' }
    if (d.getTime() < start.getTime()) return { error: 'End date must be after the start date' }
    end = d.toISOString()
  }

  const locations = Array.isArray(body.locations)
    ? [...new Set(body.locations.map(s => String(s).toLowerCase()).filter(s => LOCATION_SLUGS.has(s)))]
    : []
  if (locations.length === 0) return { error: 'At least one location is required' }

  const custom = (body.custom && typeof body.custom === 'object' && !Array.isArray(body.custom))
    ? body.custom : {}

  const notes = typeof body.notes === 'string' ? body.notes : null

  return {
    row: {
      title,
      type,
      status,
      start_at: start.toISOString(),
      end_at: end,
      locations,
      custom,
      notes,
    },
  }
}

// GET / — list efforts. Optional filters: type, location (slug), from, to (ISO).
router.get('/', async (req, res) => {
  try {
    let q = supabaseAdmin
      .from('marketing_efforts')
      .select('*')
      .order('start_at', { ascending: false })
      .limit(2000)

    if (req.query.type && TYPES.has(req.query.type)) q = q.eq('type', req.query.type)
    if (req.query.location && LOCATION_SLUGS.has(String(req.query.location).toLowerCase())) {
      q = q.contains('locations', [String(req.query.location).toLowerCase()])
    }
    if (req.query.from) q = q.gte('start_at', req.query.from)
    if (req.query.to) q = q.lte('start_at', req.query.to)

    const { data, error } = await q
    if (error) throw error
    res.json({ efforts: data || [] })
  } catch (err) {
    console.error('[MarketingTracker] list error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST / — create an effort.
router.post('/', async (req, res) => {
  try {
    const { row, error: vErr } = buildRow(req.body, req.staff)
    if (vErr) return res.status(400).json({ error: vErr })

    const { data, error } = await supabaseAdmin
      .from('marketing_efforts')
      .insert({
        ...row,
        created_by: req.staff.id,
        created_by_name: req.staff.display_name || req.staff.email || null,
      })
      .select()
      .single()
    if (error) throw error
    res.status(201).json({ effort: data })
  } catch (err) {
    console.error('[MarketingTracker] create error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PUT /:id — update an effort.
router.put('/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid effort id' })
    const { row, error: vErr } = buildRow(req.body, req.staff)
    if (vErr) return res.status(400).json({ error: vErr })

    const { data, error } = await supabaseAdmin
      .from('marketing_efforts')
      .update(row)
      .eq('id', req.params.id)
      .select()
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Effort not found' })
    res.json({ effort: data })
  } catch (err) {
    console.error('[MarketingTracker] update error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PATCH /:id/status — lightweight status-only update (from the read-only view).
router.patch('/:id/status', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid effort id' })
    const status = String(req.body.status || '')
    if (!STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status' })

    const { data, error } = await supabaseAdmin
      .from('marketing_efforts')
      .update({ status })
      .eq('id', req.params.id)
      .select()
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Effort not found' })
    res.json({ effort: data })
  } catch (err) {
    console.error('[MarketingTracker] status error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /:id/comments — list comments for an effort (oldest first).
router.get('/:id/comments', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid effort id' })
    const { data, error } = await supabaseAdmin
      .from('marketing_effort_comments')
      .select('*')
      .eq('effort_id', req.params.id)
      .order('created_at', { ascending: true })
    if (error) throw error
    res.json({ comments: data || [] })
  } catch (err) {
    console.error('[MarketingTracker] comments list error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /:id/comments — add a comment (author taken from the session).
router.post('/:id/comments', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid effort id' })
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : ''
    if (!body) return res.status(400).json({ error: 'Comment cannot be empty' })

    const { data, error } = await supabaseAdmin
      .from('marketing_effort_comments')
      .insert({
        effort_id: req.params.id,
        body,
        created_by: req.staff.id,
        created_by_name: req.staff.display_name || req.staff.email || null,
      })
      .select()
      .single()
    if (error) throw error
    res.status(201).json({ comment: data })
  } catch (err) {
    // FK violation = parent effort doesn't exist → clean 404 instead of 500.
    if (err && err.code === '23503') return res.status(404).json({ error: 'Effort not found' })
    console.error('[MarketingTracker] comment create error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /:id — remove an effort.
router.delete('/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid effort id' })
    const { data, error } = await supabaseAdmin
      .from('marketing_efforts')
      .delete()
      .eq('id', req.params.id)
      .select()
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Effort not found' })
    res.json({ success: true })
  } catch (err) {
    console.error('[MarketingTracker] delete error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router

// GM Event Calendar — a planning calendar for general managers that holds ONLY
// in-person events for their own clubs.
//
// There is no separate table: an event here is a `marketing_efforts` row with
// type 'event', so everything a GM plans shows up on the Marketing Tracker
// calendar automatically, and anything Marketing schedules as an event at the
// GM's club shows up here. The differences from the tracker are all scope:
//   * type is always 'event' (other effort types are invisible here)
//   * clubs are limited to the caller's assigned clubs (corporate+ see all)
//   * status is Marketing's call — new events start 'planned' and edits here
//     never change it (status moves in the Marketing Tracker)
//
// Gated on the 'eventCalendar' tile (seeded for managers + admin in migration
// 230), so the Roles grid controls who gets it.
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireTile } = require('../middleware/tile')
const { canSeeAllLocations } = require('../middleware/role')
const { diffEffort, recordActivity } = require('./marketingTracker')
const {
  EVENT_TYPE, LOCATION_SLUGS, inView, canEdit, withEditable, buildEventRow,
} = require('../lib/eventCalendarScope')

const router = Router()
router.use(authenticate)
router.use(requireTile('eventCalendar'))

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The clubs this caller plans for. null = every club (corporate+).
async function clubScope(staff) {
  if (canSeeAllLocations(staff.role)) return null
  const ids = staff.location_ids || []
  if (ids.length === 0) return []
  const { data } = await supabaseAdmin.from('locations').select('name').in('id', ids)
  return (data || []).map(l => l.name?.toLowerCase()).filter(s => s && LOCATION_SLUGS.has(s))
}

async function loadEvent(id, scope) {
  const { data, error } = await supabaseAdmin.from('marketing_efforts').select('*').eq('id', id).maybeSingle()
  if (error) return { error: error.message, status: 500 }
  if (!data || !inView(data, scope)) return { error: 'Event not found', status: 404 }
  return { effort: data }
}

// GET / — events touching the caller's clubs, plus the clubs they can plan for.
router.get('/', async (req, res) => {
  try {
    const scope = await clubScope(req.staff)
    if (scope !== null && scope.length === 0) return res.json({ efforts: [], clubs: [] })
    let q = supabaseAdmin
      .from('marketing_efforts')
      .select('*')
      .eq('type', EVENT_TYPE)
      .order('start_at', { ascending: false })
      .limit(2000)
    if (scope !== null) q = q.overlaps('locations', scope)
    const { data, error } = await q
    if (error) throw error
    res.json({
      efforts: (data || []).map(e => withEditable(e, scope)),
      clubs: scope === null ? [...LOCATION_SLUGS] : scope,
    })
  } catch (err) {
    console.error('[EventCalendar] list error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST / — create an event (always type 'event', status 'planned').
router.post('/', async (req, res) => {
  try {
    const scope = await clubScope(req.staff)
    const { row, error: vErr, status } = buildEventRow(req.body || {}, scope)
    if (vErr) return res.status(status || 400).json({ error: vErr })
    const { data, error } = await supabaseAdmin
      .from('marketing_efforts')
      .insert({
        ...row,
        status: 'planned',
        created_by: req.staff.id,
        created_by_name: req.staff.display_name || req.staff.email || null,
      })
      .select()
      .single()
    if (error) throw error
    res.status(201).json({ effort: withEditable(data, scope) })
  } catch (err) {
    console.error('[EventCalendar] create error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PUT /:id — edit an event. Status is left as it is.
router.put('/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid event id' })
    const scope = await clubScope(req.staff)
    const found = await loadEvent(req.params.id, scope)
    if (found.error) return res.status(found.status).json({ error: found.error })
    if (!canEdit(found.effort, scope)) return res.status(403).json({ error: 'This event includes clubs outside yours. Ask Marketing to change it.' })

    const { row, error: vErr, status } = buildEventRow(req.body || {}, scope)
    if (vErr) return res.status(status || 400).json({ error: vErr })

    const { data, error } = await supabaseAdmin
      .from('marketing_efforts')
      .update(row)
      .eq('id', req.params.id)
      .select()
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Event not found' })
    await recordActivity(req.params.id, req.staff, 'edit', diffEffort(found.effort, data))
    res.json({ effort: withEditable(data, scope) })
  } catch (err) {
    console.error('[EventCalendar] update error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /:id
router.delete('/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid event id' })
    const scope = await clubScope(req.staff)
    const found = await loadEvent(req.params.id, scope)
    if (found.error) return res.status(found.status).json({ error: found.error })
    if (!canEdit(found.effort, scope)) return res.status(403).json({ error: 'This event includes clubs outside yours. Ask Marketing to remove it.' })
    const { data, error } = await supabaseAdmin
      .from('marketing_efforts')
      .delete()
      .eq('id', req.params.id)
      .select()
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Event not found' })
    res.json({ success: true })
  } catch (err) {
    console.error('[EventCalendar] delete error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /:id/comments — the same activity feed the Marketing Tracker shows, so a
// GM and Marketing can talk on the event.
router.get('/:id/comments', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid event id' })
    const scope = await clubScope(req.staff)
    const found = await loadEvent(req.params.id, scope)
    if (found.error) return res.status(found.status).json({ error: found.error })
    const { data, error } = await supabaseAdmin
      .from('marketing_effort_comments')
      .select('*')
      .eq('effort_id', req.params.id)
      .order('created_at', { ascending: true })
    if (error) throw error
    res.json({ comments: data || [] })
  } catch (err) {
    console.error('[EventCalendar] comments list error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /:id/comments
router.post('/:id/comments', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid event id' })
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : ''
    if (!body) return res.status(400).json({ error: 'Comment cannot be empty' })
    const scope = await clubScope(req.staff)
    const found = await loadEvent(req.params.id, scope)
    if (found.error) return res.status(found.status).json({ error: found.error })
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
    if (err && err.code === '23503') return res.status(404).json({ error: 'Event not found' })
    console.error('[EventCalendar] comment create error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router

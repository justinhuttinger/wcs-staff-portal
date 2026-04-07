const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()

router.use(authenticate)

// GET /config/locations
router.get('/locations', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('locations')
    .select('id, name, abc_url, booking_url, vip_survey_url')
    .order('name')

  if (error) return res.status(500).json({ error: 'Failed to fetch locations' })
  res.json({ locations: data })
})

// PUT /config/locations/:id — admin only
router.put('/locations/:id', requireRole('admin'), async (req, res) => {
  const { abc_url, booking_url, vip_survey_url } = req.body
  const updates = {}
  if (abc_url !== undefined) updates.abc_url = abc_url
  if (booking_url !== undefined) updates.booking_url = booking_url
  if (vip_survey_url !== undefined) updates.vip_survey_url = vip_survey_url

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' })
  }

  const { data, error } = await supabaseAdmin
    .from('locations')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: 'Failed to update location' })
  res.json({ location: data })
})

// GET /config/tools — returns tools filtered by caller's role
router.get('/tools', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('role_tool_visibility')
    .select('tool_key, visible')
    .eq('role', req.staff.role)

  if (error) return res.status(500).json({ error: 'Failed to fetch tool visibility' })

  const visible_tools = (data || []).filter(t => t.visible).map(t => t.tool_key)
  res.json({ visible_tools })
})

// GET /config/tiles?location_id=xxx
router.get('/tiles', async (req, res) => {
  let query = supabaseAdmin
    .from('custom_tiles')
    .select('id, label, description, url, icon, location_id, created_by, created_at, locations(name)')
    .order('label')

  if (req.query.location_id) {
    query = query.eq('location_id', req.query.location_id)
  } else {
    query = query.in('location_id', req.staff.location_ids)
  }

  const { data, error } = await query
  if (error) return res.status(500).json({ error: 'Failed to fetch tiles' })
  res.json({ tiles: data })
})

// POST /config/tiles — admin only
router.post('/tiles', requireRole('admin'), async (req, res) => {
  const { label, description, url, icon, location_id } = req.body
  if (!label || !url || !location_id) {
    return res.status(400).json({ error: 'label, url, and location_id are required' })
  }

  const { data, error } = await supabaseAdmin
    .from('custom_tiles')
    .insert({ label, description, url, icon, location_id, created_by: req.staff.id })
    .select()
    .single()

  if (error) return res.status(500).json({ error: 'Failed to create tile' })
  res.status(201).json({ tile: data })
})

// PUT /config/tiles/:id — admin only
router.put('/tiles/:id', requireRole('admin'), async (req, res) => {
  const { label, description, url, icon } = req.body
  const updates = {}
  if (label !== undefined) updates.label = label
  if (description !== undefined) updates.description = description
  if (url !== undefined) updates.url = url
  if (icon !== undefined) updates.icon = icon

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' })
  }

  const { data, error } = await supabaseAdmin
    .from('custom_tiles')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: 'Failed to update tile' })
  res.json({ tile: data })
})

// DELETE /config/tiles/:id — admin only
router.delete('/tiles/:id', requireRole('admin'), async (req, res) => {
  const { error } = await supabaseAdmin
    .from('custom_tiles')
    .delete()
    .eq('id', req.params.id)

  if (error) return res.status(500).json({ error: 'Failed to delete tile' })
  res.json({ message: 'Tile deleted' })
})

// GET /config/role-visibility — admin only, returns all role/tool visibility settings
router.get('/role-visibility', requireRole('admin'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('role_tool_visibility')
    .select('id, role, tool_key, visible')
    .order('role')

  if (error) return res.status(500).json({ error: 'Failed to fetch role visibility' })
  res.json({ visibility: data })
})

// PUT /config/role-visibility — admin only, batch update visibility
router.put('/role-visibility', requireRole('admin'), async (req, res) => {
  const { updates } = req.body
  if (!updates || !Array.isArray(updates)) {
    return res.status(400).json({ error: 'updates array is required' })
  }

  try {
    for (const { role, tool_key, visible } of updates) {
      await supabaseAdmin
        .from('role_tool_visibility')
        .update({ visible })
        .eq('role', role)
        .eq('tool_key', tool_key)
    }
    res.json({ message: 'Visibility updated' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update visibility' })
  }
})

module.exports = router

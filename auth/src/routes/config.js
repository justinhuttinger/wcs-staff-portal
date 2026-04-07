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

module.exports = router

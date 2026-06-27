const { Router } = require('express')
const crypto = require('crypto')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

function newToken() {
  return crypto.randomBytes(24).toString('base64url')
}

// GET /admin/tour-locations -> every location joined with its tour config
router.get('/', async (req, res) => {
  try {
    const { data: locations } = await supabaseAdmin
      .from('locations')
      .select('id, name')
      .order('name')
    const { data: configs } = await supabaseAdmin
      .from('tour_location_config')
      .select('location_id, public_token, webhook_url, day_one_base_url, active')
    const byLoc = Object.fromEntries((configs || []).map(c => [c.location_id, c]))

    const rows = (locations || []).map(loc => ({
      location_id: loc.id,
      name: loc.name,
      public_token: byLoc[loc.id]?.public_token || null,
      webhook_url: byLoc[loc.id]?.webhook_url || '',
      day_one_base_url: byLoc[loc.id]?.day_one_base_url || '',
      active: byLoc[loc.id]?.active ?? true,
    }))
    res.json({ locations: rows })
  } catch (err) {
    console.error('[tour-admin] list failed:', err.message)
    res.status(500).json({ error: 'Failed to load tour locations' })
  }
})

// PUT /admin/tour-locations/:locationId -> upsert webhook + day one link + active
router.put('/:locationId', async (req, res) => {
  try {
    const { webhook_url, day_one_base_url, active } = req.body || {}
    const patch = {
      location_id: req.params.locationId,
      webhook_url: webhook_url || null,
      day_one_base_url: day_one_base_url || null,
      active: active !== false,
      updated_at: new Date().toISOString(),
    }
    // Ensure a token exists for upsert (a location added after migration 068).
    const { data: existing } = await supabaseAdmin
      .from('tour_location_config')
      .select('public_token')
      .eq('location_id', req.params.locationId)
      .maybeSingle()
    if (!existing) patch.public_token = newToken()

    const { error } = await supabaseAdmin
      .from('tour_location_config')
      .upsert(patch, { onConflict: 'location_id' })
    if (error) return res.status(500).json({ error: 'Failed to save' })
    res.json({ message: 'Saved' })
  } catch (err) {
    console.error('[tour-admin] save failed:', err.message)
    res.status(500).json({ error: 'Failed to save' })
  }
})

// POST /admin/tour-locations/:locationId/regenerate-token -> new secret URL
router.post('/:locationId/regenerate-token', async (req, res) => {
  try {
    const token = newToken()
    const { error } = await supabaseAdmin
      .from('tour_location_config')
      .upsert(
        { location_id: req.params.locationId, public_token: token, updated_at: new Date().toISOString() },
        { onConflict: 'location_id' }
      )
    if (error) return res.status(500).json({ error: 'Failed to regenerate' })
    res.json({ public_token: token })
  } catch (err) {
    console.error('[tour-admin] regenerate failed:', err.message)
    res.status(500).json({ error: 'Failed to regenerate' })
  }
})

module.exports = router

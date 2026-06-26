const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')

const router = Router()
router.use(authenticate)

const ALLOWED_STATUS = ['ready', 'completed', 'cancelled']
const SELECT_COLS =
  'id, received_at, ghl_contact_id, contact_name, contact_email, contact_phone, ' +
  'photo_base64, location_id, status, outcome, notes, completed_at, completed_by'

// GET /tour-intake?location_id=xxx&status=ready
// Live front-desk queue for a location. Any authenticated staffer at the
// location can see and work the queue (it's a shared front-desk tool).
router.get('/', async (req, res) => {
  try {
    const locationIds = req.staff.location_ids || []

    let query = supabaseAdmin
      .from('tour_intakes')
      .select(SELECT_COLS)
      .order('received_at', { ascending: false })

    if (req.query.location_id) {
      if (!locationIds.includes(req.query.location_id)) {
        return res.status(403).json({ error: 'Not authorized for this location' })
      }
      query = query.eq('location_id', req.query.location_id)
    } else {
      if (locationIds.length === 0) return res.json({ tour_intakes: [] })
      query = query.in('location_id', locationIds)
    }

    if (req.query.status) {
      if (!ALLOWED_STATUS.includes(req.query.status)) {
        return res.status(400).json({ error: 'Invalid status filter' })
      }
      query = query.eq('status', req.query.status)
    }

    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 100))
    query = query.range(0, limit - 1)

    const { data, error } = await query
    if (error) {
      console.error('[tour-intake] list error:', error.message)
      return res.status(500).json({ error: 'Failed to fetch tour intakes' })
    }
    res.json({ tour_intakes: data })
  } catch (err) {
    console.error('[tour-intake] list error:', err.message)
    res.status(500).json({ error: 'Failed to fetch tour intakes' })
  }
})

// PATCH /tour-intake/:id — record the tour outcome / notes, or mark cancelled.
router.patch('/:id', async (req, res) => {
  const { status, outcome, notes } = req.body || {}

  if (status !== undefined && !ALLOWED_STATUS.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' })
  }

  try {
    const locationIds = req.staff.location_ids || []
    if (locationIds.length === 0) {
      return res.status(403).json({ error: 'No location access' })
    }

    // Verify the intake exists and belongs to a location the staffer can access.
    const { data: existing, error: findErr } = await supabaseAdmin
      .from('tour_intakes')
      .select('id, location_id')
      .eq('id', req.params.id)
      .maybeSingle()

    if (findErr) return res.status(500).json({ error: 'Lookup failed' })
    if (!existing) return res.status(404).json({ error: 'Tour intake not found' })
    if (existing.location_id && !locationIds.includes(existing.location_id)) {
      return res.status(403).json({ error: 'Not authorized for this location' })
    }

    const patch = {}
    if (outcome !== undefined) patch.outcome = outcome || null
    if (notes !== undefined) patch.notes = notes || null
    if (status !== undefined) {
      patch.status = status
      if (status === 'completed') {
        patch.completed_at = new Date().toISOString()
        patch.completed_by = req.staff.id
      }
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No fields to update' })
    }

    const { data, error } = await supabaseAdmin
      .from('tour_intakes')
      .update(patch)
      .eq('id', req.params.id)
      .select(SELECT_COLS)
      .single()

    if (error) {
      console.error('[tour-intake] update error:', error.message)
      return res.status(500).json({ error: 'Failed to update tour intake' })
    }
    res.json({ tour_intake: data })
  } catch (err) {
    console.error('[tour-intake] update error:', err.message)
    res.status(500).json({ error: 'Failed to update tour intake' })
  }
})

module.exports = router

const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')

const router = Router()

// Webhook secret verification middleware
function verifyWebhookSecret(req, res, next) {
  const secret = process.env.GHL_WEBHOOK_SECRET
  if (!secret) return next() // no secret configured, allow (backward compat)
  const provided = req.headers['x-webhook-secret'] || req.query.secret
  if (provided !== secret) {
    return res.status(401).json({ error: 'Invalid webhook secret' })
  }
  next()
}

// POST /webhooks/ghl-appointment — GHL fires this when a day-one is booked
router.post('/ghl-appointment', verifyWebhookSecret, async (req, res) => {
  const { staff_email, contact_name, appointment_id, appointment_type, appointment_time, contact_id, form_id } = req.body

  if (!staff_email || !contact_name || !appointment_id) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  try {
    // Look up staff by email to get their ID and location
    const { data: staff } = await supabaseAdmin
      .from('staff')
      .select('id')
      .eq('email', staff_email)
      .single()

    // Get staff's primary location
    let locationId = null
    if (staff) {
      const { data: staffLoc } = await supabaseAdmin
        .from('staff_locations')
        .select('location_id')
        .eq('staff_id', staff.id)
        .eq('is_primary', true)
        .single()
      if (staffLoc) locationId = staffLoc.location_id
    }

    // Build GHL form URL
    const formUrl = form_id ? 'https://link.westcoaststrength.com/widget/form/' + form_id : null

    const { data, error } = await supabaseAdmin
      .from('appointments')
      .upsert({
        ghl_appointment_id: appointment_id,
        staff_id: staff?.id || null,
        staff_email,
        contact_name,
        contact_id: contact_id || null,
        appointment_type: appointment_type || 'DAYONE',
        appointment_time: appointment_time || null,
        form_url: formUrl,
        status: 'pending',
        location_id: locationId,
      }, { onConflict: 'ghl_appointment_id' })
      .select()
      .single()

    if (error) {
      console.error('Webhook error:', error.message)
      return res.status(500).json({ error: 'Failed to create appointment' })
    }

    res.json({ success: true, appointment_id: data.id })
  } catch (err) {
    console.error('Webhook error:', err.message)
    res.status(500).json({ error: 'Internal error' })
  }
})

// POST /webhooks/ghl-form-complete — GHL fires this when the form is submitted
router.post('/ghl-form-complete', verifyWebhookSecret, async (req, res) => {
  const { appointment_id, contact_id, sale_result } = req.body

  if (!appointment_id) {
    return res.status(400).json({ error: 'appointment_id is required' })
  }

  try {
    const { error } = await supabaseAdmin
      .from('appointments')
      .update({
        status: 'completed',
        sale_result: sale_result || null,
        completed_at: new Date().toISOString(),
      })
      .eq('ghl_appointment_id', appointment_id)

    if (error) {
      return res.status(500).json({ error: 'Failed to update appointment' })
    }

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Internal error' })
  }
})

module.exports = router

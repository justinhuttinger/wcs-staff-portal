const jwt = require('jsonwebtoken')
const { supabaseAdmin } = require('../services/supabase')

async function authenticate(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' })
  }

  const token = header.slice(7)

  try {
    const payload = jwt.verify(token, process.env.SUPABASE_JWT_SECRET)
    const userId = payload.sub

    // Fetch staff profile + locations
    const { data: staff, error } = await supabaseAdmin
      .from('staff')
      .select('id, email, display_name, role, must_change_password')
      .eq('id', userId)
      .single()

    if (error || !staff) {
      return res.status(401).json({ error: 'Staff account not found' })
    }

    const { data: staffLocs } = await supabaseAdmin
      .from('staff_locations')
      .select('location_id, is_primary')
      .eq('staff_id', userId)

    req.staff = {
      ...staff,
      location_ids: (staffLocs || []).map(sl => sl.location_id),
      primary_location_id: (staffLocs || []).find(sl => sl.is_primary)?.location_id || null,
    }

    next()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

module.exports = authenticate

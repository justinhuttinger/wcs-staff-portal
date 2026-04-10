const { supabaseAdmin } = require('../services/supabase')

async function authenticate(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' })
  }

  const token = header.slice(7)

  try {
    // Use Supabase's own token verification (handles ES256/HS256 automatically)
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }
    const userId = user.id

    // Fetch staff profile + locations
    const { data: staff, error } = await supabaseAdmin
      .from('staff')
      .select('id, email, display_name, first_name, last_name, role, must_change_password')
      .eq('id', userId)
      .single()

    if (error || !staff) {
      return res.status(401).json({ error: 'Staff account not found' })
    }

    const { data: staffLocs } = await supabaseAdmin
      .from('staff_locations')
      .select('location_id, is_primary, can_sign_in, can_view_reports')
      .eq('staff_id', userId)

    const allLocationIds = (staffLocs || []).map(sl => sl.location_id)
    const signInLocationIds = (staffLocs || []).filter(sl => sl.can_sign_in !== false).map(sl => sl.location_id)
    const reportLocationIds = (staffLocs || []).filter(sl => sl.can_view_reports !== false).map(sl => sl.location_id)

    req.staff = {
      ...staff,
      location_ids: allLocationIds,
      sign_in_location_ids: signInLocationIds,
      report_location_ids: reportLocationIds,
      primary_location_id: (staffLocs || []).find(sl => sl.is_primary)?.location_id || null,
    }

    next()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

module.exports = authenticate

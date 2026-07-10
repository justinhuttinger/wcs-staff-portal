const { supabaseAdmin } = require('../services/supabase')
const { applyImpersonation, isImpersonatedWrite } = require('./impersonation')

// Load a staff member's full request context (profile + location scoping).
// Returns null if the row does not exist. Shared by the real-user path and
// the impersonation-target path.
async function buildStaffContext(staffId) {
  const { data: staff, error } = await supabaseAdmin
    .from('staff')
    .select('id, email, display_name, first_name, last_name, role, is_active, must_change_password, marketing_addon, marketing_locations, marketing_types, custom_tiles, custom_reports')
    .eq('id', staffId)
    .single()
  if (error || !staff) return null

  const { data: staffLocs } = await supabaseAdmin
    .from('staff_locations')
    .select('location_id, is_primary, can_sign_in, can_view_reports')
    .eq('staff_id', staffId)

  return {
    ...staff,
    location_ids: (staffLocs || []).map(sl => sl.location_id),
    sign_in_location_ids: (staffLocs || []).filter(sl => sl.can_sign_in !== false).map(sl => sl.location_id),
    report_location_ids: (staffLocs || []).filter(sl => sl.can_view_reports !== false).map(sl => sl.location_id),
    primary_location_id: (staffLocs || []).find(sl => sl.is_primary)?.location_id || null,
  }
}

async function authenticate(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' })
  }
  const token = header.slice(7)

  try {
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }

    const realStaff = await buildStaffContext(user.id)
    if (!realStaff) {
      return res.status(401).json({ error: 'Staff account not found' })
    }

    // Impersonation overlay — only trusted when the real user is admin.
    const targetStaffId = req.headers['x-impersonate-staff-id']
    const { staff, realStaff: actor, impersonating } = await applyImpersonation({
      realStaff, targetStaffId, loadStaffContext: buildStaffContext,
    })
    req.staff = staff
    req.realStaff = actor
    req.impersonating = impersonating

    // View-only: block any write while impersonating.
    if (isImpersonatedWrite(req.method, impersonating, req.baseUrl + req.path)) {
      return res.status(403).json({ error: 'read-only preview', impersonating: true })
    }

    next()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

module.exports = authenticate
module.exports.buildStaffContext = buildStaffContext

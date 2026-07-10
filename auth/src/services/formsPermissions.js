const { roleLevel, ROLE_HIERARCHY } = require('../middleware/role')

const CORPORATE_LEVEL = ROLE_HIERARCHY.indexOf('corporate')
const ADMIN_LEVEL = ROLE_HIERARCHY.indexOf('admin')

// Single access function for the builder/management side, evaluated in spec
// order (docs/superpowers/specs/2026-07-08-form-builder-design.md). The public
// renderer never calls this; published forms are world-readable by slug.
function canAccessForm(staff, form, shares = []) {
  const none = { view: false, edit: false }
  if (!staff || !form) return none
  // 1. corporate (director alias) and admin see and edit everything.
  if (roleLevel(staff.role) >= CORPORATE_LEVEL) return { view: true, edit: true }
  // 2. owner.
  if (staff.id === form.owner_id) return { view: true, edit: true }
  // 3. location visibility.
  if (form.visibility === 'location' && (staff.location_ids || []).includes(form.location_id)) {
    return { view: true, edit: !!form.location_can_edit }
  }
  // 4. explicit share.
  const share = (shares || []).find(s => s.staff_id === staff.id)
  if (share) return { view: true, edit: share.permission === 'editor' }
  return none
}

// Module gate: who may enter the forms module at all. Admin tier and up, or
// an explicit 'forms' permission (RBAC v2 role toggle / override) an admin
// granted. Mirrors the requireReportAccess pattern in middleware/role.js.
async function requireFormsBuilder(req, res, next) {
  if (!req.staff) return res.status(401).json({ error: 'Authentication required' })
  if (roleLevel(req.staff.role) >= ADMIN_LEVEL) return next()
  try {
    const { getEffectivePermissions } = require('./permissions')
    const perms = await getEffectivePermissions(req.staff)
    if (perms.includes('forms')) return next()
  } catch (err) {
    console.error('[forms] effective-perm check failed:', err.message)
  }
  return res.status(403).json({ error: 'Forms access requires admin or a forms grant' })
}

module.exports = { canAccessForm, requireFormsBuilder }

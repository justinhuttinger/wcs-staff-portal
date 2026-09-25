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

// Module gates: who may enter a builder module at all. Admin tier and up, or
// an explicit RBAC grant for `permKey` (role toggle / override) an admin gave.
// Mirrors the requireReportAccess pattern in middleware/role.js.
function makeModuleGate(permKey, label) {
  return async function moduleGate(req, res, next) {
    if (!req.staff) return res.status(401).json({ error: 'Authentication required' })
    if (roleLevel(req.staff.role) >= ADMIN_LEVEL) return next()
    try {
      const { getEffectivePermissions } = require('./permissions')
      const perms = await getEffectivePermissions(req.staff)
      if (perms.includes(permKey)) return next()
    } catch (err) {
      console.error(`[${permKey}] effective-perm check failed:`, err.message)
    }
    return res.status(403).json({ error: `${label} access requires admin or a ${permKey} grant` })
  }
}

const requireFormsBuilder = makeModuleGate('forms', 'Forms')
const requireQuizBuilder = makeModuleGate('quizzes', 'Quiz Funnels')

module.exports = { canAccessForm, requireFormsBuilder, requireQuizBuilder, makeModuleGate }

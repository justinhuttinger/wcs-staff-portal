// auth/src/services/visibleTools.js
// Single source of truth for "which portal tiles can this staff member see".
// Used by GET /auth/me and by the requireTile() middleware so the tile a user
// sees and the API it can call never drift apart. Delegates to the RBAC v2
// effective-permission compute (base role toggles + per-person overrides,
// clamped to the role's tier ceiling).
const { getEffectivePermissions } = require('./permissions')

async function getVisibleTools(staff) {
  if (!staff) return []
  return getEffectivePermissions(staff)
}

module.exports = { getVisibleTools }

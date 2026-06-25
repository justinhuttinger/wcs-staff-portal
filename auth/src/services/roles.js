// Resolve a (possibly admin-created) role name to one of the five canonical
// base tiers. Named roles live in the `roles` table; built-ins and unknowns
// fall back to the static alias map so the synchronous gates keep working.
const memoryCache = require('./memoryCache')
const { resolveRole } = require('../middleware/role')

const ROLES_TTL_MS = 5 * 60 * 1000

async function loadRoleMap() {
  return memoryCache.wrap('roles:base_tier_map', ROLES_TTL_MS, async () => {
    // Lazy require: supabase.js throws at import without env, which would break
    // unit tests of the pure helpers in this module.
    const { supabaseAdmin } = require('./supabase')
    const { data } = await supabaseAdmin.from('roles').select('name, base_tier')
    const map = {}
    for (const r of (data || [])) map[r.name] = r.base_tier
    return map
  })
}

function _resolveFromMap(map, role) {
  if (map && map[role]) return map[role]
  return resolveRole(role)
}

async function getBaseTier(role) {
  const map = await loadRoleMap()
  return _resolveFromMap(map, role)
}

module.exports = { getBaseTier, _resolveFromMap }

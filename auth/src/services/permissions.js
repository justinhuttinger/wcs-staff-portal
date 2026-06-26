// Effective permission compute: a role's base toggles, plus per-person
// overrides (force-on adds, force-off removes). Fully role-driven with no tier
// ceiling — a role/override grants exactly what it lists.
const memoryCache = require('./memoryCache')

const OVERRIDES_TTL_MS = 60 * 1000
const CATALOG_TTL_MS = 5 * 60 * 1000

// Effective permissions are fully role-driven: a role's toggles plus per-person
// overrides grant exactly what they list, with NO tier ceiling. Admins have
// full control over which permissions each role carries. (Hard tier gates on
// sensitive action endpoints still apply independently via requireRole; this
// governs tile/report/marketing VISIBILITY and grant-based report access.)
function applyOverrides(baseKeys, overrides) {
  const set = new Set(baseKeys || [])
  for (const o of (overrides || [])) {
    if (o.visible) set.add(o.perm_key)
    else set.delete(o.perm_key)
  }
  return [...set]
}

async function tilesForRole(role) {
  return memoryCache.wrap(`role_tool_visibility:${role}`, CATALOG_TTL_MS, async () => {
    const { supabaseAdmin } = require('./supabase')
    const { data } = await supabaseAdmin
      .from('role_tool_visibility').select('tool_key').eq('role', role).eq('visible', true)
    return (data || []).map(v => v.tool_key)
  })
}

async function loadCatalog() {
  return memoryCache.wrap('permission_catalog:min_tier', CATALOG_TTL_MS, async () => {
    const { supabaseAdmin } = require('./supabase')
    const { data } = await supabaseAdmin.from('permission_catalog').select('perm_key, min_tier')
    const map = {}
    for (const c of (data || [])) map[c.perm_key] = c.min_tier
    return map
  })
}

async function overridesForStaff(staffId) {
  return memoryCache.wrap(`staff_overrides:${staffId}`, OVERRIDES_TTL_MS, async () => {
    const { supabaseAdmin } = require('./supabase')
    const { data } = await supabaseAdmin
      .from('staff_permission_overrides').select('perm_key, visible').eq('staff_id', staffId)
    return data || []
  })
}

// The inherited baseline for a staff member: their role's own toggles, BEFORE
// per-person overrides. The built-in 'custom' role still reads its legacy
// per-person custom_tiles; every other role reads its role_tool_visibility grid.
async function roleBaseKeys(staff) {
  if (!staff) return []
  if (staff.role === 'custom') return Array.isArray(staff.custom_tiles) ? staff.custom_tiles : []
  return tilesForRole(staff.role)
}

async function getEffectivePermissions(staff) {
  if (!staff) return []
  const [baseKeys, overrides] = await Promise.all([
    roleBaseKeys(staff),
    overridesForStaff(staff.id),
  ])
  return applyOverrides(baseKeys, overrides)
}

module.exports = { getEffectivePermissions, applyOverrides, roleBaseKeys, loadCatalog }

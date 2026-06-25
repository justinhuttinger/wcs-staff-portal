// Effective permission compute: base role toggles, plus per-person overrides.
// Force-on additions are clamped to the role's tier ceiling (a key whose
// catalog min_tier is above the staff member's base_tier cannot be added by an
// override). Force-off removes. Keys absent from the catalog have no ceiling.
const memoryCache = require('./memoryCache')
const { getBaseTier } = require('./roles')
const { ROLE_HIERARCHY } = require('../middleware/role')

const OVERRIDES_TTL_MS = 60 * 1000
const CATALOG_TTL_MS = 5 * 60 * 1000

// A perm key is within a role's tier ceiling when either it carries no catalog
// min_tier (plain tiles/apps), or its min_tier is at or below the role's tier.
// Uncatalogued report:<key> grants fail closed — report endpoints honor them
// directly, so an unknown ceiling must never resolve to "allowed".
function withinCeiling(permKey, catalog, tierIdx, hier) {
  const minTier = catalog[permKey]
  if (minTier) return hier.indexOf(minTier) <= tierIdx
  if (permKey.startsWith('report:')) return false
  return true
}

function applyOverrides(baseKeys, overrides, catalog, baseTier, hier) {
  const tierIdx = hier.indexOf(baseTier)
  // Clamp the role's own toggles to its tier ceiling, not just overrides. A
  // custom role's grid could otherwise hold a report grant above its tier and
  // requireReportAccess would honor it. (No-op for built-in roles today, whose
  // toggles carry no report keys, so parity is preserved.)
  const set = new Set((baseKeys || []).filter(k => withinCeiling(k, catalog, tierIdx, hier)))
  for (const o of (overrides || [])) {
    if (o.visible) {
      if (!withinCeiling(o.perm_key, catalog, tierIdx, hier)) continue
      set.add(o.perm_key)
    } else {
      set.delete(o.perm_key)
    }
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
  const [baseKeys, overrides, catalog, baseTier] = await Promise.all([
    roleBaseKeys(staff),
    overridesForStaff(staff.id),
    loadCatalog(),
    getBaseTier(staff.role),
  ])
  return applyOverrides(baseKeys, overrides, catalog, baseTier, ROLE_HIERARCHY)
}

module.exports = { getEffectivePermissions, applyOverrides, roleBaseKeys, loadCatalog }

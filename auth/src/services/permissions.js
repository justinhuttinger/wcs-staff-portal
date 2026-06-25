// Effective permission compute: base role toggles, plus per-person overrides.
// Force-on additions are clamped to the role's tier ceiling (a key whose
// catalog min_tier is above the staff member's base_tier cannot be added by an
// override). Force-off removes. Keys absent from the catalog have no ceiling.
const memoryCache = require('./memoryCache')
const { getBaseTier } = require('./roles')
const { ROLE_HIERARCHY } = require('../middleware/role')

const OVERRIDES_TTL_MS = 60 * 1000
const CATALOG_TTL_MS = 5 * 60 * 1000

function applyOverrides(baseKeys, overrides, catalog, baseTier, hier) {
  const tierIdx = hier.indexOf(baseTier)
  const set = new Set(baseKeys)
  for (const o of (overrides || [])) {
    if (o.visible) {
      const minTier = catalog[o.perm_key]
      if (minTier) {
        if (hier.indexOf(minTier) > tierIdx) continue // above ceiling
      } else if (o.perm_key.startsWith('report:')) {
        // Fail closed: a report grant absent from the catalog has no known
        // ceiling, and report endpoints honor report:<key> grants directly, so
        // an uncatalogued report key must never be addable via an override.
        continue
      }
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

async function getEffectivePermissions(staff) {
  if (!staff) return []
  const baseKeys = staff.role === 'custom'
    ? (Array.isArray(staff.custom_tiles) ? staff.custom_tiles : [])
    : await tilesForRole(staff.role)
  const [overrides, catalog, baseTier] = await Promise.all([
    overridesForStaff(staff.id),
    loadCatalog(),
    getBaseTier(staff.role),
  ])
  return applyOverrides(baseKeys, overrides, catalog, baseTier, ROLE_HIERARCHY)
}

module.exports = { getEffectivePermissions, applyOverrides }

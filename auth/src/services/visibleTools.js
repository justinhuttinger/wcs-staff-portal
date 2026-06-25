// auth/src/services/visibleTools.js
// Single source of truth for "which portal tiles can this staff member see".
// Used by GET /auth/me (to tell the frontend what to render) and by the
// requireTile() middleware (to gate the matching backend routes), so the tile
// a user sees and the API it can call never drift apart.
//
// Custom-role members get exactly the tiles an admin granted them
// (staff.custom_tiles). Every other role resolves to the per-role
// role_tool_visibility config, which is static enough to cache briefly.
const { supabaseAdmin } = require('./supabase')
const memoryCache = require('./memoryCache')

const ROLE_TILES_TTL_MS = 5 * 60 * 1000

async function tilesForRole(role) {
  return memoryCache.wrap(`role_tool_visibility:${role}`, ROLE_TILES_TTL_MS, async () => {
    const { data } = await supabaseAdmin
      .from('role_tool_visibility')
      .select('tool_key')
      .eq('role', role)
      .eq('visible', true)
    return (data || []).map(v => v.tool_key)
  })
}

// Resolve the list of visible tile keys for a staff record (the same shape
// req.staff has after the auth middleware).
async function getVisibleTools(staff) {
  if (!staff) return []
  if (staff.role === 'custom') {
    return Array.isArray(staff.custom_tiles) ? staff.custom_tiles : []
  }
  return tilesForRole(staff.role)
}

module.exports = { getVisibleTools }

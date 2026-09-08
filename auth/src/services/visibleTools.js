// auth/src/services/visibleTools.js
// Single source of truth for "which portal tiles can this staff member see".
// Used by GET /auth/me and by the requireTile() middleware so the tile a user
// sees and the API it can call never drift apart. Delegates to the RBAC v2
// effective-permission compute (base role toggles + per-person overrides,
// clamped to the role's tier ceiling), then drops the tiles whose club does
// not have the underlying facility (see lib/featureGatedTiles).
const { getEffectivePermissions } = require('./permissions')
const { hasGatedKeys, filterByFeatures } = require('../lib/featureGatedTiles')
const clubFeatures = require('../lib/clubFeatures')
const { allowedClubsFor } = require('../lib/groupXScope')

async function getVisibleTools(staff) {
  if (!staff) return []
  const keys = await getEffectivePermissions(staff)
  if (!hasGatedKeys(keys)) return keys
  try {
    const [clubs, map] = await Promise.all([allowedClubsFor(staff), clubFeatures.loadMap()])
    return filterByFeatures(keys, clubs, map)
  } catch (err) {
    // A club-feature lookup failing should not blank someone's home board or
    // lock them out of a tile their role grants. Fall back to unfiltered.
    console.error('[visibleTools] club feature filter failed:', err.message)
    return keys
  }
}

module.exports = { getVisibleTools }

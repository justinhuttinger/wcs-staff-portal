// auth/src/middleware/tile.js
// Gate a route on whether the staff member actually has a given portal tile,
// rather than on a fixed role tier. This lets backend access track exactly what
// an admin exposed via role_tool_visibility / custom_tiles — so a route is
// reachable by precisely the users who can see the tile that opens it.
//
// Must run after the authenticate middleware (it reads req.staff).
const { getVisibleTools } = require('../services/visibleTools')

function requireTile(tileKey) {
  return async (req, res, next) => {
    try {
      const tiles = await getVisibleTools(req.staff)
      if (!tiles.includes(tileKey)) {
        return res.status(403).json({ error: 'Tile access required: ' + tileKey })
      }
      next()
    } catch (err) {
      console.error('[requireTile] check failed:', err.message)
      res.status(500).json({ error: 'tile check failed' })
    }
  }
}

module.exports = { requireTile }

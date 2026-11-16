// Owner-only gate for the Hub and Follow-ups: admin role AND an email on
// FOLLOW_UPS_EMAILS. The portal hides the tile with the same list.
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const OWNER_EMAILS = (process.env.FOLLOW_UPS_EMAILS || 'justin@wcstrength.com')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

function requireOwner(req, res, next) {
  if (!OWNER_EMAILS.includes(String(req.staff?.email || '').toLowerCase())) {
    return res.status(403).json({ error: 'Not available' })
  }
  next()
}

const ownerOnly = [authenticate, requireRole('admin'), requireOwner]

module.exports = { requireOwner, ownerOnly, OWNER_EMAILS }

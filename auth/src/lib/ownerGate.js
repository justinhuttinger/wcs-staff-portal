// Owner-only gate for the Hub and Follow-ups: admin role AND an email on
// FOLLOW_UPS_EMAILS. The portal hides the tile with the same list.
//
// Several routers are mounted at /hub and each starts with this gate, so one
// request can pass through it up to four times. Authentication is a network
// call to Supabase Auth plus a staff lookup; the gate remembers on the request
// that it already passed, so that work happens once per request.
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

const PASSED = Symbol('hubOwnerPassed')

// One middleware: authenticate -> admin -> owner email, skipped when this
// request already passed it. Dependencies injectable for tests.
function onceOwnerGate({ authenticate: auth, requireAdmin, ownerEmails }) {
  const emails = ownerEmails.map(e => e.toLowerCase())
  return (req, res, next) => {
    if (req[PASSED]) return next()
    return auth(req, res, () => requireAdmin(req, res, () => {
      if (!emails.includes(String(req.staff?.email || '').toLowerCase())) {
        return res.status(403).json({ error: 'Not available' })
      }
      req[PASSED] = true
      return next()
    }))
  }
}

const ownerOnly = onceOwnerGate({ authenticate, requireAdmin: requireRole('admin'), ownerEmails: OWNER_EMAILS })

module.exports = { requireOwner, ownerOnly, onceOwnerGate, OWNER_EMAILS }

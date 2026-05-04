// All possible roles mapped to their effective hierarchy level
// front_desk and personal_trainer are equivalent to team_member
// director is equivalent to corporate
const ROLE_ALIASES = {
  front_desk: 'team_member',
  personal_trainer: 'team_member',
  director: 'corporate',
}

// 'marketing' sits ABOVE 'corporate' but below 'admin' so that
// requireRole('corporate') checks (reports, meta ads, google analytics,
// google business) all pass for marketing without needing per-endpoint
// allowlists. The portal UI for the marketing role is restricted to a
// curated 3-tile layout regardless of what the API would otherwise allow.
const ROLE_HIERARCHY = ['team_member', 'lead', 'manager', 'corporate', 'marketing', 'admin']

function resolveRole(role) {
  return ROLE_ALIASES[role] || role
}

// Report access matrix — which roles can view which reports
const REPORT_ACCESS = {
  membership:   ['lead', 'manager', 'marketing', 'corporate', 'admin'],
  'club-health': ['manager', 'marketing', 'corporate', 'admin'],
  pt:           ['lead', 'manager', 'marketing', 'corporate', 'admin'],
  marketing:    ['marketing', 'corporate', 'admin'],
}

// Roles that can see all locations (not locked to home club)
const ALL_LOCATION_ROLES = ['marketing', 'corporate', 'admin']

function requireRole(minimumRole) {
  const minLevel = ROLE_HIERARCHY.indexOf(minimumRole)
  if (minLevel === -1) throw new Error('Invalid role: ' + minimumRole)

  return (req, res, next) => {
    const userLevel = ROLE_HIERARCHY.indexOf(resolveRole(req.staff.role))
    if (userLevel < minLevel) {
      return res.status(403).json({ error: 'Insufficient role. Requires: ' + minimumRole })
    }
    next()
  }
}

function canSeeAllLocations(role) {
  return ALL_LOCATION_ROLES.includes(resolveRole(role))
}

function canAccessReport(role, reportKey) {
  const allowed = REPORT_ACCESS[reportKey]
  return allowed ? allowed.includes(resolveRole(role)) : false
}

module.exports = { requireRole, resolveRole, ROLE_HIERARCHY, ROLE_ALIASES, REPORT_ACCESS, canAccessReport, canSeeAllLocations, ALL_LOCATION_ROLES }

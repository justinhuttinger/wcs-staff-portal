const ROLE_HIERARCHY = ['team_member', 'fd_lead', 'pt_lead', 'manager', 'corporate', 'admin']

// Report access matrix — which roles can view which reports
const REPORT_ACCESS = {
  membership:   ['fd_lead', 'manager', 'corporate', 'admin'],
  'club-health': ['manager', 'corporate', 'admin'],
  pt:           ['pt_lead', 'manager', 'corporate', 'admin'],
  marketing:    ['corporate', 'admin'],
}

// Roles that can see all locations (not locked to home club)
const ALL_LOCATION_ROLES = ['corporate', 'admin']

function requireRole(minimumRole) {
  const minLevel = ROLE_HIERARCHY.indexOf(minimumRole)
  if (minLevel === -1) throw new Error('Invalid role: ' + minimumRole)

  return (req, res, next) => {
    const userLevel = ROLE_HIERARCHY.indexOf(req.staff.role)
    if (userLevel < minLevel) {
      return res.status(403).json({ error: 'Insufficient role. Requires: ' + minimumRole })
    }
    next()
  }
}

function canAccessReport(role, reportKey) {
  const allowed = REPORT_ACCESS[reportKey]
  return allowed ? allowed.includes(role) : false
}

function canSeeAllLocations(role) {
  return ALL_LOCATION_ROLES.includes(role)
}

module.exports = { requireRole, ROLE_HIERARCHY, REPORT_ACCESS, canAccessReport, canSeeAllLocations, ALL_LOCATION_ROLES }

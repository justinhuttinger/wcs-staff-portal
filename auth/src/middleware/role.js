// All possible roles mapped to their effective hierarchy level
// front_desk and personal_trainer are equivalent to team_member
// director is equivalent to corporate
const ROLE_ALIASES = {
  front_desk: 'team_member',
  personal_trainer: 'team_member',
  director: 'corporate',
}

// Role tiers, low → high. Notes:
//  * 'custom' sits just ABOVE 'lead' but BELOW 'manager'. That means a
//    custom-role member can reach the lead-tier endpoints (membership / PT /
//    club-health / check-in reports, comm notes, trainer availability, …) for
//    anything an admin grants them, but is hard-blocked from manager+ APIs
//    (HR, payroll, revenue, operations) and corporate APIs (meta ads, Google).
//    The curated tile/report picker is therefore backed by a real server gate.
//  * 'marketing' is legacy. Marketing is now an add-on capability (see
//    marketing_addon) layered on a base role, not a standalone role; the tier
//    is kept only so any pre-migration rows still resolve sanely.
const ROLE_HIERARCHY = ['team_member', 'lead', 'custom', 'manager', 'corporate', 'marketing', 'admin']

function resolveRole(role) {
  return ROLE_ALIASES[role] || role
}

function roleLevel(role) {
  return ROLE_HIERARCHY.indexOf(resolveRole(role))
}

// Report access matrix — which roles can view which reports
const REPORT_ACCESS = {
  membership:   ['lead', 'manager', 'marketing', 'corporate', 'admin'],
  'club-health': ['manager', 'marketing', 'corporate', 'admin'],
  pt:           ['lead', 'manager', 'marketing', 'corporate', 'admin'],
  checkins:     ['lead', 'manager', 'marketing', 'corporate', 'admin'],
  'pt-sessions': ['lead', 'manager', 'marketing', 'corporate', 'admin'],
  payroll:      ['manager', 'corporate', 'admin'],
  revenue:      ['manager', 'corporate', 'admin'],
  marketing:    ['marketing', 'corporate', 'admin'],
  'daily-snapshot': ['manager', 'marketing', 'corporate', 'admin'],
}

// Roles that can see all locations (not locked to home club). 'custom' is
// intentionally excluded — custom members are limited to their assigned clubs.
const ALL_LOCATION_ROLES = ['marketing', 'corporate', 'admin']

function requireRole(minimumRole) {
  const minLevel = ROLE_HIERARCHY.indexOf(minimumRole)
  if (minLevel === -1) throw new Error('Invalid role: ' + minimumRole)

  return (req, res, next) => {
    const userLevel = roleLevel(req.staff.role)
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

// --- Marketing add-on ------------------------------------------------------
//
// Marketing is a capability layered on top of a base role. Full marketing
// access (Marketing Tracker for every club + type, plus marketing reports) is
// granted either by a corporate-or-higher base role OR by the add-on flag.
// Add-on members below corporate can be scoped to specific clubs and types.

function isFullMarketing(staff) {
  // corporate / admin (and legacy marketing) always get unrestricted marketing.
  return roleLevel(staff?.role) >= ROLE_HIERARCHY.indexOf('corporate')
}

function hasMarketingAddon(staff) {
  return !!(staff && staff.marketing_addon)
}

// Whether this member can open the Marketing Tracker / marketing reports at all.
function canUseMarketing(staff) {
  return isFullMarketing(staff) || hasMarketingAddon(staff)
}

// The clubs + effort types a member may see/edit in the Marketing Tracker.
// `null` means "no restriction" (all clubs / all types). Full-marketing members
// are never restricted; scoped add-on members get their configured arrays.
function marketingScope(staff) {
  if (isFullMarketing(staff)) return { locations: null, types: null }
  const locations = Array.isArray(staff?.marketing_locations) && staff.marketing_locations.length
    ? staff.marketing_locations.map(s => String(s).toLowerCase())
    : null
  const types = Array.isArray(staff?.marketing_types) && staff.marketing_types.length
    ? staff.marketing_types.map(String)
    : null
  return { locations, types }
}

// Router/route middleware: allow only members with marketing access.
function requireMarketing(req, res, next) {
  if (!canUseMarketing(req.staff)) {
    return res.status(403).json({ error: 'Marketing access required' })
  }
  next()
}

module.exports = {
  requireRole, resolveRole, roleLevel, ROLE_HIERARCHY, ROLE_ALIASES,
  REPORT_ACCESS, canAccessReport, canSeeAllLocations, ALL_LOCATION_ROLES,
  isFullMarketing, hasMarketingAddon, canUseMarketing, marketingScope, requireMarketing,
}

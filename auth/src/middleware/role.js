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

// In-memory map of admin-created (non-builtin) role name -> canonical base tier.
// This is what lets the SYNCHRONOUS gates below (roleLevel/requireRole/
// canSeeAllLocations/canAccessReport) resolve a custom role the same way the
// async permission compute does. Built-in roles are deliberately NOT loaded
// here — their behavior stays exactly as before (identity or alias), so the
// built-in 'custom' role keeps resolving to 'custom' (its own tier), not to its
// 'lead' base_tier. Empty until refreshCustomRoleTiers() runs at startup; an
// unknown custom role therefore resolves to tier -1 (blocked) — fail closed.
let _customRoleTiers = {}

// Test/seam hook: set the map directly without touching the database.
function setCustomRoleTiers(map) {
  _customRoleTiers = map && typeof map === 'object' ? { ...map } : {}
}

// Load every non-builtin role's base_tier into the in-memory map. Call at
// startup and after any role create/rename/delete so the sync gates see custom
// roles. Lazy-requires supabase (it throws at import time without env).
async function refreshCustomRoleTiers() {
  const { supabaseAdmin } = require('../services/supabase')
  const { data, error } = await supabaseAdmin
    .from('roles').select('name, base_tier').eq('is_builtin', false)
  if (error) throw error
  const map = {}
  for (const r of (data || [])) {
    if (r.name && ROLE_HIERARCHY.includes(r.base_tier)) map[r.name] = r.base_tier
  }
  _customRoleTiers = map
  return map
}

function resolveRole(role) {
  // Aliases first (front_desk -> team_member, …) so a pathological custom role
  // sharing an alias name can never shadow the canonical alias mapping.
  if (ROLE_ALIASES[role]) return ROLE_ALIASES[role]
  if (_customRoleTiers[role]) return _customRoleTiers[role]
  return role
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
  'pt-projections': ['manager', 'marketing', 'corporate', 'admin'],
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

// RBAC v2: marketing decomposed into role-grantable capabilities plus per-type
// grants. A role/override may grant marketing:tracker / marketing:needs /
// marketing:research and any subset of marketing_type:<slug>. Legacy access
// (corporate+ tier or the marketing_addon flag) still grants all three
// capabilities and preserves the member's existing club/type scope.
const MARKETING_CAPS = ['tracker', 'needs', 'research']

async function marketingContext(staff) {
  // Fast path: corporate+ is unconditionally full marketing (all caps, all
  // types). Skip the effective-permission query entirely — this is the common
  // case and the tracker polls frequently.
  if (isFullMarketing(staff)) {
    return { capabilities: new Set(MARKETING_CAPS), types: [] }
  }
  const caps = new Set()
  if (hasMarketingAddon(staff)) for (const c of MARKETING_CAPS) caps.add(c)
  let permTypes = null
  try {
    const { getEffectivePermissions } = require('../services/permissions')
    const perms = await getEffectivePermissions(staff)
    for (const c of MARKETING_CAPS) if (perms.includes('marketing:' + c)) caps.add(c)
    const t = perms.filter(p => p.startsWith('marketing_type:')).map(p => p.slice('marketing_type:'.length))
    if (t.length) permTypes = t
  } catch (err) {
    console.error('[marketingContext] effective-perm check failed:', err.message)
  }
  // Effort-type scope: explicitly granted types win; else the member's legacy
  // type scope ([] means unrestricted, handled by marketingScope()).
  const types = permTypes || (Array.isArray(staff?.marketing_types) && staff.marketing_types.length
    ? staff.marketing_types.map(String) : [])
  return { capabilities: caps, types }
}

// Router/route middleware: allow a member through if their role tier already
// meets `minRole`, OR if they are a custom-role member who has been granted one
// of `grantKeys` in their custom_reports. This is what lets an admin hand a
// single custom-role member an otherwise manager/corporate-gated report (KPIs,
// Meta Ads, Google) without promoting their whole role. Non-custom roles keep
// the exact same tier check as requireRole.
function requireReportAccess(minRole, grantKeys = []) {
  const minLevel = ROLE_HIERARCHY.indexOf(minRole)
  if (minLevel === -1) throw new Error('Invalid role: ' + minRole)
  const grants = Array.isArray(grantKeys) ? grantKeys : [grantKeys]
  return async (req, res, next) => {
    // This middleware is async; an uncaught throw here would hang the request
    // under Express 4 rather than reach the error handler. Guard the missing
    // staff case explicitly (callers mount authenticate first, but be safe).
    if (!req.staff) return res.status(401).json({ error: 'Authentication required' })
    if (roleLevel(req.staff.role) >= minLevel) return next()
    // Legacy custom-role grant path (still honored).
    if (resolveRole(req.staff.role) === 'custom') {
      const granted = req.staff.custom_reports
      if (Array.isArray(granted) && grants.some(k => granted.includes(k))) return next()
    }
    // RBAC v2: an effective report:<key> permission (role toggle or override).
    try {
      const { getEffectivePermissions } = require('../services/permissions')
      const perms = await getEffectivePermissions(req.staff)
      if (grants.some(k => perms.includes('report:' + k))) return next()
    } catch (err) {
      console.error('[requireReportAccess] effective-perm check failed:', err.message)
    }
    return res.status(403).json({ error: 'Insufficient role. Requires: ' + minRole })
  }
}

// Router middleware: gate the Marketing Tracker on having ANY marketing
// capability (legacy access or a role/override grant), and stash the resolved
// capabilities + effort-type scope so downstream gates and the existing sync
// scope machinery (marketingScope on req.staff) operate on the effective values.
async function requireMarketing(req, res, next) {
  try {
    if (!req.staff) return res.status(401).json({ error: 'Authentication required' })
    const ctx = await marketingContext(req.staff)
    if (ctx.capabilities.size === 0) {
      return res.status(403).json({ error: 'Marketing access required' })
    }
    req.marketingCaps = ctx.capabilities
    // Enrich the per-request staff so the sync marketingScope() reflects the
    // effective granted types. Full-marketing (corporate+) stays unrestricted
    // inside marketingScope regardless of this value.
    req.staff.marketing_types = ctx.types
    next()
  } catch (err) {
    console.error('[requireMarketing] failed:', err.message)
    return res.status(500).json({ error: 'Marketing check failed' })
  }
}

// Route middleware: require a specific marketing capability (tracker / needs /
// research). Must be mounted after requireMarketing (reads req.marketingCaps).
function requireMarketingCapability(cap) {
  return (req, res, next) => {
    if (!req.marketingCaps || !req.marketingCaps.has(cap)) {
      return res.status(403).json({ error: 'Marketing access required' })
    }
    next()
  }
}

module.exports = {
  requireRole, requireReportAccess, resolveRole, roleLevel, ROLE_HIERARCHY, ROLE_ALIASES,
  REPORT_ACCESS, canAccessReport, canSeeAllLocations, ALL_LOCATION_ROLES,
  isFullMarketing, hasMarketingAddon, canUseMarketing, marketingScope,
  marketingContext, requireMarketing, requireMarketingCapability,
  refreshCustomRoleTiers, setCustomRoleTiers,
}

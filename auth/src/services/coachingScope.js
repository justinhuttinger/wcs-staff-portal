// auth/src/services/coachingScope.js
// Resolves the caller's Coaching scope (lib/coachingScope.js) from their
// assigned locations, and checks one client against it. Shared by
// routes/coaching.js and the per-member routes in routes/memberApp.js, so a
// trainer reaches exactly the same clients through either.
const { supabaseAdmin } = require('./supabase')
const { canSeeAllLocations, roleLevel } = require('../middleware/role')
const { getUserAllowedSlugs } = require('./locationScope')
const { clubBySlug } = require('../config/clubs')
const { scopeFor, canAccessClient, clubsForTrainer, isCoachScope } = require('../lib/coachingScope')
const { getVisibleTools } = require('./visibleTools')

const MEMBERS = 'memberapp_members'
const MEMBER_COLS = 'member_id, club_number, tier, coach_staff_id, status, archived_at, upgraded_at, upgraded_by, updated_at, nutrition_enabled'

class ScopeError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

async function resolveCoachScope(req) {
  if (req._coachScope) return req._coachScope
  const staff = req.staff || {}
  let clubs = []
  if (!canSeeAllLocations(staff.role)) {
    const slugs = await getUserAllowedSlugs(req)
    clubs = slugs.map(s => clubBySlug(s)?.clubNumber).filter(Boolean)
  }
  const scope = scopeFor(staff, { allowedClubNumbers: clubs })
  if (isCoachScope(scope) && !scope.clubNumbers.length && scope.coachStaffId) {
    // A trainer with no assigned club still finds members at the clubs of
    // the clients they already coach; with neither, they find nobody.
    const { data } = await supabaseAdmin.from(MEMBERS).select('club_number').eq('coach_staff_id', scope.coachStaffId)
    scope.clubNumbers = clubsForTrainer([], data || [])
  }
  req._coachScope = scope
  return scope
}

async function loadClientRow(memberId, clubNumber) {
  const { data, error } = await supabaseAdmin
    .from(MEMBERS).select(MEMBER_COLS)
    .eq('member_id', String(memberId)).eq('club_number', String(clubNumber))
    .maybeSingle()
  if (error) throw new ScopeError(502, error.message)
  return data
}

/**
 * The client row if the caller may work with this member, else a 404 (never
 * 403, so a guessed member id says nothing about who exists). Managers and
 * admins may open a member at their clubs who has no row yet.
 */
async function assertClientAccess(req, memberId, clubNumber) {
  if (!memberId || !clubNumber) throw new ScopeError(400, 'member_id and club_number are required')
  const scope = await resolveCoachScope(req)
  const row = await loadClientRow(memberId, clubNumber)
  const subject = row || (isCoachScope(scope) ? null : { member_id: String(memberId), club_number: String(clubNumber) })
  if (!canAccessClient(scope, subject)) throw new ScopeError(404, 'Client not found')
  return { scope, client: row }
}

/**
 * Express middleware for /member-app's per-member routes. Managers and up keep
 * the Admin -> Member App behavior they had. Below manager, the caller needs
 * the Coaching tile and the member must be their client. `locate(req)` returns
 * { member_id, club_number } (may be async, e.g. from a habit row).
 */
function requireClientAccess(locate) {
  return async (req, res, next) => {
    try {
      if (!req.staff) return res.status(401).json({ error: 'Authentication required' })
      if (roleLevel(req.staff.role) >= roleLevel('manager')) return next()
      const tiles = await getVisibleTools(req.staff)
      if (!tiles.includes('coaching')) return res.status(403).json({ error: 'Tile access required: coaching' })
      const pair = await locate(req)
      if (!pair) return res.status(404).json({ error: 'Not found' })
      await assertClientAccess(req, pair.member_id, pair.club_number)
      next()
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message })
    }
  }
}

module.exports = { resolveCoachScope, loadClientRow, assertClientAccess, requireClientAccess, ScopeError, MEMBER_COLS }

// auth/src/lib/coachingScope.js
// Whose clients a staff member may see and change in Coaching. Pure; the
// routes resolve the caller's club numbers (lib/coachingScopeLoad.js) and pass
// them in.
//
//   corporate / director / admin (canSeeAllLocations)  -> { all: true }
//   manager                                            -> { clubNumbers }
//   anyone below manager (trainers are often leads or
//   team members, and the custom role sits here too)   -> { coachStaffId, clubNumbers }
//
// For a trainer `clubNumbers` only says where they may look up and add new
// clients. Access to an existing client is by coach, never by club, so one
// trainer cannot open another trainer's client at the same club.
const { canSeeAllLocations, roleLevel } = require('../middleware/role')

const clubKey = (v) => (v == null ? '' : String(v).trim())
const uniq = (list) => [...new Set((list || []).map(clubKey).filter(Boolean))]

function scopeFor(staff, { allowedClubNumbers } = {}) {
  const clubs = uniq(allowedClubNumbers)
  if (canSeeAllLocations(staff?.role)) return { all: true }
  if (roleLevel(staff?.role) >= roleLevel('manager')) return { clubNumbers: clubs }
  // No id means no client can ever match; '' never equals a stored uuid.
  return { coachStaffId: staff?.id ? String(staff.id) : '', clubNumbers: clubs }
}

const isAllScope = (scope) => Boolean(scope && scope.all)
const isCoachScope = (scope) => Boolean(scope && 'coachStaffId' in scope)

/** client = a memberapp_members row (or { club_number } for a manager check). */
function canAccessClient(scope, client) {
  if (!scope || !client) return false
  if (scope.all) return true
  if (isCoachScope(scope)) {
    return Boolean(scope.coachStaffId) && String(client.coach_staff_id || '') === scope.coachStaffId
  }
  return (scope.clubNumbers || []).includes(clubKey(client.club_number))
}

/** Where a new client may be added (member search and upgrade). */
function canAddAtClub(scope, clubNumber) {
  const club = clubKey(clubNumber)
  if (!scope || !club) return false
  if (scope.all) return true
  return (scope.clubNumbers || []).includes(club)
}

/**
 * A trainer's clubs for finding members: their assigned clubs, or (when they
 * have none) the clubs of the clients they already coach, or none at all.
 */
function clubsForTrainer(assignedClubNumbers, existingClients) {
  const assigned = uniq(assignedClubNumbers)
  if (assigned.length) return assigned
  return uniq((existingClients || []).map(c => c.club_number))
}

function filterClients(scope, rows) {
  return (rows || []).filter(r => canAccessClient(scope, r))
}

module.exports = {
  scopeFor, canAccessClient, canAddAtClub, clubsForTrainer, filterClients, isAllScope, isCoachScope,
}

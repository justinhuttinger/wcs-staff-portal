// WCS University — GHL user directory + enrollment writes.
//
// GHL's company-wide user listing (GET /users/?companyId=) is rejected for a
// location-level token ("E-102 AuthClass not supported"), so we instead read
// users per location with the token each location already has (the 7 club keys
// in ghlLocations + the University key) and aggregate. User *writes* (create /
// update) DO work with the University location token (users.write present), so
// enrollment grants University access + sets permissions through that token.
//
// A GHL user is a company-level object: `roles.locationIds` is the set of
// sub-accounts they can access, and `permissions` is a single global object
// (NOT per-location) — flipping assignedDataOnly affects the user everywhere,
// which is called out in the README. We clone a template user's permissions and
// only set assignedDataOnly on enroll.

const { ghlFetch } = require('../ghlClient')
const { LOCATIONS, getUniversityLocation } = require('../../config/ghlLocations')

// Every location token we can read users with, University first.
function readableLocations() {
  const uni = getUniversityLocation()
  return [...(uni ? [uni] : []), ...LOCATIONS]
}

// List users for one location; never throws (a bad/again-rate-limited token
// just contributes nothing).
async function listUsersAtLocation(loc) {
  try {
    const data = await ghlFetch('/users/', loc.apiKey, { params: { locationId: loc.id } })
    return data.users || []
  } catch (err) {
    console.warn(`[university/users] list at ${loc.name} failed: ${err.message}`)
    return []
  }
}

// Aggregate users across every readable location, deduped by id. Each returned
// user carries `seen_in` (slugs we found them through) and `enrolled` (already
// has the University location in roles.locationIds).
async function listAllUsers() {
  const uni = getUniversityLocation()
  const locs = readableLocations()
  const results = await Promise.all(locs.map(async loc => ({ loc, users: await listUsersAtLocation(loc) })))

  const byId = new Map()
  for (const { loc, users } of results) {
    for (const u of users) {
      if (!u.id) continue
      const existing = byId.get(u.id)
      if (existing) {
        existing.seen_in.push(loc.slug)
        continue
      }
      const locationIds = u.roles?.locationIds || []
      byId.set(u.id, {
        id: u.id,
        name: u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim(),
        firstName: u.firstName || null,
        lastName: u.lastName || null,
        email: u.email || null,
        phone: u.phone || null,
        roleType: u.roles?.type || null,
        role: u.roles?.role || null,
        locationIds,
        seen_in: [loc.slug],
        enrolled: uni ? locationIds.includes(uni.id) : false,
      })
    }
  }
  return [...byId.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}

// Full user object (includes the `permissions` object the list endpoint omits).
// Tries the University token first, then each club token until one resolves.
async function getUser(userId) {
  for (const loc of readableLocations()) {
    try {
      const data = await ghlFetch(`/users/${userId}`, loc.apiKey)
      if (data && (data.id || data.user?.id)) return data.user || data
    } catch {
      // try the next location's token
    }
  }
  return null
}

// Resolve the permission template user (default: the "staffpermissions" account)
// from the aggregated directory, then fetch its full record for `permissions`.
// Configurable by id (GHL_PERMISSION_TEMPLATE_USER_ID) or name/email substring
// (GHL_PERMISSION_TEMPLATE_USER, default "staffpermissions").
async function getTemplatePermissions() {
  const byId = process.env.GHL_PERMISSION_TEMPLATE_USER_ID
  if (byId) {
    const u = await getUser(byId)
    return u?.permissions || null
  }
  const needle = (process.env.GHL_PERMISSION_TEMPLATE_USER || 'staffpermissions').toLowerCase()
  const all = await listAllUsers()
  const match = all.find(u =>
    (u.name || '').toLowerCase().includes(needle) || (u.email || '').toLowerCase().includes(needle))
  if (!match) return null
  const full = await getUser(match.id)
  return full?.permissions || null
}

// Grant a user access to the University sub-account and apply restricted
// permissions. Returns { ok, granted, permissionsApplied, error }. Never throws.
//
// permissions = template (or the user's current set) with assignedDataOnly=true,
// so the trainee only ever sees their own assigned practice contacts.
async function grantUniversityAccess(userId) {
  const uni = getUniversityLocation()
  if (!uni) return { ok: false, error: 'University location not configured (GHL_UNIVERSITY_*)' }

  const user = await getUser(userId)
  if (!user) return { ok: false, error: `GHL user ${userId} not found via any location token` }

  const currentLocs = user.roles?.locationIds || []
  const locationIds = currentLocs.includes(uni.id) ? currentLocs : [...currentLocs, uni.id]

  const template = await getTemplatePermissions().catch(() => null)
  const basePerms = template || user.permissions || {}
  const permissions = { ...basePerms, assignedDataOnly: true }

  // PUT replaces the user; resend the identifying fields alongside the changes.
  const body = {
    companyId: user.companyId,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone || undefined,
    type: user.roles?.type || 'account',
    role: user.roles?.role || 'user',
    locationIds,
    permissions,
  }

  try {
    await ghlFetch(`/users/${userId}`, uni.apiKey, { method: 'PUT', body })
    return { ok: true, granted: true, permissionsApplied: true, usedTemplate: !!template }
  } catch (err) {
    return { ok: false, granted: false, permissionsApplied: false, error: err.message }
  }
}

module.exports = { listAllUsers, getUser, getTemplatePermissions, grantUniversityAccess }

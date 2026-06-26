// Pure helpers for the admin roles manager. No I/O here so they are unit
// testable; the route layer in config.js does the DB work.
const TIERS = ['team_member', 'lead', 'manager', 'corporate', 'admin']
const CATEGORY_ORDER = { Apps: 0, Tools: 1, Reports: 2, Actions: 3 }

function validateRoleName(name, existingNames) {
  const trimmed = (name || '').trim()
  if (!trimmed) return { ok: false, error: 'Role name is required' }
  if (trimmed.length > 40) return { ok: false, error: 'Role name must be 40 characters or fewer' }
  const lower = trimmed.toLowerCase()
  if ((existingNames || []).some(n => String(n).toLowerCase() === lower)) {
    return { ok: false, error: 'A role with that name already exists' }
  }
  return { ok: true }
}

function buildPermissionGrid(catalog, tileLabels) {
  const rows = [...(catalog || [])]
  for (const [perm_key, meta] of Object.entries(tileLabels || {})) {
    rows.push({ perm_key, label: meta.label || perm_key, category: 'Tools', min_tier: 'team_member' })
  }
  rows.sort((a, b) => {
    const c = (CATEGORY_ORDER[a.category] ?? 9) - (CATEGORY_ORDER[b.category] ?? 9)
    if (c !== 0) return c
    return String(a.label).localeCompare(String(b.label))
  })
  return rows
}

// Turn a per-person override editor payload into the DB writes for
// staff_permission_overrides. `items` is [{ perm_key, state }] where state is
// 'inherit' | 'on' | 'off'. Returns { toDelete: [perm_key], toUpsert:
// [{ staff_id, perm_key, visible }] }. No tier ceiling — an override grants
// exactly what it states (roles are fully customizable).
function planOverrideWrites(items, staffId) {
  const toDelete = []
  const toUpsert = []
  for (const it of (items || [])) {
    const key = it && it.perm_key
    if (!key) continue
    if (it.state === 'inherit') { toDelete.push(key); continue }
    if (it.state !== 'on' && it.state !== 'off') continue
    toUpsert.push({ staff_id: staffId, perm_key: key, visible: it.state === 'on' })
  }
  return { toDelete, toUpsert }
}

module.exports = { TIERS, validateRoleName, buildPermissionGrid, planOverrideWrites }

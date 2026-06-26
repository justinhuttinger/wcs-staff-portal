// Pure helpers for the admin roles manager. No I/O here so they are unit
// testable; the route layer in config.js does the DB work.
const TIERS = ['team_member', 'lead', 'manager', 'corporate', 'admin']
const CATEGORY_ORDER = { Apps: 0, Tools: 1, Reports: 2, Marketing: 3, 'Marketing Types': 4, Actions: 5 }

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

// Map a custom tile to the role-editor category it should appear under. Tiles
// nested in a "Reporting" / "Marketing" parent group are grouped with the
// matching catalog category; everything else stays in Tools. Keep the returned
// values within the frontend's fixed CATEGORIES list.
function tileCategoryForParent(parentLabel) {
  const p = String(parentLabel || '').toLowerCase()
  if (p.includes('report')) return 'Reports'
  if (p.includes('marketing')) return 'Marketing'
  return 'Tools'
}

// Build the { 'tile:<id>': { label, category } } map the grid expects from raw
// custom_tiles rows (each { id, label, parent_id }).
function tileLabelsFromRows(tiles) {
  const byId = Object.fromEntries((tiles || []).map(t => [t.id, t]))
  const out = {}
  for (const t of (tiles || [])) {
    const parent = t.parent_id ? byId[t.parent_id] : null
    out['tile:' + t.id] = {
      label: t.label,
      category: parent ? tileCategoryForParent(parent.label) : 'Tools',
    }
  }
  return out
}

function buildPermissionGrid(catalog, tileLabels) {
  const rows = [...(catalog || [])]
  for (const [perm_key, meta] of Object.entries(tileLabels || {})) {
    // Custom tiles default to 'Tools', but a tile nested under a parent group
    // (e.g. the report children Membership/PT, or the ad-account links
    // Facebook/Google) is grouped into the matching catalog category so it does
    // not show loose in Tools. meta.category is supplied by the route builder.
    rows.push({ perm_key, label: meta.label || perm_key, category: meta.category || 'Tools', min_tier: 'team_member' })
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

module.exports = { TIERS, validateRoleName, buildPermissionGrid, planOverrideWrites, tileLabelsFromRows, tileCategoryForParent }

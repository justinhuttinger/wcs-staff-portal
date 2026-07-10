// "What's New" changelog. Entries are shown in the top-bar bell, filtered to the
// people who can actually use the feature via an `audience` tag that mirrors the
// portal's real visibility gates (role tier, tool, or report grant) — so, e.g.,
// a lead who was GRANTED the Till report still sees Till entries, while a lead
// without it does not. No conditions = everyone.
//
// Adding an entry: bump `id` (higher = newer), set `date` (YYYY-MM-DD), write a
// staff-facing `title` + `body` (say what changed and where to find it), and tag
// `audience`. Keep it to things staff can act on — skip internal/dev changes.
//
// audience fields (all optional; an entry shows only if ALL present conditions
// pass):
//   minRole : tier floor — 'lead' | 'manager' | 'corporate' | 'admin'
//   tool    : must have this tool visible — 'inventory' | 'forms' | 'admin'
//   report  : must be able to see this report key — e.g. 'till', 'pos-sales'

// Role ladder (mirrors ToolGrid.jsx ROLE_LEVELS). Higher = more access.
export const ROLE_LEVELS = {
  front_desk: 0, personal_trainer: 0, team_member: 0,
  lead: 1, custom: 1,
  manager: 2,
  director: 3, corporate: 3, marketing: 3,
  admin: 4,
}

const roleIdx = (role) => ROLE_LEVELS[role] ?? 0

// The report keys a user can see — the same union ReportingView computes:
// the built-in `custom` role's per-person custom_reports, plus every
// `report:<key>` grant in visible_tools (regardless of tier).
function visibleReportKeys({ role, visibleTools, customReports }) {
  const set = new Set(role === 'custom' && Array.isArray(customReports) ? customReports : [])
  for (const k of (visibleTools || [])) {
    if (typeof k === 'string' && k.startsWith('report:')) set.add(k.slice('report:'.length))
  }
  return set
}

// Whether a user can see a given tool tile (mirrors ToolGrid gates).
function canSeeTool(tool, { role, visibleTools }) {
  const idx = roleIdx(role)
  switch (tool) {
    case 'inventory': return role !== 'custom' && idx >= ROLE_LEVELS.lead
    case 'forms': return idx >= ROLE_LEVELS.admin || (visibleTools || []).includes('forms')
    case 'admin': return role === 'admin'
    default: return true
  }
}

// ctx: { role, visibleTools, customReports }
export function canSeeChangelogEntry(entry, ctx) {
  const a = entry.audience || {}
  if (a.minRole && roleIdx(ctx.role) < (ROLE_LEVELS[a.minRole] ?? 99)) return false
  if (a.tool && !canSeeTool(a.tool, ctx)) return false
  if (a.report && !visibleReportKeys(ctx).has(a.report)) return false
  return true
}

// Entries the user can see, newest first.
export function visibleChangelog(ctx) {
  return CHANGELOG
    .filter(e => canSeeChangelogEntry(e, ctx))
    .sort((a, b) => b.id - a.id)
}

export const CHANGELOG = [
  {
    id: 1, date: '2026-07-10',
    title: 'Inventory shopping lists',
    body: 'Build reusable reorder checklists in Inventory → To Order → Lists. Each list shows an item’s current on-hand next to its reorder level so you can see what to restock. Open a list to view it; hit Edit to add or remove items.',
    audience: { tool: 'inventory' },
  },
  {
    id: 2, date: '2026-07-10',
    title: 'Set your own reorder levels',
    body: 'On the Inventory → To Order tab, hit “Edit reorder levels” to set the reorder point for each category, per club, instead of the old fixed thresholds.',
    audience: { tool: 'inventory', minRole: 'manager' },
  },
  {
    id: 3, date: '2026-07-10',
    title: 'POS Sales: Compliance detail',
    body: 'The Compliance tab now shows how many items each club counted on their most recent count day. Click a club to expand a day-by-day view of their restock and count activity.',
    audience: { report: 'pos-sales' },
  },
  {
    id: 4, date: '2026-07-10',
    title: 'Employee Spend now visible to managers',
    body: 'The Employee Spend tab on the POS Sales report is no longer admin-only.',
    audience: { report: 'pos-sales', minRole: 'manager' },
  },
  {
    id: 5, date: '2026-07-10',
    title: 'Till report: newest day first, one club at a time',
    body: 'The Till report now lists the most recent day at the top, and you pick a single club at a time (like the Audits report).',
    audience: { report: 'till' },
  },
  {
    id: 6, date: '2026-07-10',
    title: 'Editable till float',
    body: 'Set each club’s standard drawer float under Admin → Till Float. A change applies from that day forward only, so it won’t affect past days’ variances.',
    audience: { minRole: 'admin' },
  },
  {
    id: 7, date: '2026-07-10',
    title: '“View As” preview',
    body: 'Preview the portal as another role (read-only) to check what each staff type can see. Available in the Admin panel.',
    audience: { minRole: 'admin' },
  },
]

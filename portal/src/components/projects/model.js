// Projects: labels, filters and sorting shared by every view. Pure, so the
// filters behave the same in the list now and the board/calendar/Gantt later.

export const PRIORITIES = [
  { value: 'urgent', label: 'Urgent', dot: 'bg-red-600', rank: 0 },
  { value: 'high', label: 'High', dot: 'bg-orange-500', rank: 1 },
  { value: 'medium', label: 'Medium', dot: 'bg-amber-400', rank: 2 },
  { value: 'low', label: 'Low', dot: 'bg-slate-400', rank: 3 },
]
export const PRIORITY = Object.fromEntries(PRIORITIES.map(p => [p.value, p]))

export const STATUSES = [
  { value: 'not_started', label: 'Not Started', tone: 'text-text-muted bg-bg border-border' },
  { value: 'in_progress', label: 'In Progress', tone: 'text-blue-600 bg-blue-500/10 border-blue-500/30' },
  { value: 'complete', label: 'Complete', tone: 'text-green-600 bg-green-500/10 border-green-500/30' },
  { value: 'skipped', label: 'Skipped', tone: 'text-text-muted bg-bg border-border line-through' },
]
export const STATUS = Object.fromEntries(STATUSES.map(s => [s.value, s]))

export const OPEN = ['not_started', 'in_progress']

// Filters. A null list means "all" (so new members or categories are in
// without anyone touching the filter).
//   scope: 'me' (assigned to me) | 'everyone' (then `people` narrows it)
//   statuses: list of status values (board ignores this; it has columns)
export const OPEN_STATUSES = ['not_started', 'in_progress']
export const DEFAULT_FILTERS = {
  scope: 'me',
  people: null,
  statuses: OPEN_STATUSES,
  priorities: null,
  categories: null, // category ids plus 'none' for uncategorised
  due: '', // '' | 'overdue' | 'week' | 'none'
  q: '',
}

// Saved filters from an older shape fall back to the defaults key by key.
export function normalizeFilters(raw = {}) {
  const list = v => (v === null ? null : Array.isArray(v) ? v.map(String) : undefined)
  const out = { ...DEFAULT_FILTERS }
  if (raw.scope === 'me' || raw.scope === 'everyone') out.scope = raw.scope
  for (const k of ['people', 'statuses', 'priorities', 'categories']) {
    const v = list(raw[k])
    if (v !== undefined) out[k] = v
  }
  if (['', 'overdue', 'week', 'none'].includes(raw.due)) out.due = raw.due
  return out
}

// YYYY-MM-DD for a Date in local time.
export function isoDay(d = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return isoDay(d)
}

export function isAssigned(task, staffId) {
  return (task.assignees || []).some(a => a.staff_id === staffId)
}

// `board: true` skips the status list (the board shows statuses as columns)
// but still hides Skipped unless `showSkipped`.
export function filterTasks(tasks, f, { me, today = isoDay(), board = false, showSkipped = false } = {}) {
  const q = String(f.q || '').trim().toLowerCase()
  const weekEnd = addDays(today, 7)
  return (tasks || []).filter(t => {
    if (board) { if (t.status === 'skipped' && !showSkipped) return false }
    else if (f.statuses && !f.statuses.includes(t.status)) return false

    if (f.scope === 'me') { if (!isAssigned(t, me)) return false }
    else if (f.people && !f.people.some(id => isAssigned(t, id))) return false

    if (f.categories && !f.categories.includes(t.category_id || 'none')) return false
    if (f.priorities && !f.priorities.includes(t.priority)) return false

    if (f.due === 'none' && t.due_date) return false
    if (f.due === 'overdue' && !(t.due_date && t.due_date < today && OPEN.includes(t.status))) return false
    if (f.due === 'week' && !(t.due_date && t.due_date >= today && t.due_date <= weekEnd)) return false

    if (q && !`${t.title} ${t.description || ''}`.toLowerCase().includes(q)) return false
    return true
  })
}

// How many filters differ from the defaults (scope aside), for "Clear".
export function activeFilterCount(f, { board = false } = {}) {
  let n = 0
  if (f.scope === 'everyone' && f.people) n++
  if (!board && JSON.stringify(f.statuses) !== JSON.stringify(OPEN_STATUSES)) n++
  if (f.priorities) n++
  if (f.categories) n++
  if (f.due) n++
  return n
}

const rank = t => PRIORITY[t.priority]?.rank ?? 9
const dueKey = t => t.due_date || '9999-12-31'
const byDue = (a, b) => dueKey(a).localeCompare(dueKey(b))
export const SORT_OPTIONS = [
  { value: 'urgent', label: 'Most urgent first' },
  { value: 'due', label: 'Due soonest' },
  { value: 'due_desc', label: 'Due latest' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'manual', label: 'Manual (board order)', boardOnly: true },
]
export const SORTS = {
  urgent: (a, b) => rank(a) - rank(b) || byDue(a, b),
  due: (a, b) => byDue(a, b) || rank(a) - rank(b),
  due_desc: (a, b) => String(b.due_date || '').localeCompare(String(a.due_date || '')) || rank(a) - rank(b),
  newest: (a, b) => String(b.created_at).localeCompare(String(a.created_at)),
  oldest: (a, b) => String(a.created_at).localeCompare(String(b.created_at)),
  updated: (a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)),
  manual: (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(b.created_at).localeCompare(String(a.created_at)),
}
SORTS.priority = SORTS.urgent // older saved value

export function sortTasks(tasks, sort = 'urgent') {
  return [...tasks].sort(SORTS[sort] || SORTS.urgent)
}

// One group per status, in board order, dropping empty ones.
export function groupByStatus(tasks) {
  return STATUSES.map(s => ({ ...s, items: tasks.filter(t => t.status === s.value) }))
    .filter(g => g.items.length)
}

// One line of history, e.g. "Alex moved this to In Progress".
// nameOf(id) and categoryName(id) resolve current names.
const fmtDay = iso => {
  if (!iso) return 'none'
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function describeActivity(row, { nameOf = () => 'Someone', categoryName = () => '' } = {}) {
  const who = row.actor_id ? nameOf(row.actor_id) : 'Someone'
  const d = row.detail || {}
  const names = ids => (ids || []).map(nameOf).join(', ')
  switch (row.kind) {
    case 'created': return `${who} created this task`
    case 'status':
      if (d.to === 'skipped') return `${who} skipped this task${d.reason ? `: ${d.reason}` : ''}`
      if (d.from === 'skipped') return `${who} restored this task`
      if (d.to === 'complete') return `${who} marked this Complete`
      return `${who} moved this to ${STATUS[d.to]?.label || d.to}`
    case 'assigned': return `${who} assigned ${names(d.staff_ids)}`
    case 'unassigned': return `${who} removed ${names(d.staff_ids)}`
    case 'due_date': return d.to ? `${who} set the due date to ${fmtDay(d.to)}` : `${who} cleared the due date`
    case 'start_date': return d.to ? `${who} set the start date to ${fmtDay(d.to)}` : `${who} cleared the start date`
    case 'priority': return `${who} changed priority to ${PRIORITY[d.to]?.label || d.to}`
    case 'title': return `${who} renamed this to "${d.to}"`
    case 'category': return d.to ? `${who} moved this to ${categoryName(d.to) || 'a category'}` : `${who} removed the category`
    case 'description': return `${who} edited the description`
    case 'file_added': return `${who} added ${d.type === 'link' ? 'a link' : 'a file'}: ${d.name}`
    case 'file_removed': return `${who} removed ${d.type === 'link' ? 'a link' : 'a file'}: ${d.name}`
    default: return `${who} updated this task`
  }
}

// Comments and history in one oldest-first list.
export function mergeThread(comments = [], activity = []) {
  return [
    ...comments.map(c => ({ type: 'comment', at: c.created_at, item: c })),
    ...activity.map(a => ({ type: 'activity', at: a.created_at, item: a })),
  ].sort((x, y) => String(x.at).localeCompare(String(y.at)))
}

// Board: one column per status in board order; Skipped only when asked for.
// Cards follow the chosen sort; 'manual' is the drag order (sort_order).
export function boardColumns(tasks, { showSkipped = false, sort = 'manual' } = {}) {
  return STATUSES.filter(s => showSkipped || s.value !== 'skipped').map(s => ({
    ...s,
    items: sortTasks(tasks.filter(t => t.status === s.value), sort),
  }))
}

// sort_order for a card dropped at `index` in a column (the column's cards
// in order, without the dragged card). Lands between its new neighbours.
export function dropOrder(items, index) {
  const before = items[index - 1]
  const after = items[index]
  const b = before?.sort_order ?? null
  const a = after?.sort_order ?? null
  if (b == null && a == null) return Date.now()
  if (b == null) return a - 1024
  if (a == null) return b + 1024
  return (a + b) / 2
}

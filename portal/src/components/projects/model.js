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

export const DEFAULT_FILTERS = {
  who: 'me', // 'me' | 'all' | staff id
  status: 'open', // 'open' | 'all' | a status value ('all' still hides skipped)
  category: '', // '' | 'none' | category id
  priority: '',
  due: '', // '' | 'overdue' | 'week' | 'none'
  q: '',
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

export function filterTasks(tasks, f, { me, today = isoDay() } = {}) {
  const q = String(f.q || '').trim().toLowerCase()
  const weekEnd = addDays(today, 7)
  return (tasks || []).filter(t => {
    if (f.status === 'any') { /* the board: every status, skipped included */ }
    else if (f.status === 'open') { if (!OPEN.includes(t.status)) return false }
    else if (f.status === 'all') { if (t.status === 'skipped') return false }
    else if (f.status && t.status !== f.status) return false

    if (f.who === 'me') { if (!isAssigned(t, me)) return false }
    else if (f.who && f.who !== 'all' && !isAssigned(t, f.who)) return false

    if (f.category === 'none') { if (t.category_id) return false }
    else if (f.category && t.category_id !== f.category) return false

    if (f.priority && t.priority !== f.priority) return false

    if (f.due === 'none' && t.due_date) return false
    if (f.due === 'overdue' && !(t.due_date && t.due_date < today && OPEN.includes(t.status))) return false
    if (f.due === 'week' && !(t.due_date && t.due_date >= today && t.due_date <= weekEnd)) return false

    if (q && !`${t.title} ${t.description || ''}`.toLowerCase().includes(q)) return false
    return true
  })
}

const byDue = (a, b) => (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31')
export const SORTS = {
  due: byDue,
  priority: (a, b) => (PRIORITY[a.priority]?.rank ?? 9) - (PRIORITY[b.priority]?.rank ?? 9) || byDue(a, b),
  newest: (a, b) => String(b.created_at).localeCompare(String(a.created_at)),
  oldest: (a, b) => String(a.created_at).localeCompare(String(b.created_at)),
}

export function sortTasks(tasks, sort = 'due') {
  return [...tasks].sort(SORTS[sort] || SORTS.due)
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
// Cards sort by sort_order (drag position), then newest.
export function boardColumns(tasks, { showSkipped = false } = {}) {
  return STATUSES.filter(s => showSkipped || s.value !== 'skipped').map(s => ({
    ...s,
    items: tasks.filter(t => t.status === s.value)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(b.created_at).localeCompare(String(a.created_at))),
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

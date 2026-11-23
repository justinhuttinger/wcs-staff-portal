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
    if (f.status === 'open') { if (!OPEN.includes(t.status)) return false }
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

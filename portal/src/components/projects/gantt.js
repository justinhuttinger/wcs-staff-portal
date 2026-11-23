// Projects timeline (Gantt): date math, bar spans, row grouping and drag
// results. Pure; tested. Day keys are local YYYY-MM-DD.

const at = key => new Date(`${key}T12:00:00`)
const pad = n => String(n).padStart(2, '0')
export const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function addDays(key, n) {
  const d = at(key)
  d.setDate(d.getDate() + n)
  return dayKey(d)
}

export function dayDiff(from, to) {
  return Math.round((at(to) - at(from)) / 86400000)
}

// Zoom levels: how many days are visible and how wide one day is.
export const ZOOMS = {
  weeks: { label: '6 weeks', days: 42, px: 32 },
  months: { label: '3 months', days: 91, px: 16 },
  half: { label: '6 months', days: 182, px: 8 },
}

// A task's bar: start_date, else the day it was created; ends on its due
// date. No due date = no bar. A start after the due date collapses to one day.
export function taskSpan(task) {
  if (!task.due_date) return null
  const created = task.created_at ? dayKey(new Date(task.created_at)) : task.due_date
  let start = task.start_date || created
  if (start > task.due_date) start = task.due_date
  return { start, end: task.due_date, explicitStart: !!task.start_date }
}

// Bar position inside a window [from, from + days). Clipped bars report which
// end is cut off so the UI can square that edge. null when fully outside.
export function barBox(span, from, days) {
  if (!span) return null
  const s = dayDiff(from, span.start)
  const e = dayDiff(from, span.end) + 1 // inclusive end
  if (e <= 0 || s >= days) return null
  return { left: Math.max(0, s), width: Math.min(days, e) - Math.max(0, s), clipStart: s < 0, clipEnd: e > days }
}

// Rows grouped by category or by person (a task appears under each of its
// assignees). Empty groups are dropped; "No category" / "Unassigned" last.
export function groupRows(tasks, by, { nameOf = id => id, categories = [] } = {}) {
  if (by === 'none') return [{ key: 'all', label: 'All tasks', tasks }]
  if (by === 'person') {
    const groups = new Map()
    const none = []
    for (const t of tasks) {
      if (!t.assignees?.length) { none.push(t); continue }
      for (const a of t.assignees) {
        if (!groups.has(a.staff_id)) groups.set(a.staff_id, [])
        groups.get(a.staff_id).push(t)
      }
    }
    const rows = [...groups.entries()].map(([id, list]) => ({ key: id, label: nameOf(id), tasks: list }))
      .sort((a, b) => a.label.localeCompare(b.label))
    if (none.length) rows.push({ key: 'none', label: 'Unassigned', tasks: none })
    return rows
  }
  const known = new Set(categories.map(c => c.id))
  const rows = categories.map(c => ({ key: c.id, label: c.name, tasks: tasks.filter(t => t.category_id === c.id) }))
  rows.push({ key: 'none', label: 'No category', tasks: tasks.filter(t => !t.category_id || !known.has(t.category_id)) })
  return rows.filter(r => r.tasks.length)
}

// New dates after dragging a bar by `delta` days. mode 'move' shifts both
// ends; 'end' moves the due date; 'start' moves the start. An end never
// crosses its other end. Returns only the fields that changed.
export function dragDates(span, mode, delta) {
  if (!span || !delta) return {}
  let { start, end } = span
  if (mode === 'move') { start = addDays(start, delta); end = addDays(end, delta) }
  if (mode === 'end') { end = addDays(end, delta); if (end < start) end = start }
  if (mode === 'start') { start = addDays(start, delta); if (start > end) start = end }
  const out = {}
  if (end !== span.end) out.due_date = end
  // A moved bar with no start_date of its own gets one, so it stays put.
  if (start !== span.start) out.start_date = start
  return out
}

// Month bands for the header: [{ key, label, left, width }] in days.
export function monthBands(from, days) {
  const out = []
  let i = 0
  while (i < days) {
    const key = addDays(from, i)
    const d = at(key)
    const left = i
    const nextMonth = dayKey(new Date(d.getFullYear(), d.getMonth() + 1, 1))
    const end = Math.min(days, dayDiff(from, nextMonth))
    out.push({ key: key.slice(0, 7), label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), left, width: end - left })
    i = end
  }
  return out
}

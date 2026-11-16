// Tasks for the Hub's calendar view: grouped by due date (high priority first
// within a day), with undated tasks kept separately. Pure; tested.
const RANK = { high: 0, medium: 1, low: 2 }

export function tasksByDay(tasks) {
  const byDay = new Map()
  const undated = []
  for (const t of tasks || []) {
    if (!t.due_date) { undated.push(t); continue }
    if (!byDay.has(t.due_date)) byDay.set(t.due_date, [])
    byDay.get(t.due_date).push(t)
  }
  for (const list of byDay.values()) list.sort((a, b) => (RANK[a.priority] ?? 1) - (RANK[b.priority] ?? 1))
  return { byDay, undated }
}

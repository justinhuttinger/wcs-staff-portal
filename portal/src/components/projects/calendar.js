// Projects calendar: tasks by due date (urgent first within a day), undated
// tasks kept apart. Pure; tested.
import { PRIORITY } from './model.js'

export function tasksByDue(tasks) {
  const byDay = new Map()
  const undated = []
  for (const t of tasks || []) {
    if (!t.due_date) { undated.push(t); continue }
    if (!byDay.has(t.due_date)) byDay.set(t.due_date, [])
    byDay.get(t.due_date).push(t)
  }
  const rank = t => PRIORITY[t.priority]?.rank ?? 9
  for (const list of byDay.values()) list.sort((a, b) => rank(a) - rank(b) || String(a.title).localeCompare(String(b.title)))
  return { byDay, undated }
}

// The due date to save when a task is dropped on a day (null = "No due
// date"), or undefined when nothing changes.
export function rescheduleTo(task, dayKey) {
  const next = dayKey || null
  return (task.due_date || null) === next ? undefined : next
}

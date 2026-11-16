// Turns a Hub suggestion into the task editor's starting values, and labels
// how long an ask has been waiting. Pure; tested in suggestionForm.test.mjs.

export function suggestionToTaskForm(s) {
  const g = s?.guess || {}
  const via = s?.source === 'text' ? 'text' : 'email'
  const quote = String(s?.snippet || '').trim()
  const from = `From ${s?.from_name || 'someone'} (${via})${quote ? `: "${quote}"` : ''}`
  const desc = String(g.description || '').trim()
  return {
    title: String(g.title || s?.summary || s?.subject || '').trim().slice(0, 120),
    description: desc ? `${desc}\n\n${from}` : from,
    category_id: g.category_id || '',
    priority: 'medium',
    due_date: g.due_date || '',
    clubs: Array.isArray(g.clubs) ? g.clubs : [],
  }
}

export function ageLabel(iso, now = Date.now()) {
  const mins = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000))
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

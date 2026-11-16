// Date labels shared by the Hub screens. Dates are YYYY-MM-DD (local) or ISO.

export function daysFrom(iso) {
  if (!iso) return null
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso)
  return Math.round((d.getTime() - Date.now()) / 86400000)
}

export function ago(iso) {
  if (!iso) return ''
  const days = -daysFrom(iso)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

export function shortDate(iso) {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function dueLabel(due) {
  if (!due) return null
  const d = daysFrom(due)
  if (d < 0) return { text: `${-d} day${d === -1 ? '' : 's'} overdue`, tone: 'text-red-600 bg-red-500/10 border-red-500/30' }
  if (d === 0) return { text: 'Due today', tone: 'text-amber-700 bg-amber-500/10 border-amber-500/30' }
  return { text: `Due ${shortDate(due)}`, tone: 'text-text-muted bg-bg border-border' }
}

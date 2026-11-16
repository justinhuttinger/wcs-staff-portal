// Tickets the Hub shows: everything not closed (owner decision), most
// recently touched first. Fetched per status so the list endpoint's 500-row
// cap over all tickets can't hide an old open one. Tested.
export const LIVE_STATUSES = ['open', 'in_progress', 'complete']

export function openTicketsFirst(rows) {
  const at = t => String(t.updated_at || t.created_at || '')
  const seen = new Set()
  return (rows || [])
    .filter(t => LIVE_STATUSES.includes(t.status) && !seen.has(t.id) && seen.add(t.id))
    .sort((a, b) => at(b).localeCompare(at(a)))
}

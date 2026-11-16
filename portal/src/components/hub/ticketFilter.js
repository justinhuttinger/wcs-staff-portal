// Tickets the Hub shows: anything still being worked (open or in progress;
// complete and closed are finished), most recently touched first. Tested.
const LIVE = new Set(['open', 'in_progress'])

export function openTicketsFirst(rows) {
  const at = t => String(t.updated_at || t.created_at || '')
  return (rows || []).filter(t => LIVE.has(t.status)).sort((a, b) => at(b).localeCompare(at(a)))
}

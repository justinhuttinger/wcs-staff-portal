// The Hub's "New" feed: one newest-first list of everything that arrived and
// that the owner hasn't opened yet. Each entry says what it opens. Pure;
// the route gathers the rows. Tested in tests/hubFeed.test.js.

const LIVE_TICKET = new Set(['open', 'in_progress'])
const first = name => String(name || '').split(' ')[0]

function buildFeed({ since, seenTicketIds = new Set(), tickets = [], items = [], replies = [], tray = [] }) {
  const out = []
  const sinceMs = since ? new Date(since).getTime() : 0
  for (const t of tickets) {
    if (!LIVE_TICKET.has(t.status)) continue
    if (new Date(t.created_at).getTime() <= sinceMs) continue
    if (seenTicketIds.has(t.id)) continue
    out.push({ key: `ticket:${t.id}`, kind: 'ticket', at: t.created_at, ticketId: t.id,
      text: `New ticket · ${t.title || t.type_name || 'Ticket'}`, sub: t.type_name || '' })
  }
  for (const i of items) {
    out.push({ key: `item:${i.id}`, kind: 'deliverable', at: i.at, taskId: i.taskId,
      text: `${first(i.person) || 'Someone'} sent ${i.label}`, sub: i.taskTitle })
  }
  for (const r of replies) {
    out.push({ key: `reply:${r.personId}`, kind: 'reply', at: r.at, taskId: r.taskId,
      text: `${first(r.name)} replied`, sub: r.taskTitle })
  }
  for (const t of tray) {
    out.push({ key: `tray:${t.personId}`, kind: 'tray', at: t.at, taskId: t.taskId,
      text: `${t.count} file${t.count === 1 ? '' : 's'} from ${first(t.name)} need${t.count === 1 ? 's' : ''} a slot`, sub: t.taskTitle })
  }
  // Newest first; an entry without a time goes last.
  return out.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
}

module.exports = { buildFeed }

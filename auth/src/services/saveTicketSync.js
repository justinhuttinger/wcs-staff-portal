// Keeps a cancel-tool save request and its "Cancel Action - Save or Cancel"
// ticket (opened by the wcs-save Worker, migration 235) in step, so staff can
// close the work from either place:
//   - ticket marked complete/closed  -> request resolved
//   - request resolved in Activity   -> ticket complete
// Both are best effort: the caller's own update has already succeeded and a
// sync problem must never fail it.

const CANCEL_ACTION_SLUG = 'cancel-action'

async function resolveRequestForTicket(db, { ticketId, typeSlug, status, staffId }) {
  if (typeSlug !== CANCEL_ACTION_SLUG || !['complete', 'closed'].includes(status)) return null
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('save_requests')
    .update({ resolved_at: now, resolved_by: staffId || null, resolution_note: `Ticket marked ${status}`, updated_at: now })
    .eq('ticket_id', ticketId)
    .is('resolved_at', null)
    .select('id')
  if (error) throw error
  return data || []
}

async function completeTicketForRequest(db, { request, staffId }) {
  if (!request?.ticket_id) return null
  const { data: ticket, error } = await db
    .from('tickets').select('id, status').eq('id', request.ticket_id).maybeSingle()
  if (error) throw error
  if (!ticket || ['complete', 'closed'].includes(ticket.status)) return null
  const now = new Date().toISOString()
  const { error: upErr } = await db
    .from('tickets').update({ status: 'complete', completed_at: now, updated_at: now }).eq('id', ticket.id)
  if (upErr) throw upErr
  await db.from('ticket_comments').insert({
    ticket_id: ticket.id, author_id: staffId || null, system: true,
    body: 'Status changed to complete (resolved in Save Offers -> Activity)',
  })
  return ticket.id
}

module.exports = { CANCEL_ACTION_SLUG, resolveRequestForTicket, completeTicketForRequest }

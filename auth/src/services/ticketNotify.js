// Notify seam for ticket assignment + @mentions.
//
// This is the single choke point where "someone was assigned or @mentioned in a
// ticket" turns into a Google Chat DM. The DM is sent as the ACTOR (the person
// who assigned or wrote the @mention) via their own OAuth token — see
// services/googleChat.js — so it lands in the target's Chat looking like it came
// straight from that coworker, with no bot label. That is the entire "chat
// feature": impersonate whoever is @ing / assigning to the person @ed /
// assigned. Nothing renders an in-portal chat client.
//
// Contract: never let a notification failure roll back the ticket write. Every
// path here swallows its own errors and records the outcome to
// chat_ticket_notifications; callers fire-and-forget.

const { supabaseAdmin } = require('./supabase')
const { sendTicketDm } = require('./googleChat')
const { toPlainText } = require('./ticketMentions')

const PORTAL_BASE_URL = process.env.PORTAL_BASE_URL || process.env.PORTAL_URL || 'https://app.westcoaststrength.com'

// Deep link into the ticket. Ships with the uuid until a public ticket_number
// route exists; stable either way.
function ticketLink(ticket) {
  return `${PORTAL_BASE_URL}/tickets/${ticket.id}`
}

// One-line DM copy per kind (spec §8.2). Kept here so every path uses identical
// wording. Urgent tickets get a warning glyph.
function composeMessage({ kind, ticket, commentExcerpt }) {
  const urgent = ticket.priority === 'urgent' ? '⚠️ ' : ''
  const link = ticketLink(ticket)
  const title = ticket.title || 'a ticket'
  if (kind === 'assigned') return `${urgent}Assigned you ${title}. ${link}`
  if (kind === 'mentioned_comment') {
    // Render mention tokens as "@Name" so the DM excerpt reads cleanly.
    const excerpt = toPlainText(commentExcerpt || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    return `${urgent}Mentioned you on ${title}: "${excerpt}" ${link}`
  }
  if (kind === 'mentioned_body') return `${urgent}Tagged you on ${title}. ${link}`
  return `${urgent}Update on ${title}. ${link}`
}

// Per-user opt-out. Returns email + enabled flag; defaults to enabled if the
// column is absent so this is safe before any profile flag ships.
async function targetProfile(staffId) {
  // PostgREST fails the WHOLE query when a selected column doesn't exist, so
  // asking for the opt-out flag before migration 104 landed returned null and
  // every DM was reported as "recipient has no Google email on file". Fall back
  // to the columns that are guaranteed to exist, and treat a missing flag as
  // opted in.
  const full = await supabaseAdmin
    .from('staff').select('id, email, chat_notifications_enabled').eq('id', staffId).maybeSingle()
  if (!full.error) return full.data || null

  console.warn('[TicketNotify] staff lookup with opt-out flag failed, retrying without it:', full.error.message)
  const basic = await supabaseAdmin
    .from('staff').select('id, email').eq('id', staffId).maybeSingle()
  if (basic.error) {
    throw new Error(`could not load recipient: ${basic.error.message}`)
  }
  return basic.data || null
}

// Record and deliver a batch of notifications for one ticket.
//
// targets: [{ mentionId, targetUserId, kind, commentExcerpt }]
// Skips the actor themselves (no self-notify) and opted-out users. Returns
// nothing — this is a side effect and must never throw into the request path.
async function notify({ ticket, actorId, targets }) {
  if (!ticket || !Array.isArray(targets) || targets.length === 0) return
  for (const t of targets) {
    if (!t || !t.targetUserId) continue
    if (actorId && String(t.targetUserId) === String(actorId)) continue // no self-notify
    await deliverOne({ ticket, actorId, target: t }).catch(err => {
      console.error('[TicketNotify] deliver failed:', err.message)
    })
  }
}

async function deliverOne({ ticket, actorId, target }) {
  const message = composeMessage({ kind: target.kind, ticket, commentExcerpt: target.commentExcerpt })

  // Each miss gets its own wording — a lookup that blew up must never be
  // reported as "no email on file", which is what sent us chasing the wrong
  // problem when the opt-out column was missing.
  let profile
  try {
    profile = await targetProfile(target.targetUserId)
  } catch (err) {
    return finish({ ticket, actorId, target, status: 'failed', channel: null, message, error: err.message })
  }

  if (profile && profile.chat_notifications_enabled === false) {
    return finish({ ticket, actorId, target, status: 'skipped', channel: null, message, error: 'recipient disabled chat notifications' })
  }
  if (!profile) {
    return finish({ ticket, actorId, target, status: 'failed', channel: null, message, error: 'recipient is not an active staff record' })
  }
  if (!profile.email) {
    return finish({ ticket, actorId, target, status: 'failed', channel: null, message, error: 'recipient has no Google email on file' })
  }

  try {
    const sent = await sendTicketDm({ actorStaffId: actorId, targetEmail: profile.email, text: message })
    return finish({
      ticket, actorId, target, status: 'sent', channel: 'chat', message,
      messageName: sent.messageName,
    })
  } catch (err) {
    // Typed reasons from googleChat: notConnected | insufficientScope | targetUnreachable.
    const reason = err.notConnected ? 'actor has not connected Google Chat'
      : err.insufficientScope ? 'actor is missing Google Chat permission'
      : err.targetUnreachable ? 'recipient is not reachable on Google Chat'
      : err.message
    return finish({ ticket, actorId, target, status: 'failed', channel: null, message, error: reason })
  }
}

// Persist the outcome: mark the mention row and drop an audit/outbox row.
async function finish({ ticket, actorId, target, status, channel, message, messageName, error }) {
  const nowIso = new Date().toISOString()
  try {
    if (target.mentionId) {
      const patch = {}
      if (status === 'sent') { patch.notified_at = nowIso; patch.notify_channel = channel; patch.chat_message_name = messageName || null }
      if (error) patch.notify_error = String(error).slice(0, 500)
      if (Object.keys(patch).length) {
        await supabaseAdmin.from('ticket_mentions').update(patch).eq('id', target.mentionId)
      }
    }
  } catch (e) { console.error('[TicketNotify] mention update failed:', e.message) }

  try {
    await supabaseAdmin.from('chat_ticket_notifications').insert({
      mention_id: target.mentionId || null,
      ticket_id: ticket.id,
      actor_id: actorId || null,
      target_user_id: target.targetUserId,
      kind: target.kind,
      channel: channel || null,
      status,
      payload: { message: message || null, link: ticketLink(ticket), message_name: messageName || null },
      error: error ? String(error).slice(0, 500) : null,
      attempts: 1,
    })
  } catch (e) { console.error('[TicketNotify] outbox insert failed:', e.message) }
}

module.exports = { notify, composeMessage, ticketLink }

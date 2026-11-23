// Sends the Google Chat DMs planned by notifyPlan for a Projects task event.
//
// Each DM goes from the actor's own Google account when they have connected
// Google Chat in the portal, so it reads as coming from them. If they have
// not (or their grant lacks the Chat scopes), it falls back to the portal
// notification account; the text already names the actor either way.
// Respects staff.chat_notifications_enabled. Every outcome lands in
// project_notifications. Never throws: callers fire and forget, and a Chat
// failure never affects the task write.
//
// PROJECTS_CHAT_DISABLED=true turns sending off (nothing is logged).

const { supabaseAdmin } = require('../supabase')
const { sendTicketDm, sendTicketDmAsSystem } = require('../googleChat')
const { planNotifications } = require('./notifyPlan')

const disabled = () => String(process.env.PROJECTS_CHAT_DISABLED || '').toLowerCase() === 'true'

async function recipient(staffId) {
  const full = await supabaseAdmin.from('staff')
    .select('id, email, is_active, chat_notifications_enabled').eq('id', staffId).maybeSingle()
  if (!full.error) return full.data || null
  const basic = await supabaseAdmin.from('staff').select('id, email, is_active').eq('id', staffId).maybeSingle()
  if (basic.error) throw new Error(`could not load recipient: ${basic.error.message}`)
  return basic.data || null
}

async function log(row) {
  const { error } = await supabaseAdmin.from('project_notifications').insert({
    ...row,
    message: row.message ? String(row.message).slice(0, 4000) : null,
    error: row.error ? String(row.error).slice(0, 500) : null,
  })
  if (error) console.error('[projects-notify] log failed:', error.message)
}

// Actor first; their missing or partial Chat grant falls back to the portal
// account. A recipient Chat can't reach is a real failure (no fallback).
async function send(actorId, email, text) {
  if (actorId) {
    try {
      await sendTicketDm({ actorStaffId: actorId, targetEmail: email, text })
      return 'actor'
    } catch (err) {
      if (!err.notConnected && !err.insufficientScope) throw err
    }
  }
  await sendTicketDmAsSystem({ targetEmail: email, text })
  return 'system'
}

function reason(err) {
  if (err.notConnected) return 'portal notification account is not connected to Google Chat'
  if (err.insufficientScope) return 'missing Google Chat permission'
  if (err.targetUnreachable) return 'recipient is not reachable on Google Chat'
  return err.message
}

async function deliver({ task, actorId, row }) {
  const base = { task_id: task.id, actor_id: actorId || null, target_id: row.targetId, kind: row.kind, message: row.text }
  let person
  try { person = await recipient(row.targetId) } catch (e) { return log({ ...base, status: 'failed', error: e.message }) }
  if (!person || person.is_active === false) return log({ ...base, status: 'skipped', error: 'recipient is not an active staff record' })
  if (person.chat_notifications_enabled === false) return log({ ...base, status: 'skipped', error: 'recipient turned off Chat notifications' })
  if (!person.email) return log({ ...base, status: 'failed', error: 'recipient has no email on file' })
  try {
    const sentAs = await send(actorId, person.email, row.text)
    return log({ ...base, status: 'sent', sent_as: sentAs })
  } catch (e) {
    return log({ ...base, status: 'failed', error: reason(e) })
  }
}

async function memberIds() {
  const { data } = await supabaseAdmin.from('project_members').select('staff_id')
  return (data || []).map(r => r.staff_id)
}

// event: 'assigned' | 'comment' | 'complete'. `task` must carry assignees.
async function notifyTaskEvent({ event, task, actor, added, commentBody }) {
  if (disabled() || !task) return
  try {
    const actorName = actor ? (actor.display_name || [actor.first_name, actor.last_name].filter(Boolean).join(' ') || actor.email) : null
    const rows = planNotifications({
      event, task, actorId: actor?.id, actorName, added, commentBody,
      memberIds: event === 'comment' ? await memberIds() : [],
    })
    for (const row of rows) {
      await deliver({ task, actorId: actor?.id, row }).catch(e => console.error('[projects-notify] deliver failed:', e.message))
    }
  } catch (e) {
    console.error('[projects-notify] failed:', e.message)
  }
}

// Fire and forget after the response is on its way.
function queueTaskEvent(args) {
  setImmediate(() => { notifyTaskEvent(args) })
}

module.exports = { notifyTaskEvent, queueTaskEvent }

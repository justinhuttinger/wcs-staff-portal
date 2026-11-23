// Google Chat app for Projects ("WCS Projects"), built as a Google Workspace
// add-on with one HTTP endpoint: POST /projects-chat/events.
//
//   /task (command id 1, "Open a dialog")  -> the New task form
//   Create task button                     -> creates the task as that person
//   a plain message / added to a space     -> a short help reply
//
// Every request must carry Google's signed token for this app (see
// services/projects/chatVerify.js); until PROJECTS_CHAT_SA_EMAIL is set the
// endpoint refuses everything. Only Projects members can create tasks, and
// a task made here goes through the same createTask as the portal, so the
// assignees' Chat DMs and the history are identical.
//
// Env:
//   PROJECTS_CHAT_SA_EMAIL  the app's service account (Chat API > Configuration
//                           > Connection settings). Required.
//   PROJECTS_CHAT_ENDPOINT  the exact URL configured in Chat (default
//                           AUTH_API_URL + /projects-chat/events). It is the
//                           token audience, so it must match character for
//                           character.

const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { verifyChatToken, bearer } = require('../services/projects/chatVerify')
const { isProjectsMember } = require('../services/projects/members')
const { memberList, categoryList, createTask } = require('../services/projects/store')
const cards = require('../services/projects/chatCards')

const router = Router()

const AUTH_API_URL = process.env.AUTH_API_URL || 'https://api.wcstrength.com'
const endpoint = () => process.env.PROJECTS_CHAT_ENDPOINT || `${AUTH_API_URL.replace(/\/+$/, '')}/projects-chat/events`
const PORTAL_URL = (process.env.PORTAL_BASE_URL || process.env.PORTAL_URL || 'https://portal.wcstrength.com').replace(/\/+$/, '')

const HELP = `Type /task to create a Projects task. Open Projects: <${PORTAL_URL}/#open/projects|Projects>`

// Shape-only log of each request (no form values), so the first live test
// shows exactly what Google sends.
function logShape(body, kind) {
  const chat = body.chat || {}
  console.log('[projects-chat]', kind.kind, kind.id || '', 'keys:', Object.keys(body).join(','),
    'chat:', Object.keys(chat).join(','), 'hasUserEmail:', !!chat.user?.email)
}

async function staffByEmail(email) {
  if (!email) return null
  // ilike for case, with its wildcards escaped; exact match is checked below.
  const pattern = email.replace(/[\\%_]/g, c => `\\${c}`)
  const { data, error } = await supabaseAdmin.from('staff')
    .select('id, email, display_name, first_name, last_name, is_active').ilike('email', pattern).limit(5)
  if (error) throw error
  const rows = (data || []).filter(s => s.is_active !== false && String(s.email).toLowerCase() === email)
  return rows.length === 1 ? rows[0] : null
}

// Who is acting, and may they use Projects? Returns { staff } or { error }.
async function actorFor(body) {
  const email = cards.actorEmail(body)
  if (!email) return { error: "Couldn't tell who you are. Try again from your work Google account." }
  const staff = await staffByEmail(email)
  if (!staff) return { error: `No portal account matches ${email}.` }
  if (!(await isProjectsMember(staff.id))) return { error: "You don't have Projects yet. Ask an admin to add you in Admin > Projects." }
  return { staff }
}

async function dialog({ actor, values, error }) {
  const [members, categories] = await Promise.all([memberList(), categoryList()])
  return cards.taskDialogCard({ members, categories, actorId: actor.id, values, error, endpoint: endpoint() })
}

router.post('/events', async (req, res) => {
  const check = await verifyChatToken(bearer(req), { audience: endpoint(), serviceAccountEmail: process.env.PROJECTS_CHAT_SA_EMAIL })
  if (!check.ok) {
    console.warn('[projects-chat] rejected request:', check.reason)
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const body = req.body || {}
  const kind = cards.eventKind(body)
  logShape(body, kind)

  try {
    if (kind.kind === 'command') {
      if (kind.id !== cards.TASK_COMMAND_ID) return res.json(cards.replyText(HELP))
      const who = await actorFor(body)
      if (who.error) return res.json(cards.openDialog(cards.noticeCard('WCS Projects', who.error)))
      return res.json(cards.openDialog(await dialog({ actor: who.staff })))
    }

    if (kind.kind === 'submit') {
      const who = await actorFor(body)
      if (who.error) return res.json(cards.closeDialog(who.error))
      const values = cards.readTaskForm(body)
      if (!values.title) {
        return res.json(cards.updateDialog(await dialog({ actor: who.staff, values, error: 'Add a title for the task.' })))
      }
      try {
        const task = await createTask(values, who.staff)
        const members = await memberList()
        const nameOf = id => members.find(m => m.id === id)?.name || 'a former member'
        return res.json(cards.closeDialog(cards.createdSummary(task, nameOf)))
      } catch (e) {
        if (e.status === 400) return res.json(cards.updateDialog(await dialog({ actor: who.staff, values, error: e.message })))
        throw e
      }
    }

    if (kind.kind === 'message') return res.json(cards.replyText(HELP))
    return res.json({})
  } catch (e) {
    console.error('[projects-chat] failed:', e.message)
    // Chat shows a generic error for a non-JSON or 5xx answer; this is kinder.
    if (kind.kind === 'submit') return res.json(cards.closeDialog('Something went wrong creating the task. Try again, or use the portal.'))
    return res.json(cards.replyText('Something went wrong. Try again, or use the portal.'))
  }
})

module.exports = router

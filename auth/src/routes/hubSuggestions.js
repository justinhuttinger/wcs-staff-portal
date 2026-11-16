// Hub > Suggested: asks that came in by email (and, later, text) waiting for
// the owner to add them as tasks or dismiss them. Recently skipped holds what
// Claude decided was not a request, so he can rescue a mistake. Owner-only.
const { Router } = require('express')
const { ownerOnly } = require('../lib/ownerGate')
const { supabaseAdmin } = require('../services/supabase')
const { getStaffGoogleAccessToken } = require('../services/googleUserToken')
const gmail = require('../services/followUps/gmail')
const dl = require('../services/hub/deliverables')
const { cleanTaskInput, rowSignal } = require('../services/hub/taskModel')
const { askerPersonFields } = require('../services/hub/suggest')
const { isFilableAttachment } = require('../services/hub/fileRules')
const { personClubsFor } = require('../services/hub/slots')

const MAX_BYTES = 25 * 1024 * 1024
const router = Router()
router.use(ownerOnly)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIST_COLS = 'id, source, status, gmail_thread_id, from_name, from_email, cc_emails, subject, snippet, summary, guess, received_at, last_message_at, you_replied, seen, created_at'
const SKIPPED_DAYS = 14

function must({ data, error }) {
  if (error) throw error
  return data
}

function fail(res, e) {
  res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 500).json({ error: e.message })
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e }

async function loadSuggestion(req) {
  if (!UUID_RE.test(String(req.params.id))) throw httpError(404, 'Not found')
  const row = must(await supabaseAdmin.from('hub_suggestions').select('*')
    .eq('id', req.params.id).eq('owner_staff_id', req.staff.id).maybeSingle())
  if (!row) throw httpError(404, 'Not found')
  return row
}

router.get('/suggestions', async (req, res) => {
  try {
    const owner = req.staff.id
    const since = new Date(Date.now() - SKIPPED_DAYS * 86400000).toISOString()
    const [open, skipped] = await Promise.all([
      supabaseAdmin.from('hub_suggestions').select(LIST_COLS).eq('owner_staff_id', owner).eq('status', 'open')
        .order('received_at', { ascending: true }).limit(200).then(must),
      supabaseAdmin.from('hub_suggestions').select(LIST_COLS).eq('owner_staff_id', owner).eq('status', 'skipped')
        .gte('received_at', since).order('received_at', { ascending: false }).limit(50).then(must),
    ])
    res.json({ open, skipped })
  } catch (e) { fail(res, e) }
})

router.post('/suggestions/:id/dismiss', async (req, res) => {
  try {
    const s = await loadSuggestion(req)
    if (s.status !== 'open') throw httpError(400, 'Already handled')
    must(await supabaseAdmin.from('hub_suggestions').update({ status: 'dismissed', updated_at: new Date().toISOString() }).eq('id', s.id))
    res.json({ ok: true })
  } catch (e) { fail(res, e) }
})

// "This is a request": a skipped item becomes an open suggestion.
router.post('/suggestions/:id/restore', async (req, res) => {
  try {
    const s = await loadSuggestion(req)
    if (s.status !== 'skipped') throw httpError(400, 'Only skipped items can be restored')
    if (s.gmail_thread_id && await threadIsTask(req.staff.id, s.gmail_thread_id)) throw httpError(409, 'That conversation is already a task')
    const { data, error } = await supabaseAdmin.from('hub_suggestions')
      .update({ status: 'open', seen: true, summary: s.summary || s.subject, updated_at: new Date().toISOString() })
      .eq('id', s.id).select(LIST_COLS).single()
    if (error) {
      if (error.code === '23505') throw httpError(409, 'That conversation is already suggested')
      throw error
    }
    res.json({ suggestion: data })
  } catch (e) { fail(res, e) }
})

// Never suggest mail from this sender again; clears their open suggestions.
router.post('/suggestions/:id/mute', async (req, res) => {
  try {
    const s = await loadSuggestion(req)
    if (s.source !== 'email' || !s.from_email) throw httpError(400, 'Only email senders can be muted')
    must(await supabaseAdmin.from('hub_muted_senders')
      .upsert({ owner_staff_id: req.staff.id, email: s.from_email }, { onConflict: 'owner_staff_id,email', ignoreDuplicates: true }))
    must(await supabaseAdmin.from('hub_suggestions').update({ status: 'dismissed', updated_at: new Date().toISOString() })
      .eq('owner_staff_id', req.staff.id).eq('from_email', s.from_email).eq('status', 'open'))
    res.json({ ok: true })
  } catch (e) { fail(res, e) }
})

// Opened from the New feed: clears it there (it stays in Suggested).
router.post('/suggestions/:id/seen', async (req, res) => {
  try {
    const s = await loadSuggestion(req)
    must(await supabaseAdmin.from('hub_suggestions').update({ seen: true }).eq('id', s.id))
    res.json({ ok: true })
  } catch (e) { fail(res, e) }
})

// Add: the owner saved the pre-filled task editor. Creates the task (To do),
// and for an email puts the sender on the asking thread (reply-all to the
// others on it) and copies the files from the conversation into the task.
// Once the task exists, anything else that fails comes back as a warning.
router.post('/suggestions/:id/add', async (req, res) => {
  try {
    const s = await loadSuggestion(req)
    if (s.status !== 'open') throw httpError(400, 'Already handled')
    const { fields, error } = cleanTaskInput({ ...(req.body || {}), status: 'todo' })
    if (error) throw httpError(400, error)
    if (fields.category_id) {
      const cat = must(await supabaseAdmin.from('hub_categories').select('id')
        .eq('id', fields.category_id).eq('owner_staff_id', req.staff.id).maybeSingle())
      if (!cat) throw httpError(400, 'Unknown category')
    }
    const task = must(await supabaseAdmin.from('hub_tasks')
      .insert({ ...fields, status: 'todo', owner_staff_id: req.staff.id }).select('*').single())
    // Claim the suggestion; a double click loses here and its task is removed.
    const claimed = must(await supabaseAdmin.from('hub_suggestions')
      .update({ status: 'added', task_id: task.id, seen: true, updated_at: new Date().toISOString() })
      .eq('id', s.id).eq('status', 'open').select('id'))
    if (!claimed.length) {
      await supabaseAdmin.from('hub_tasks').delete().eq('id', task.id)
      throw httpError(409, 'Already added')
    }

    let warning = null
    if (s.source === 'email' && s.from_email && s.gmail_thread_id) {
      try { await attachAsker({ owner: req.staff, task, suggestion: s }) } catch (e) {
        console.error('[HubSuggest] add follow-up failed', { suggestionId: s.id, error: e.message })
        warning = e.notConnected
          ? 'Task added, but Gmail is disconnected so the sender and files were not attached.'
          : e.filesOnly
            ? `Task added with the sender attached, but ${e.message}. Open them in Gmail.`
            : 'Task added, but the sender or their files could not all be attached.'
      }
    }
    res.json({ task: { ...task, people: [], signal: rowSignal(task, []) }, warning })
  } catch (e) { fail(res, e) }
})

async function threadIsTask(ownerId, threadId) {
  const rows = must(await supabaseAdmin.from('hub_task_people').select('task_id').eq('gmail_thread_id', threadId))
  if (!rows.length) return false
  const mine = must(await supabaseAdmin.from('hub_tasks').select('id').eq('owner_staff_id', ownerId).in('id', rows.map(r => r.task_id)))
  return mine.length > 0
}

async function attachAsker({ owner, task, suggestion }) {
  const { accessToken, email } = await getStaffGoogleAccessToken(owner.id)
  const ownerEmail = String(email || owner.email || '').toLowerCase()
  const messages = await gmail.getThreadFull(accessToken, suggestion.gmail_thread_id)

  // Saved person: reuse the contact with this email, else save them.
  const contacts = must(await supabaseAdmin.from('hub_contacts').select('*').eq('owner_staff_id', owner.id))
  let contact = contacts.find(c => String(c.email).toLowerCase() === suggestion.from_email) || null
  if (!contact) {
    const { data, error } = await supabaseAdmin.from('hub_contacts')
      .insert({ owner_staff_id: owner.id, name: suggestion.from_name || suggestion.from_email, email: suggestion.from_email })
      .select('*').single()
    if (error) throw error
    contact = data
  }
  const person = must(await supabaseAdmin.from('hub_task_people').insert({
    task_id: task.id, contact_id: contact.id, clubs: personClubsFor(contact.clubs, task.clubs),
    ...askerPersonFields(suggestion, messages, ownerEmail),
  }).select('id').single())

  // Every file anyone (not the owner) sent in the conversation so far. All of
  // them are marked seen first, before any slow download, so a Gmail check
  // that starts mid-Add never puts them in the tray. Then each is copied to
  // the task; one that fails doesn't stop the rest.
  const files = []
  for (const m of messages) {
    const from = gmail.emailFrom(gmail.headerValue(m.payload?.headers, 'From'))
    if (!from || from === ownerEmail) continue
    for (const a of gmail.listAttachments(m)) files.push({ m, a, partId: a.partId ?? a.attachmentId })
  }
  for (const f of files) await dl.markGmailSeen(person.id, `${f.m.id}:${f.partId}`)
  let failed = 0
  for (const { m, a, partId } of files) {
    const att = { name: a.filename, mime: a.mimeType, size: a.size, inline: a.inline }
    if (!isFilableAttachment(att)) continue
    const ref = { messageId: m.id, partId }
    try {
      if (a.size > MAX_BYTES) {
        await dl.addTaskFile({ taskId: task.id, ownerId: owner.id, meta: att, gmail: ref, tooLarge: true })
        continue
      }
      const bytes = await gmail.getAttachment(accessToken, m.id, a.attachmentId)
      await dl.addTaskFile({
        taskId: task.id, ownerId: owner.id, gmail: ref,
        file: { buffer: bytes, originalname: a.filename, mimetype: a.mimeType, size: bytes.length },
      })
    } catch (e) {
      if (e.notConnected) throw e
      failed++
      console.warn('[HubSuggest] file copy failed', { taskId: task.id, error: e.message })
    }
  }
  if (failed) {
    const e = new Error(`${failed} file${failed === 1 ? '' : 's'} could not be copied`)
    e.filesOnly = true
    throw e
  }
}

module.exports = router
module.exports.loadSuggestion = loadSuggestion
module.exports.LIST_COLS = LIST_COLS

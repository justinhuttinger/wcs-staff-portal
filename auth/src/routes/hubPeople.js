// Hub > Tasks > people: the owner attaches people to a task and emails them
// from his own Gmail (one thread per person per task). Claude drafts in his
// voice; nothing sends until he clicks Send. Replies flip the person to
// "replied" for him to review. Owner-only.
const { Router } = require('express')
const { ownerOnly } = require('../lib/ownerGate')
const { supabaseAdmin } = require('../services/supabase')
const { getStaffGoogleAccessToken } = require('../services/googleUserToken')
const gmail = require('../services/followUps/gmail')
const { draftEmail } = require('../services/followUps/draft')
const { applyReply } = require('../services/hub/personState')
const { recordSend } = require('../services/hub/recordSend')
const { PERSON_LIST_COLS } = require('../services/hub/taskModel')
const dl = require('../services/hub/deliverables')
const { withUploadLink, personClubsFor } = require('../services/hub/slots')
const { cleanContact } = require('./hubContacts')

const router = Router()
router.use(ownerOnly)

const EMAIL_RE = /^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KINDS = ['initial', 'nudge', 'ask']
const PERSON_COLS = PERSON_LIST_COLS

function sendError(res, e) {
  if (e.notConnected) return res.status(412).json({ error: 'Connect Gmail first', code: 'gmail_not_connected' })
  res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 500).json({ error: e.message })
}

function notFound() { const e = new Error('Not found'); e.status = 404; return e }

function ownerName(staff) {
  return staff?.first_name || String(staff?.display_name || '').split(' ')[0] || 'Justin'
}

async function loadTask(req, id) {
  if (!UUID_RE.test(String(id))) throw notFound()
  const { data, error } = await supabaseAdmin.from('hub_tasks').select('*')
    .eq('id', id).eq('owner_staff_id', req.staff.id).maybeSingle()
  if (error) throw error
  if (!data) throw notFound()
  return data
}

// Person plus their task, only if the task is the owner's.
async function loadPerson(req, pid) {
  if (!UUID_RE.test(String(pid))) throw notFound()
  const { data: person, error } = await supabaseAdmin.from('hub_task_people').select(PERSON_COLS)
    .eq('id', pid).maybeSingle()
  if (error) throw error
  if (!person) throw notFound()
  const task = await loadTask(req, person.task_id)
  return { person, task }
}

async function loadHistory(personId) {
  const { data, error } = await supabaseAdmin.from('hub_task_messages')
    .select('kind, subject, body, sent_at').eq('person_id', personId).order('sent_at', { ascending: true })
  if (error) throw error
  return data || []
}

// Add a saved person ({contact_id}) or a new one ({name, email, clubs}, which
// is saved for next time). Their clubs on this task come from their saved
// clubs; slots for those clubs become theirs if nobody owns them yet.
router.post('/tasks/:id/people', async (req, res) => {
  try {
    const task = await loadTask(req, req.params.id)
    let contact
    if (req.body?.contact_id) {
      if (!UUID_RE.test(String(req.body.contact_id))) return res.status(404).json({ error: 'Not found' })
      const { data } = await supabaseAdmin.from('hub_contacts').select('*')
        .eq('id', req.body.contact_id).eq('owner_staff_id', req.staff.id).maybeSingle()
      if (!data) return res.status(404).json({ error: 'Not found' })
      contact = data
    } else {
      const { fields, error } = cleanContact(req.body || {})
      if (error) return res.status(400).json({ error })
      const { data: existing } = await supabaseAdmin.from('hub_contacts').select('*')
        .eq('owner_staff_id', req.staff.id).eq('email', fields.email).maybeSingle()
      if (existing) contact = existing
      else {
        const { data, error: insErr } = await supabaseAdmin.from('hub_contacts')
          .insert({ ...fields, owner_staff_id: req.staff.id }).select('*').single()
        if (insErr) throw insErr
        contact = data
      }
    }
    const { data, error } = await supabaseAdmin.from('hub_task_people').insert({
      task_id: task.id, contact_id: contact.id, name: contact.name, email: contact.email,
      clubs: personClubsFor(contact.clubs, task.clubs),
    }).select(PERSON_COLS).single()
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'That person is already on this task' })
      throw error
    }
    await dl.applyOwners(task)
    res.json({ person: data })
  } catch (e) { sendError(res, e) }
})

// Change which clubs a person covers on this task.
router.patch('/people/:pid', async (req, res) => {
  try {
    const { person, task } = await loadPerson(req, req.params.pid)
    const list = Array.isArray(req.body?.clubs) ? req.body.clubs : []
    const clubs = [...new Set(list.map(String).filter(c => /^[a-z0-9-]{2,40}$/.test(c)))]
    const { data, error } = await supabaseAdmin.from('hub_task_people').update({ clubs })
      .eq('id', person.id).select(PERSON_COLS).single()
    if (error) throw error
    await dl.applyOwners(task)
    res.json({ person: data })
  } catch (e) { sendError(res, e) }
})

// Remove someone added by mistake. Only before any email has gone to them,
// so a real thread is never orphaned.
router.delete('/people/:pid', async (req, res) => {
  try {
    const { person } = await loadPerson(req, req.params.pid)
    if (person.gmail_thread_id) return res.status(400).json({ error: 'Already emailed; drop the task or leave them on it' })
    const { error } = await supabaseAdmin.from('hub_task_people').delete().eq('id', person.id)
    if (error) throw error
    // Their slots are now unowned; give them to whoever else covers the club.
    await dl.applyOwners(await loadTask(req, person.task_id))
    res.json({ ok: true })
  } catch (e) { sendError(res, e) }
})

router.get('/people/:pid/messages', async (req, res) => {
  try {
    const { person } = await loadPerson(req, req.params.pid)
    res.json({ messages: await loadHistory(person.id) })
  } catch (e) { sendError(res, e) }
})

router.post('/people/:pid/draft', async (req, res) => {
  try {
    const { person, task } = await loadPerson(req, req.params.pid)
    const kind = KINDS.includes(req.body?.kind) ? req.body.kind : 'initial'
    if (kind === 'nudge' && !person.gmail_thread_id) return res.status(400).json({ error: 'Send them a first email before nudging' })
    const instructions = String(req.body?.instructions || '').trim().slice(0, 2000) || null
    if (kind === 'ask' && !instructions) return res.status(400).json({ error: 'Say what you want to ask' })
    const history = await loadHistory(person.id)
    const project = {
      recipient_name: person.name, recipient_email: person.email,
      title: task.title, details: task.description, due_date: task.due_date, instructions,
    }
    const { accessToken } = await getStaffGoogleAccessToken(req.staff.id)
    let samples = []
    try { samples = await gmail.recentSentSamples(accessToken, req.staff.id) } catch (e) {
      if (e.notConnected) throw e
      console.warn('[Hub] voice samples unavailable:', e.message)
    }
    const openSlots = await dl.openSlotLabels(person, task)
    const uploadUrl = openSlots.length ? await dl.uploadLink(person.id) : null
    const draft = await draftEmail({ kind, project, history, ownerName: ownerName(req.staff), samples, openSlots, uploadUrl })
    draft.body = withUploadLink(draft.body, uploadUrl)
    if (person.gmail_thread_id) draft.subject = gmail.replySubject(person.subject)
    res.json(draft)
  } catch (e) { sendError(res, e) }
})

router.post('/people/:pid/send', async (req, res) => {
  try {
    const { person, task } = await loadPerson(req, req.params.pid)
    if (['done', 'dropped'].includes(task.status)) return res.status(400).json({ error: 'This task is closed' })
    const kind = KINDS.includes(req.body?.kind) ? req.body.kind : 'initial'
    const body = String(req.body?.body || '').trim()
    if (!body) return res.status(400).json({ error: 'Message is required' })
    const newThread = !person.gmail_thread_id
    const subject = newThread
      ? String(req.body?.subject || '').trim().slice(0, 250)
      : gmail.replySubject(person.subject)
    if (!subject) return res.status(400).json({ error: 'Subject is required' })

    const { accessToken } = await getStaffGoogleAccessToken(req.staff.id)
    const sent = await gmail.sendEmail(accessToken, {
      toName: person.name, toEmail: person.email, subject, body,
      threadId: person.gmail_thread_id || undefined,
      inReplyTo: person.first_message_id_header || undefined,
    })
    // From here the email is gone: recordSend never throws, it warns instead.
    const result = await recordSend({
      db: {
        updatePerson: (id, patch) => supabaseAdmin.from('hub_task_people').update(patch).eq('id', id).select(PERSON_COLS).single(),
        insertMessage: row => supabaseAdmin.from('hub_task_messages').insert(row),
        updateTask: (id, patch) => supabaseAdmin.from('hub_tasks').update(patch).eq('id', id),
      },
      person, task, sent, kind, subject, body, now: new Date().toISOString(),
    })
    res.json(result)
  } catch (e) { sendError(res, e) }
})

router.post('/people/:pid/seen', async (req, res) => {
  try {
    const { person } = await loadPerson(req, req.params.pid)
    const { data, error } = await supabaseAdmin.from('hub_task_people').update({ reply_seen: true })
      .eq('id', person.id).select(PERSON_COLS).single()
    if (error) throw error
    res.json({ person: data })
  } catch (e) { sendError(res, e) }
})

// Reads every open thread and flags new replies. Run when the Hub opens.
router.post('/check-replies', async (req, res) => {
  try {
    const { data: tasks, error: tErr } = await supabaseAdmin.from('hub_tasks').select('id')
      .eq('owner_staff_id', req.staff.id).in('status', ['todo', 'waiting'])
    if (tErr) throw tErr
    if (!tasks?.length) return res.json({ updated: [] })
    const { data: people, error: pErr } = await supabaseAdmin.from('hub_task_people').select(PERSON_COLS)
      .in('task_id', tasks.map(t => t.id)).not('gmail_thread_id', 'is', null)
    if (pErr) throw pErr
    if (!people?.length) return res.json({ updated: [] })
    const { accessToken, email } = await getStaffGoogleAccessToken(req.staff.id)
    const ownerEmail = email || req.staff.email
    const updated = []
    let next = 0
    const worker = async () => {
      while (next < people.length) {
        const p = people[next++]
        try {
          const patch = applyReply(p, gmail.latestReply(await gmail.getThread(accessToken, p.gmail_thread_id), ownerEmail))
          if (!patch) continue
          const { data: row, error: upErr } = await supabaseAdmin.from('hub_task_people').update(patch)
            .eq('id', p.id).select(PERSON_COLS).single()
          if (upErr) console.warn('[Hub] reply save failed', p.id, upErr.message)
          if (row) updated.push(row)
        } catch (e) {
          if (e.notConnected) throw e
          console.warn('[Hub] thread check failed', p.id, e.message)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, people.length) }, worker))
    res.json({ updated })
  } catch (e) { sendError(res, e) }
})

module.exports = router

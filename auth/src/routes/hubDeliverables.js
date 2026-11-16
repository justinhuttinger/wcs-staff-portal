// Hub > Tasks > deliverables (owner side): define what's expected back, see
// and manage what came in, and get a person's no-login upload link.
const { Router } = require('express')
const multer = require('multer')
const { ownerOnly } = require('../lib/ownerGate')
const { supabaseAdmin } = require('../services/supabase')
const { kindAccepts } = require('../services/hub/slots')
const dl = require('../services/hub/deliverables')
const gmail = require('../services/followUps/gmail')
const { getStaffGoogleAccessToken } = require('../services/googleUserToken')

const router = Router()
router.use(ownerOnly)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KINDS = ['image', 'file', 'text']
const multerSingle = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } }).single('file')
const readFile = (req, res, next) => multerSingle(req, res, err => (err ? sendError(res, err) : next()))

function sendError(res, e) {
  if (e.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Files can be up to 25 MB' })
  res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 500).json({ error: e.message })
}
function notFound() { const e = new Error('Not found'); e.status = 404; return e }

async function ownTask(req, id) {
  if (!UUID_RE.test(String(id))) throw notFound()
  const { data } = await supabaseAdmin.from('hub_tasks').select('*').eq('id', id).eq('owner_staff_id', req.staff.id).maybeSingle()
  if (!data) throw notFound()
  return data
}
async function ownDeliverable(req, id) {
  if (!UUID_RE.test(String(id))) throw notFound()
  const { data } = await supabaseAdmin.from('hub_deliverables').select('*').eq('id', id).maybeSingle()
  if (!data) throw notFound()
  return { deliverable: data, task: await ownTask(req, data.task_id) }
}
async function ownSlot(req, id) {
  if (!UUID_RE.test(String(id))) throw notFound()
  const { data } = await supabaseAdmin.from('hub_slots').select('*').eq('id', id).maybeSingle()
  if (!data) throw notFound()
  return { slot: data, ...(await ownDeliverable(req, data.deliverable_id)) }
}
async function ownItem(req, id) {
  if (!UUID_RE.test(String(id))) throw notFound()
  const { data } = await supabaseAdmin.from('hub_slot_items').select('*').eq('id', id).maybeSingle()
  if (!data) throw notFound()
  return { item: data, ...(await ownSlot(req, data.slot_id)) }
}
async function personOnTask(personId, taskId) {
  if (!personId) return null
  if (!UUID_RE.test(String(personId))) return false
  const { data } = await supabaseAdmin.from('hub_task_people').select('id').eq('id', personId).eq('task_id', taskId).maybeSingle()
  return data ? data.id : false
}

router.get('/tasks/:id/deliverables', async (req, res) => {
  try {
    const task = await ownTask(req, req.params.id)
    res.json({ deliverables: await dl.loadTaskDeliverables(task) })
  } catch (e) { sendError(res, e) }
})

router.post('/tasks/:id/deliverables', async (req, res) => {
  try {
    const task = await ownTask(req, req.params.id)
    const name = String(req.body?.name || '').trim().slice(0, 80)
    const kind = req.body?.kind
    if (!name) return res.status(400).json({ error: 'Name is required' })
    if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Pick image, file or text' })
    const personId = await personOnTask(req.body?.person_id, task.id)
    if (personId === false) return res.status(400).json({ error: 'That person is not on this task' })
    const { count } = await supabaseAdmin.from('hub_deliverables').select('id', { count: 'exact', head: true }).eq('task_id', task.id)
    const { error } = await supabaseAdmin.from('hub_deliverables')
      .insert({ task_id: task.id, person_id: personId, name, kind, sort: count || 0 })
    if (error) throw error
    await dl.resyncSlots(task)
    await dl.refreshPersonDelivered(personId)
    res.json({ deliverables: await dl.loadTaskDeliverables(task) })
  } catch (e) { sendError(res, e) }
})

router.patch('/deliverables/:id', async (req, res) => {
  try {
    const { deliverable, task } = await ownDeliverable(req, req.params.id)
    const patch = {}
    if (req.body?.name !== undefined) {
      const name = String(req.body.name || '').trim().slice(0, 80)
      if (!name) return res.status(400).json({ error: 'Name is required' })
      patch.name = name
    }
    if (req.body?.person_id !== undefined) {
      const personId = await personOnTask(req.body.person_id, task.id)
      if (personId === false) return res.status(400).json({ error: 'That person is not on this task' })
      patch.person_id = personId
    }
    const { error } = await supabaseAdmin.from('hub_deliverables').update(patch).eq('id', deliverable.id)
    if (error) throw error
    await dl.refreshPersonDelivered(deliverable.person_id)
    if (patch.person_id !== undefined) await dl.refreshPersonDelivered(patch.person_id)
    res.json({ deliverables: await dl.loadTaskDeliverables(task) })
  } catch (e) { sendError(res, e) }
})

router.delete('/deliverables/:id', async (req, res) => {
  try {
    const { deliverable, task } = await ownDeliverable(req, req.params.id)
    const { data: slots } = await supabaseAdmin.from('hub_slots').select('id').eq('deliverable_id', deliverable.id)
    const ids = (slots || []).map(s => s.id)
    if (ids.length) {
      const { data: items } = await supabaseAdmin.from('hub_slot_items').select('storage_path').in('slot_id', ids)
      const paths = (items || []).map(i => i.storage_path).filter(Boolean)
      if (paths.length) await supabaseAdmin.storage.from(dl.BUCKET).remove(paths)
    }
    const { error } = await supabaseAdmin.from('hub_deliverables').delete().eq('id', deliverable.id)
    if (error) throw error
    await dl.refreshPersonDelivered(deliverable.person_id)
    res.json({ deliverables: await dl.loadTaskDeliverables(task) })
  } catch (e) { sendError(res, e) }
})

// Owner fills a slot himself: a file (multipart "file") or {text}.
router.post('/slots/:id/items', readFile, async (req, res) => {
  try {
    const { slot, deliverable, task } = await ownSlot(req, req.params.id)
    if (deliverable.kind === 'text') {
      const text = String(req.body?.text || '').trim()
      if (!text) return res.status(400).json({ error: 'Text is required' })
      await dl.addSlotItem({ taskId: task.id, slotId: slot.id, text, source: 'owner', isNew: false })
    } else {
      if (!req.file) return res.status(400).json({ error: 'Choose a file' })
      if (!kindAccepts(deliverable.kind, req.file.mimetype)) return res.status(400).json({ error: 'This slot takes images only' })
      await dl.addSlotItem({ taskId: task.id, slotId: slot.id, file: req.file, source: 'owner', isNew: false })
    }
    await dl.refreshPersonDelivered(deliverable.person_id)
    res.json({ deliverables: await dl.loadTaskDeliverables(task) })
  } catch (e) { sendError(res, e) }
})

router.delete('/slot-items/:id', async (req, res) => {
  try {
    const { item, deliverable, task } = await ownItem(req, req.params.id)
    await dl.removeSlotItem(item)
    await dl.refreshPersonDelivered(deliverable.person_id)
    res.json({ deliverables: await dl.loadTaskDeliverables(task) })
  } catch (e) { sendError(res, e) }
})

router.get('/slot-items/:id/url', async (req, res) => {
  try {
    const { item } = await ownItem(req, req.params.id)
    if (!item.storage_path) return res.status(400).json({ error: 'No file on this item' })
    res.json({ url: await dl.signedUrl(item.storage_path) })
  } catch (e) { sendError(res, e) }
})

router.post('/slot-items/:id/seen', async (req, res) => {
  try {
    const { item } = await ownItem(req, req.params.id)
    const { error } = await supabaseAdmin.from('hub_slot_items').update({ is_new: false }).eq('id', item.id)
    if (error) throw error
    res.json({ ok: true })
  } catch (e) { sendError(res, e) }
})

router.post('/people/:pid/upload-link', async (req, res) => {
  try {
    if (!UUID_RE.test(String(req.params.pid))) throw notFound()
    const { data: person } = await supabaseAdmin.from('hub_task_people').select('id, task_id').eq('id', req.params.pid).maybeSingle()
    if (!person) throw notFound()
    await ownTask(req, person.task_id)
    res.json({ url: await dl.uploadLink(person.id) })
  } catch (e) { sendError(res, e) }
})

// ---- Tray: attachments the Gmail check couldn't file on its own ----

async function ownTrayItem(req, id) {
  if (!UUID_RE.test(String(id))) throw notFound()
  const { data: item } = await supabaseAdmin.from('hub_tray_items').select('*').eq('id', id).maybeSingle()
  if (!item) throw notFound()
  const { data: person } = await supabaseAdmin.from('hub_task_people').select('id, task_id, name').eq('id', item.person_id).maybeSingle()
  if (!person) throw notFound()
  return { item, person, task: await ownTask(req, person.task_id) }
}

router.get('/tasks/:id/tray', async (req, res) => {
  try {
    const task = await ownTask(req, req.params.id)
    const { data: people } = await supabaseAdmin.from('hub_task_people').select('id, name').eq('task_id', task.id)
    const ids = (people || []).map(p => p.id)
    const { data: items } = ids.length
      ? await supabaseAdmin.from('hub_tray_items').select('*').in('person_id', ids).order('created_at')
      : { data: [] }
    res.json({ items: (items || []).map(i => ({ ...i, person_name: people.find(p => p.id === i.person_id)?.name || '' })) })
  } catch (e) { sendError(res, e) }
})

router.get('/tray/:id/url', async (req, res) => {
  try {
    const { item } = await ownTrayItem(req, req.params.id)
    res.json({ url: await dl.signedUrl(item.storage_path) })
  } catch (e) { sendError(res, e) }
})

// File a tray item into a slot on the same task. The owner chose it, so it is
// not "new". The stored file is reused, not copied.
router.post('/tray/:id/file', async (req, res) => {
  try {
    const { item, task } = await ownTrayItem(req, req.params.id)
    const { slot, deliverable, task: slotTask } = await ownSlot(req, req.body?.slotId)
    if (slotTask.id !== task.id) return res.status(400).json({ error: 'That slot is on another task' })
    if (!kindAccepts(deliverable.kind, item.mime)) return res.status(400).json({ error: deliverable.kind === 'text' ? 'That slot takes text' : 'That slot takes images only' })
    const { error } = await supabaseAdmin.from('hub_slot_items').insert({
      slot_id: slot.id, storage_path: item.storage_path, file_name: item.file_name, mime: item.mime,
      size_bytes: item.size_bytes, source: 'email', is_new: false,
      gmail_message_id: item.gmail_message_id, gmail_attachment_id: item.gmail_attachment_id,
    })
    if (error && error.code !== '23505') throw error
    const { error: delErr } = await supabaseAdmin.from('hub_tray_items').delete().eq('id', item.id)
    if (delErr) throw delErr
    await dl.refreshPersonDelivered(deliverable.person_id)
    res.json({ deliverables: await dl.loadTaskDeliverables(task) })
  } catch (e) { sendError(res, e) }
})

router.delete('/tray/:id', async (req, res) => {
  try {
    const { item } = await ownTrayItem(req, req.params.id)
    await supabaseAdmin.storage.from(dl.BUCKET).remove([item.storage_path])
    const { error } = await supabaseAdmin.from('hub_tray_items').delete().eq('id', item.id)
    if (error) throw error
    res.json({ ok: true })
  } catch (e) { sendError(res, e) }
})

// Put the person's latest reply text (quotes stripped) into a text slot.
router.post('/people/:pid/use-reply-text', async (req, res) => {
  try {
    if (!UUID_RE.test(String(req.params.pid))) throw notFound()
    const { data: person } = await supabaseAdmin.from('hub_task_people').select('*').eq('id', req.params.pid).maybeSingle()
    if (!person) throw notFound()
    const task = await ownTask(req, person.task_id)
    const { slot, deliverable, task: slotTask } = await ownSlot(req, req.body?.slotId)
    if (slotTask.id !== task.id) return res.status(400).json({ error: 'That slot is on another task' })
    if (deliverable.kind !== 'text') return res.status(400).json({ error: 'Pick a text slot' })
    if (!person.gmail_thread_id) return res.status(400).json({ error: 'No reply to use' })
    let text = ''
    try {
      const { accessToken, email } = await getStaffGoogleAccessToken(req.staff.id)
      const owner = String(email || req.staff.email).toLowerCase()
      const messages = await gmail.getThreadFull(accessToken, person.gmail_thread_id)
      const theirs = messages.filter(m => !gmail.emailFrom(gmail.headerValue(m.payload?.headers, 'From')).includes(owner))
      const last = theirs.sort((a, b) => Number(b.internalDate) - Number(a.internalDate))[0]
      if (last) text = gmail.stripQuoted(gmail.extractPlainText(last.payload))
    } catch (e) {
      if (e.notConnected) return res.status(412).json({ error: 'Connect Gmail first', code: 'gmail_not_connected' })
      throw e
    }
    text = text || person.last_reply_snippet || ''
    if (!text.trim()) return res.status(400).json({ error: 'Their reply has no text' })
    await dl.addSlotItem({ taskId: task.id, slotId: slot.id, text, source: 'email', isNew: false })
    await dl.refreshPersonDelivered(deliverable.person_id)
    res.json({ deliverables: await dl.loadTaskDeliverables(task) })
  } catch (e) { sendError(res, e) }
})

module.exports = router

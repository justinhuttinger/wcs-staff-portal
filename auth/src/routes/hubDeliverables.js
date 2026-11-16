// Hub > Tasks > deliverables (owner side): define what's expected back, see
// and manage what came in, and get a person's no-login upload link.
const { Router } = require('express')
const multer = require('multer')
const { ownerOnly } = require('../lib/ownerGate')
const { supabaseAdmin } = require('../services/supabase')
const { kindAccepts } = require('../services/hub/slots')
const dl = require('../services/hub/deliverables')
const { hubFileName, realDrive, folderUrl } = require('../services/hub/drive')
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
      .insert({ task_id: task.id, name, kind, sort: count || 0 })
    if (error) throw error
    await dl.resyncSlots(task)
    // Club slots get owners from the clubs people cover. A task with no clubs
    // has one slot; it goes to the person picked in the form.
    if (personId && !(task.clubs || []).length) {
      const { data: d } = await supabaseAdmin.from('hub_deliverables').select('id').eq('task_id', task.id)
        .eq('name', name).order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (d) await supabaseAdmin.from('hub_slots').update({ person_id: personId }).eq('deliverable_id', d.id).is('club', null)
      await dl.applyOwners(task, { refreshAll: true })
    }
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
    const { error } = await supabaseAdmin.from('hub_deliverables').update(patch).eq('id', deliverable.id)
    if (error) throw error
    res.json({ deliverables: await dl.loadTaskDeliverables(task) })
  } catch (e) { sendError(res, e) }
})

router.delete('/deliverables/:id', async (req, res) => {
  try {
    const { deliverable, task } = await ownDeliverable(req, req.params.id)
    const { data: slots } = await supabaseAdmin.from('hub_slots').select('id').eq('deliverable_id', deliverable.id)
    const ids = (slots || []).map(s => s.id)
    if (ids.length) {
      const { data: items } = await supabaseAdmin.from('hub_slot_items').select('storage_path, drive_file_id').in('slot_id', ids)
      for (const it of items || []) await dl.discardStored(it, task.owner_staff_id)
    }
    const { error } = await supabaseAdmin.from('hub_deliverables').delete().eq('id', deliverable.id)
    if (error) throw error
    await dl.applyOwners(task, { refreshAll: true })
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
    await dl.applyOwners(task, { refreshAll: true })
    res.json({ deliverables: await dl.loadTaskDeliverables(task) })
  } catch (e) { sendError(res, e) }
})

// Set who owes one slot by hand (a person on the same task, or null for
// nobody); hand-set slots are never changed automatically. {auto: true} hands
// the slot back to automatic assignment by clubs.
router.patch('/slots/:id', async (req, res) => {
  try {
    const { slot, task } = await ownSlot(req, req.params.id)
    if (req.body?.auto === true) {
      const { error } = await supabaseAdmin.from('hub_slots').update({ owner_manual: false }).eq('id', slot.id)
      if (error) throw error
      await dl.applyOwners(task, { refreshAll: true })
      return res.json({ deliverables: await dl.loadTaskDeliverables(task) })
    }
    const personId = await personOnTask(req.body?.person_id, task.id)
    if (personId === false) return res.status(400).json({ error: 'That person is not on this task' })
    const { error } = await supabaseAdmin.from('hub_slots').update({ person_id: personId, owner_manual: true }).eq('id', slot.id)
    if (error) throw error
    if (slot.person_id) await dl.refreshPersonDelivered(slot.person_id)
    if (personId) await dl.refreshPersonDelivered(personId)
    res.json({ deliverables: await dl.loadTaskDeliverables(task) })
  } catch (e) { sendError(res, e) }
})

router.delete('/slot-items/:id', async (req, res) => {
  try {
    const { item, deliverable, task } = await ownItem(req, req.params.id)
    await dl.removeSlotItem(item, task.owner_staff_id)
    await dl.applyOwners(task, { refreshAll: true })
    res.json({ deliverables: await dl.loadTaskDeliverables(task) })
  } catch (e) { sendError(res, e) }
})

router.get('/slot-items/:id/url', async (req, res) => {
  try {
    const { item } = await ownItem(req, req.params.id)
    const url = await dl.openUrl(item)
    if (!url) return res.status(400).json({ error: 'No file on this item' })
    res.json({ url })
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
    const { data: people } = await supabaseAdmin.from('hub_task_people').select('id, name, gmail_thread_id').eq('task_id', task.id)
    const ids = (people || []).map(p => p.id)
    const { data: items } = ids.length
      ? await supabaseAdmin.from('hub_tray_items').select('*').in('person_id', ids).order('created_at')
      : { data: [] }
    res.json({ items: (items || []).map(i => {
      const p = people.find(x => x.id === i.person_id)
      return { ...i, person_name: p?.name || '', thread_id: p?.gmail_thread_id || null }
    }) })
  } catch (e) { sendError(res, e) }
})

router.get('/tray/:id/url', async (req, res) => {
  try {
    const { item } = await ownTrayItem(req, req.params.id)
    const url = await dl.openUrl(item)
    if (!url) return res.status(400).json({ error: 'Too large to pull in; open it in Gmail' })
    res.json({ url })
  } catch (e) { sendError(res, e) }
})

// File a tray item into a slot on the same task. The owner chose it, so it is
// not "new". The stored file is reused, not copied.
router.post('/tray/:id/file', async (req, res) => {
  try {
    const { item, task } = await ownTrayItem(req, req.params.id)
    if (!item.storage_path && !item.drive_file_id) return res.status(400).json({ error: 'Too large to pull in; open it in Gmail' })
    const { slot, deliverable, task: slotTask } = await ownSlot(req, req.body?.slotId)
    if (slotTask.id !== task.id) return res.status(400).json({ error: 'That slot is on another task' })
    if (!kindAccepts(deliverable.kind, item.mime)) return res.status(400).json({ error: deliverable.kind === 'text' ? 'That slot takes text' : 'That slot takes images only' })
    // A Drive file gets the slot's name now that we know where it belongs.
    let fileName = item.file_name
    if (item.drive_file_id) {
      try {
        const ctx = await dl.slotContext(slot.id)
        fileName = hubFileName({ ...ctx, ext: (String(item.file_name).match(/\.([A-Za-z0-9]{1,8})$/) || [])[1] || '' })
        const { accessToken } = await getStaffGoogleAccessToken(task.owner_staff_id)
        await realDrive.rename(accessToken, item.drive_file_id, fileName)
      } catch (e) { console.warn('[HubDrive] rename failed', e.message); fileName = item.file_name }
    }
    const { error } = await supabaseAdmin.from('hub_slot_items').insert({
      slot_id: slot.id, storage_path: item.storage_path, drive_file_id: item.drive_file_id, drive_url: item.drive_url,
      file_name: fileName, mime: item.mime,
      size_bytes: item.size_bytes, source: 'email', is_new: false,
      gmail_message_id: item.gmail_message_id, gmail_attachment_id: item.gmail_attachment_id,
    })
    if (error && error.code !== '23505') throw error
    const { error: delErr } = await supabaseAdmin.from('hub_tray_items').delete().eq('id', item.id)
    if (delErr) throw delErr
    await dl.applyOwners(task, { refreshAll: true })
    res.json({ deliverables: await dl.loadTaskDeliverables(task) })
  } catch (e) { sendError(res, e) }
})

router.delete('/tray/:id', async (req, res) => {
  try {
    const { item, task } = await ownTrayItem(req, req.params.id)
    const { error } = await supabaseAdmin.from('hub_tray_items').delete().eq('id', item.id)
    if (error) throw error
    await dl.discardStored(item, task.owner_staff_id)
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
      const theirs = messages.filter(m => gmail.emailFrom(gmail.headerValue(m.payload?.headers, 'From')) !== owner)
      const last = theirs.sort((a, b) => Number(b.internalDate) - Number(a.internalDate))[0]
      if (last) text = gmail.stripQuoted(gmail.extractPlainText(last.payload))
    } catch (e) {
      if (e.notConnected) return res.status(412).json({ error: 'Connect Gmail first', code: 'gmail_not_connected' })
      throw e
    }
    text = text || person.last_reply_snippet || ''
    if (!text.trim()) return res.status(400).json({ error: 'Their reply has no text' })
    await dl.addSlotItem({ taskId: task.id, slotId: slot.id, text, source: 'email', isNew: false })
    await dl.applyOwners(task, { refreshAll: true })
    res.json({ deliverables: await dl.loadTaskDeliverables(task) })
  } catch (e) { sendError(res, e) }
})

// ---- Google Drive: folder link, and the one-time move of portal files ----

router.get('/drive', async (req, res) => {
  try {
    const tasks = (await supabaseAdmin.from('hub_tasks').select('id').eq('owner_staff_id', req.staff.id)).data || []
    let portalFiles = 0
    if (tasks.length) {
      const dels = (await supabaseAdmin.from('hub_deliverables').select('id').in('task_id', tasks.map(t => t.id))).data || []
      const slots = dels.length ? ((await supabaseAdmin.from('hub_slots').select('id').in('deliverable_id', dels.map(d => d.id))).data || []) : []
      if (slots.length) {
        const { count } = await supabaseAdmin.from('hub_slot_items').select('id', { count: 'exact', head: true })
          .in('slot_id', slots.map(s => s.id)).not('storage_path', 'is', null)
        portalFiles = count || 0
      }
    }
    res.json({ folderUrl: await folderUrl(req.staff.id), portalFiles })
  } catch (e) { sendError(res, e) }
})

router.post('/drive/move', async (req, res) => {
  try {
    const result = await dl.moveFilesToDrive(req.staff.id)
    res.json({ ...result, folderUrl: await folderUrl(req.staff.id) })
  } catch (e) {
    if (e.notConnected) return res.status(412).json({ error: 'Connect Gmail/Google first', code: 'gmail_not_connected' })
    sendError(res, e)
  }
})

module.exports = router

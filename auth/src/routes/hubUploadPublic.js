// Public, no-login upload page API for Hub deliverables. A token names one
// person on one task; it can only list and fill that person's own slots, and
// stops working when the task is done or dropped. Contents of filled slots are
// never returned, only "received".
const { Router } = require('express')
const multer = require('multer')
const rateLimit = require('express-rate-limit')
const { supabaseAdmin } = require('../services/supabase')
const { validateUploadTarget, kindAccepts, slotLabel } = require('../services/hub/slots')
const dl = require('../services/hub/deliverables')

const router = Router()
router.use(rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }))

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } })

const db = {
  getToken: async t => (TOKEN_RE.test(String(t))
    ? (await supabaseAdmin.from('hub_upload_tokens').select('person_id').eq('token', t).maybeSingle()).data
    : null),
  getPerson: async id => (await supabaseAdmin.from('hub_task_people').select('id, task_id, name').eq('id', id).maybeSingle()).data,
  getTask: async id => (await supabaseAdmin.from('hub_tasks').select('id, status, title, due_date, clubs, owner_staff_id').eq('id', id).maybeSingle()).data,
  getSlot: async id => {
    if (!UUID_RE.test(String(id))) return null
    const { data: slot } = await supabaseAdmin.from('hub_slots').select('id, club, deliverable_id').eq('id', id).maybeSingle()
    if (!slot) return null
    const { data: deliverable } = await supabaseAdmin.from('hub_deliverables')
      .select('id, person_id, task_id, kind, name').eq('id', slot.deliverable_id).maybeSingle()
    return deliverable ? { ...slot, deliverable } : null
  },
}

function sendError(res, e) {
  if (e.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Files can be up to 25 MB' })
  const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500
  if (status === 500) console.error('[HubUpload]', e.message)
  res.status(status).json({ error: status === 500 ? 'Something went wrong, please try again' : e.message })
}

router.get('/:token', async (req, res) => {
  try {
    const { person, task } = await validateUploadTarget({ db, token: req.params.token })
    const { data: owner } = await supabaseAdmin.from('staff').select('first_name, display_name').eq('id', task.owner_staff_id).maybeSingle()
    const { data: dels } = await supabaseAdmin.from('hub_deliverables').select('id, name, kind, sort')
      .eq('person_id', person.id).order('sort')
    const delIds = (dels || []).map(d => d.id)
    let slots = []
    if (delIds.length) {
      const { data: s } = await supabaseAdmin.from('hub_slots').select('id, club, deliverable_id').in('deliverable_id', delIds)
      const { data: items } = s?.length
        ? await supabaseAdmin.from('hub_slot_items').select('slot_id').in('slot_id', s.map(x => x.id))
        : { data: [] }
      const filled = new Set((items || []).map(i => i.slot_id))
      const names = await dl.clubNames()
      slots = (s || []).map(x => {
        const d = dels.find(dd => dd.id === x.deliverable_id)
        return { id: x.id, label: slotLabel(d, x.club, names), kind: d.kind, received: filled.has(x.id), sort: d.sort }
      }).sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
    }
    res.json({
      ownerFirstName: owner?.first_name || String(owner?.display_name || '').split(' ')[0] || '',
      personFirstName: person.name.split(' ')[0],
      taskTitle: task.title,
      dueDate: task.due_date,
      slots: slots.map(({ sort, ...rest }) => rest),
    })
  } catch (e) { sendError(res, e) }
})

router.post('/:token/slots/:slotId', upload.single('file'), async (req, res) => {
  try {
    const { person, task, slot } = await validateUploadTarget({ db, token: req.params.token, slotId: req.params.slotId })
    const kind = slot.deliverable.kind
    if (kind === 'text') {
      const text = String(req.body?.text || '').trim()
      if (!text) return res.status(400).json({ error: 'Please type something first' })
      await dl.addSlotItem({ taskId: task.id, slotId: slot.id, text, source: 'upload', isNew: true })
    } else {
      if (!req.file) return res.status(400).json({ error: 'Choose a file first' })
      if (!kindAccepts(kind, req.file.mimetype)) return res.status(400).json({ error: 'This one needs a photo or image file' })
      await dl.addSlotItem({ taskId: task.id, slotId: slot.id, file: req.file, source: 'upload', isNew: true })
    }
    await dl.refreshPersonDelivered(person.id)
    res.json({ ok: true })
  } catch (e) { sendError(res, e) }
})

module.exports = router

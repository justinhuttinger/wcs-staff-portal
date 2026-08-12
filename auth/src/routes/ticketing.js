const { Router } = require('express')
const multer = require('multer')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const {
  validateSchema,
  validateSubmission,
  renderTitle,
  titleTemplateTokens,
  makeSlug,
} = require('../services/ticketingSchema')

const router = Router()
router.use(authenticate)
// NOTE: this module is NOT blanket admin-only. Two personas share it:
//   - Makers  (any authenticated staff): create tickets + view status.
//   - Handlers (assigned per ticket type, + all admins): edit / mark done.
// Type management (the builder) is admin-only, gated per-route below.

const BUCKET = 'ticket-attachments'
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })

let bucketReady = false
async function ensureBucket() {
  if (bucketReady) return
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: '25MB' })
  if (error && !/exist/i.test(error.message || '')) throw error
  bucketReady = true
}

function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE'
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'File exceeds the 25 MB limit' : 'Upload failed' })
    }
    next()
  })
}

const isAdmin = (staff) => staff?.role === 'admin'

// A handler for a type is an admin or a staff id listed in the type's handler_ids.
function canHandleType(staff, type) {
  if (isAdmin(staff)) return true
  const ids = Array.isArray(type?.handler_ids) ? type.handler_ids : []
  return ids.includes(staff.id)
}

async function nameMap(ids) {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return {}
  const { data } = await supabaseAdmin.from('staff').select('id, display_name, first_name, last_name').in('id', uniq)
  const map = {}
  for (const s of data || []) {
    map[s.id] = s.display_name || [s.first_name, s.last_name].filter(Boolean).join(' ') || 'Unknown'
  }
  return map
}

async function signAttachment(path) {
  const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 60 * 60)
  return data?.signedUrl || null
}

// Load a type by id (cached-per-request would be nice; kept simple).
async function getType(id) {
  const { data } = await supabaseAdmin.from('ticket_types').select('*').eq('id', id).maybeSingle()
  return data || null
}

// Ids of the types the caller can handle (admins → all). Used to scope the
// handler queue and to tell the UI whether to show it.
async function handledTypeIds(staff) {
  const { data } = await supabaseAdmin.from('ticket_types').select('id, handler_ids')
  const rows = data || []
  if (isAdmin(staff)) return rows.map(r => r.id)
  return rows.filter(r => (r.handler_ids || []).includes(staff.id)).map(r => r.id)
}

// ---------------------------------------------------------------------------
// Ticket types (the builder) — admin only
// ---------------------------------------------------------------------------

function normHandlerIds(v) {
  if (!Array.isArray(v)) return undefined
  return [...new Set(v.filter(x => typeof x === 'string' && x))]
}

// A title template is literal text plus {{field_id}} tokens. Every token must
// name a field in this type's own schema, otherwise it would silently render
// blank for every ticket.
function checkTitleTemplate(template, schema) {
  const tpl = template == null ? '' : String(template).trim()
  if (!tpl) return { ok: true, value: null }
  if (tpl.length > 200) return { ok: false, error: 'Title format is too long (200 characters max)' }
  const known = new Set((Array.isArray(schema) ? schema : []).map(f => f.id))
  const unknown = titleTemplateTokens(tpl).filter(id => !known.has(id))
  if (unknown.length > 0) {
    return { ok: false, error: `Title format references unknown field(s): ${unknown.join(', ')}` }
  }
  return { ok: true, value: tpl }
}

// GET /ticketing/types — list types. Any staff (needed to submit); ?active=1
// restricts to active. Non-admins still see the list (names only matter).
router.get('/types', async (req, res) => {
  try {
    let q = supabaseAdmin.from('ticket_types').select('*').order('sort_order').order('created_at')
    if (req.query.active === '1') q = q.eq('active', true)
    const { data, error } = await q
    if (error) throw error
    res.json({ types: data || [] })
  } catch (err) {
    console.error('[Ticketing] list types failed:', err.message)
    res.status(500).json({ error: 'Failed to load ticket types' })
  }
})

// GET /ticketing/assignable-staff — active staff for the handler picker (admin)
router.get('/assignable-staff', requireRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('staff')
      .select('id, display_name, first_name, last_name, role, is_active')
      .eq('is_active', true).order('display_name')
    if (error) throw error
    res.json({
      staff: (data || []).map(s => ({
        id: s.id,
        name: s.display_name || [s.first_name, s.last_name].filter(Boolean).join(' ') || 'Unknown',
        role: s.role,
      })),
    })
  } catch (err) {
    console.error('[Ticketing] assignable-staff failed:', err.message)
    res.status(500).json({ error: 'Failed to load staff' })
  }
})

router.post('/types', requireRole('admin'), async (req, res) => {
  try {
    const { name, description, icon, schema = [], active = true, sort_order = 0, handler_ids, title_template } = req.body || {}
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' })
    const check = validateSchema(schema)
    if (!check.ok) return res.status(400).json({ error: check.error })
    const title = checkTitleTemplate(title_template, schema)
    if (!title.ok) return res.status(400).json({ error: title.error })

    let slug = makeSlug(name)
    const { data: existing } = await supabaseAdmin.from('ticket_types').select('slug').like('slug', `${slug}%`)
    const taken = new Set((existing || []).map(r => r.slug))
    if (taken.has(slug)) { let n = 2; while (taken.has(`${slug}-${n}`)) n++; slug = `${slug}-${n}` }

    const insert = {
      slug,
      name: String(name).trim(),
      description: description ? String(description).trim() : null,
      icon: icon || null,
      schema,
      active: !!active,
      sort_order: Number(sort_order) || 0,
      title_template: title.value,
      created_by: req.staff.id,
    }
    const h = normHandlerIds(handler_ids)
    if (h) insert.handler_ids = h
    const { data, error } = await supabaseAdmin.from('ticket_types').insert(insert).select().single()
    if (error) throw error
    res.status(201).json({ type: data })
  } catch (err) {
    console.error('[Ticketing] create type failed:', err.message)
    res.status(500).json({ error: 'Failed to create ticket type' })
  }
})

router.patch('/types/:id', requireRole('admin'), async (req, res) => {
  try {
    const patch = {}
    const b = req.body || {}
    if (b.name !== undefined) {
      if (!String(b.name).trim()) return res.status(400).json({ error: 'Name cannot be empty' })
      patch.name = String(b.name).trim()
    }
    if (b.description !== undefined) patch.description = b.description ? String(b.description).trim() : null
    if (b.icon !== undefined) patch.icon = b.icon || null
    if (b.schema !== undefined) {
      const check = validateSchema(b.schema)
      if (!check.ok) return res.status(400).json({ error: check.error })
      patch.schema = b.schema
    }
    if (b.active !== undefined) patch.active = !!b.active
    if (b.sort_order !== undefined) patch.sort_order = Number(b.sort_order) || 0
    if (b.handler_ids !== undefined) { const h = normHandlerIds(b.handler_ids); if (h) patch.handler_ids = h }
    if (b.title_template !== undefined) {
      // Validate tokens against the schema this update leaves in place.
      const effectiveSchema = b.schema !== undefined ? b.schema : (await getType(req.params.id))?.schema || []
      const title = checkTitleTemplate(b.title_template, effectiveSchema)
      if (!title.ok) return res.status(400).json({ error: title.error })
      patch.title_template = title.value
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update' })

    const { data, error } = await supabaseAdmin.from('ticket_types').update(patch).eq('id', req.params.id).select().single()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Ticket type not found' })
    res.json({ type: data })
  } catch (err) {
    console.error('[Ticketing] update type failed:', err.message)
    res.status(500).json({ error: 'Failed to update ticket type' })
  }
})

router.delete('/types/:id', requireRole('admin'), async (req, res) => {
  try {
    const { count } = await supabaseAdmin.from('tickets').select('id', { count: 'exact', head: true }).eq('type_id', req.params.id)
    if (count && count > 0) return res.status(409).json({ error: `In use by ${count} ticket(s). Deactivate it instead.` })
    const { error } = await supabaseAdmin.from('ticket_types').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    console.error('[Ticketing] delete type failed:', err.message)
    res.status(500).json({ error: 'Failed to delete ticket type' })
  }
})

// ---------------------------------------------------------------------------
// Reads — available to any authenticated staff (maker status views)
// ---------------------------------------------------------------------------

async function decorate(rows) {
  const typeIds = [...new Set(rows.map(t => t.type_id))]
  const [{ data: types }, names] = await Promise.all([
    typeIds.length ? supabaseAdmin.from('ticket_types').select('id, name, icon').in('id', typeIds) : Promise.resolve({ data: [] }),
    nameMap(rows.map(t => t.submitter_id).concat(rows.map(t => t.assigned_to))),
  ])
  const typeMap = Object.fromEntries((types || []).map(t => [t.id, t]))
  return rows.map(t => ({
    ...t,
    type_name: typeMap[t.type_id]?.name || 'Ticket',
    type_icon: typeMap[t.type_id]?.icon || null,
    submitter_name: names[t.submitter_id] || 'Unknown',
    assignee_name: t.assigned_to ? (names[t.assigned_to] || 'Unknown') : null,
  }))
}

// GET /ticketing/board — personal status view, grouped. Scoped to the caller's
// OWN submitted tickets (a regular person only sees what they submitted).
// Handlers work others' tickets via the handler queue (GET /?handling=1), not
// here. ?days=N sets the recently-completed window (default 7).
router.get('/board', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 60)
    const since = new Date(Date.now() - days * 86400000).toISOString()
    const { data, error } = await supabaseAdmin.from('tickets').select('*')
      .eq('submitter_id', req.staff.id)
      .order('created_at', { ascending: false }).limit(500)
    if (error) throw error
    const all = await decorate(data || [])
    res.json({
      open: all.filter(t => t.status === 'open'),
      in_progress: all.filter(t => t.status === 'in_progress'),
      recently_completed: all.filter(t => t.status === 'complete' && t.completed_at && t.completed_at >= since),
      counts: {
        open: all.filter(t => t.status === 'open').length,
        in_progress: all.filter(t => t.status === 'in_progress').length,
        complete: all.filter(t => t.status === 'complete').length,
      },
      window_days: days,
    })
  } catch (err) {
    console.error('[Ticketing] board failed:', err.message)
    res.status(500).json({ error: 'Failed to load board' })
  }
})

// GET /ticketing/can-handle — does the caller handle any type? (drives the
// handler queue tab). Returns { any, type_ids }.
router.get('/can-handle', async (req, res) => {
  try {
    const ids = await handledTypeIds(req.staff)
    res.json({ any: isAdmin(req.staff) || ids.length > 0, admin: isAdmin(req.staff), type_ids: ids })
  } catch (err) {
    console.error('[Ticketing] can-handle failed:', err.message)
    res.status(500).json({ error: 'Failed' })
  }
})

// GET /ticketing — inbox list. ?status= &type_id= &q= &handling=1
// handling=1 scopes to the types the caller handles (the handler queue).
router.get('/', async (req, res) => {
  try {
    let q = supabaseAdmin.from('tickets').select('*').order('created_at', { ascending: false }).limit(500)
    if (req.query.status) q = q.eq('status', req.query.status)
    if (req.query.type_id) q = q.eq('type_id', req.query.type_id)
    if (req.query.handling === '1') {
      // Handler queue: tickets of the types the caller handles.
      const ids = await handledTypeIds(req.staff)
      if (ids.length === 0) return res.json({ tickets: [] })
      q = q.in('type_id', ids)
    } else if (!isAdmin(req.staff)) {
      // Personal view: a non-admin only sees tickets they submitted.
      q = q.eq('submitter_id', req.staff.id)
    }
    const { data, error } = await q
    if (error) throw error
    let rows = await decorate(data || [])
    const term = String(req.query.q || '').trim().toLowerCase()
    if (term) rows = rows.filter(t => (t.title || '').toLowerCase().includes(term))
    res.json({ tickets: rows })
  } catch (err) {
    console.error('[Ticketing] list tickets failed:', err.message)
    res.status(500).json({ error: 'Failed to load tickets' })
  }
})

router.get('/summary', async (req, res) => {
  try {
    let q = supabaseAdmin.from('tickets').select('status, type_id, submitter_id')
    const { data, error } = await q
    if (error) throw error
    let rows = data || []
    if (req.query.handling === '1') {
      const ids = new Set(await handledTypeIds(req.staff))
      rows = rows.filter(r => ids.has(r.type_id))
    } else if (!isAdmin(req.staff)) {
      rows = rows.filter(r => r.submitter_id === req.staff.id)
    }
    const counts = { open: 0, in_progress: 0, complete: 0, closed: 0 }
    for (const r of rows) if (counts[r.status] !== undefined) counts[r.status]++
    res.json({ counts, total: rows.length })
  } catch (err) {
    console.error('[Ticketing] summary failed:', err.message)
    res.status(500).json({ error: 'Failed to load summary' })
  }
})

// POST /ticketing — submit a ticket against an active type (any staff)
router.post('/', async (req, res) => {
  try {
    const { type_id, data = {}, priority, location_id } = req.body || {}
    if (!type_id) return res.status(400).json({ error: 'type_id is required' })
    const type = await getType(type_id)
    if (!type) return res.status(404).json({ error: 'Ticket type not found' })
    if (!type.active) return res.status(400).json({ error: 'This ticket type is inactive' })

    const v = validateSubmission(type.schema || [], data)
    if (!v.ok) return res.status(400).json({ error: 'Validation failed', errors: v.errors })

    const insert = {
      type_id,
      title: renderTitle(type.title_template, type.schema || [], v.cleaned, type.name),
      data: v.cleaned,
      submitter_id: req.staff.id,
      location_id: location_id || null,
    }
    if (['low', 'normal', 'high', 'urgent'].includes(priority)) insert.priority = priority
    const { data: ticket, error } = await supabaseAdmin.from('tickets').insert(insert).select().single()
    if (error) throw error
    res.status(201).json({ ticket })
  } catch (err) {
    console.error('[Ticketing] create ticket failed:', err.message)
    res.status(500).json({ error: 'Failed to submit ticket' })
  }
})

// GET /ticketing/:id — full detail (any staff can view status). Includes
// can_handle so the UI shows edit controls only to handlers of this type.
router.get('/:id', async (req, res) => {
  try {
    const { data: ticket, error } = await supabaseAdmin.from('tickets').select('*').eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' })

    const [type, { data: comments }, { data: attachments }] = await Promise.all([
      getType(ticket.type_id),
      supabaseAdmin.from('ticket_comments').select('*').eq('ticket_id', ticket.id).order('created_at'),
      supabaseAdmin.from('ticket_attachments').select('*').eq('ticket_id', ticket.id).order('created_at'),
    ])
    const names = await nameMap(
      [ticket.submitter_id, ticket.assigned_to]
        .concat((comments || []).map(c => c.author_id))
        .concat((attachments || []).map(a => a.uploaded_by))
    )
    const canHandle = canHandleType(req.staff, type)
    // A regular person can only view tickets they submitted; handlers/admins can
    // view the ones they handle.
    if (!canHandle && ticket.submitter_id !== req.staff.id) {
      return res.status(403).json({ error: 'You can only view tickets you submitted or handle' })
    }
    const signed = await Promise.all((attachments || []).map(a => signAttachment(a.storage_path)))

    res.json({
      ticket: {
        ...ticket,
        type_name: type?.name || 'Ticket',
        submitter_name: names[ticket.submitter_id] || 'Unknown',
        assignee_name: ticket.assigned_to ? (names[ticket.assigned_to] || 'Unknown') : null,
      },
      type: type || null,
      can_handle: canHandle,
      is_submitter: ticket.submitter_id === req.staff.id,
      comments: (comments || []).map(c => ({ ...c, author_name: c.author_id ? (names[c.author_id] || 'Unknown') : 'System' })),
      attachments: (attachments || []).map((a, i) => ({ ...a, uploader_name: names[a.uploaded_by] || 'Unknown', url: signed[i] })),
    })
  } catch (err) {
    console.error('[Ticketing] get ticket failed:', err.message)
    res.status(500).json({ error: 'Failed to load ticket' })
  }
})

// Middleware: load ticket + type and require the caller to be a handler.
async function requireHandler(req, res, next) {
  try {
    const { data: ticket } = await supabaseAdmin.from('tickets').select('*').eq('id', req.params.id).maybeSingle()
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' })
    const type = await getType(ticket.type_id)
    req._ticket = ticket
    req._type = type
    req._canHandle = canHandleType(req.staff, type)
    if (!req._canHandle) return res.status(403).json({ error: 'Only handlers of this ticket type can do that' })
    next()
  } catch (err) {
    console.error('[Ticketing] requireHandler failed:', err.message)
    res.status(500).json({ error: 'Server error' })
  }
}

// PATCH /ticketing/:id — status / priority / assignment (handlers only)
router.patch('/:id', requireHandler, async (req, res) => {
  try {
    const ticket = req._ticket
    const b = req.body || {}
    const patch = {}
    const logs = []
    if (b.status !== undefined) {
      if (!['open', 'in_progress', 'complete', 'closed'].includes(b.status)) return res.status(400).json({ error: 'Invalid status' })
      if (b.status !== ticket.status) {
        patch.status = b.status
        patch.completed_at = b.status === 'complete' ? new Date().toISOString() : (b.status === 'open' || b.status === 'in_progress' ? null : ticket.completed_at)
        logs.push(`Status changed to ${b.status.replace('_', ' ')}`)
      }
    }
    if (b.priority !== undefined && ['low', 'normal', 'high', 'urgent'].includes(b.priority) && b.priority !== ticket.priority) {
      patch.priority = b.priority
      logs.push(`Priority set to ${b.priority}`)
    }
    if (b.assigned_to !== undefined && b.assigned_to !== ticket.assigned_to) {
      patch.assigned_to = b.assigned_to || null
      logs.push(b.assigned_to ? 'Ticket assigned' : 'Ticket unassigned')
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update' })
    const { data: updated, error } = await supabaseAdmin.from('tickets').update(patch).eq('id', ticket.id).select().single()
    if (error) throw error
    for (const body of logs) {
      await supabaseAdmin.from('ticket_comments').insert({ ticket_id: ticket.id, author_id: req.staff.id, body, system: true })
    }
    res.json({ ticket: updated })
  } catch (err) {
    console.error('[Ticketing] update ticket failed:', err.message)
    res.status(500).json({ error: 'Failed to update ticket' })
  }
})

// POST /ticketing/:id/comments — progress note. Handlers or the submitter.
router.post('/:id/comments', async (req, res) => {
  try {
    const body = String(req.body?.body || '').trim()
    if (!body) return res.status(400).json({ error: 'Comment cannot be empty' })
    if (body.length > 5000) return res.status(400).json({ error: 'Comment is too long' })
    const { data: ticket } = await supabaseAdmin.from('tickets').select('*').eq('id', req.params.id).maybeSingle()
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' })
    const type = await getType(ticket.type_id)
    if (!canHandleType(req.staff, type) && ticket.submitter_id !== req.staff.id) {
      return res.status(403).json({ error: 'Only handlers or the submitter can comment' })
    }
    const { data, error } = await supabaseAdmin.from('ticket_comments')
      .insert({ ticket_id: ticket.id, author_id: req.staff.id, body, system: false }).select().single()
    if (error) throw error
    await supabaseAdmin.from('tickets').update({ updated_at: new Date().toISOString() }).eq('id', ticket.id)
    res.status(201).json({ comment: { ...data, author_name: req.staff.display_name || 'You' } })
  } catch (err) {
    console.error('[Ticketing] add comment failed:', err.message)
    res.status(500).json({ error: 'Failed to add comment' })
  }
})

// POST /ticketing/:id/attachments — upload a file. The submitter may attach to
// their own ticket (covers file fields on submit); handlers may attach to any
// ticket they handle. Optional field_id / comment_id tag the file.
router.post('/:id/attachments', uploadSingle, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    const { data: ticket } = await supabaseAdmin.from('tickets').select('*').eq('id', req.params.id).maybeSingle()
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' })
    const type = await getType(ticket.type_id)
    if (!canHandleType(req.staff, type) && ticket.submitter_id !== req.staff.id) {
      return res.status(403).json({ error: 'Not allowed to attach to this ticket' })
    }

    await ensureBucket()
    const safeName = (req.file.originalname || 'file').replace(/[\r\n"/\\]/g, '').slice(0, 200)
    const rand = Math.random().toString(36).slice(2, 8)
    const storagePath = `${ticket.id}/${Date.now()}-${rand}-${safeName}`
    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET)
      .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype || 'application/octet-stream', upsert: false })
    if (upErr) throw upErr

    const { data, error } = await supabaseAdmin.from('ticket_attachments').insert({
      ticket_id: ticket.id,
      comment_id: req.body?.comment_id || null,
      storage_path: storagePath,
      file_name: safeName,
      content_type: req.file.mimetype || null,
      size_bytes: req.file.size || null,
      uploaded_by: req.staff.id,
    }).select().single()
    if (error) throw error
    const url = await signAttachment(storagePath)
    res.status(201).json({ attachment: { ...data, url, uploader_name: req.staff.display_name || 'You' } })
  } catch (err) {
    console.error('[Ticketing] upload attachment failed:', err.message)
    res.status(500).json({ error: 'Failed to upload file' })
  }
})

// GET /ticketing/attachments/:id/url — fresh signed URL for download (any staff)
router.get('/attachments/:id/url', async (req, res) => {
  try {
    const { data: att } = await supabaseAdmin.from('ticket_attachments').select('storage_path').eq('id', req.params.id).maybeSingle()
    if (!att) return res.status(404).json({ error: 'Attachment not found' })
    const url = await signAttachment(att.storage_path)
    if (!url) return res.status(500).json({ error: 'Could not sign URL' })
    res.json({ url })
  } catch (err) {
    console.error('[Ticketing] sign attachment failed:', err.message)
    res.status(500).json({ error: 'Failed to get download link' })
  }
})

module.exports = router

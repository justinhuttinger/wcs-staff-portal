const { Router } = require('express')
const multer = require('multer')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const {
  validateSchema,
  validateSubmission,
  deriveTitle,
  makeSlug,
} = require('../services/ticketingSchema')

const router = Router()
router.use(authenticate)
// Admin-only for now (per rollout plan — mirrors the Forms module). Widen later
// via the RBAC screens / a lower requireRole once other roles are ready.
router.use(requireRole('admin'))

const BUCKET = 'ticket-attachments'
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })

// Create the private bucket on demand. Idempotent: a "already exists" error is
// swallowed so we never need a manual Supabase dashboard step.
let bucketReady = false
async function ensureBucket() {
  if (bucketReady) return
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: '25MB',
  })
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

// Resolve display names for a set of staff ids in one query.
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

// Fresh short-lived signed URL for a stored attachment.
async function signAttachment(path) {
  const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 60 * 60)
  return data?.signedUrl || null
}

// ---------------------------------------------------------------------------
// Ticket types (the "form builder")
// ---------------------------------------------------------------------------

// GET /ticketing/types — all types (admin). ?active=1 restricts to active.
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

// POST /ticketing/types
router.post('/types', async (req, res) => {
  try {
    const { name, description, icon, schema = [], active = true, sort_order = 0 } = req.body || {}
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' })
    const check = validateSchema(schema)
    if (!check.ok) return res.status(400).json({ error: check.error })

    // Unique slug: base off the name, disambiguate with a numeric suffix.
    let slug = makeSlug(name)
    const { data: existing } = await supabaseAdmin.from('ticket_types').select('slug').like('slug', `${slug}%`)
    const taken = new Set((existing || []).map(r => r.slug))
    if (taken.has(slug)) {
      let n = 2
      while (taken.has(`${slug}-${n}`)) n++
      slug = `${slug}-${n}`
    }

    const { data, error } = await supabaseAdmin.from('ticket_types').insert({
      slug,
      name: String(name).trim(),
      description: description ? String(description).trim() : null,
      icon: icon || null,
      schema,
      active: !!active,
      sort_order: Number(sort_order) || 0,
      created_by: req.staff.id,
    }).select().single()
    if (error) throw error
    res.status(201).json({ type: data })
  } catch (err) {
    console.error('[Ticketing] create type failed:', err.message)
    res.status(500).json({ error: 'Failed to create ticket type' })
  }
})

// PATCH /ticketing/types/:id — update fields / toggle active
router.patch('/types/:id', async (req, res) => {
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
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update' })

    const { data, error } = await supabaseAdmin.from('ticket_types')
      .update(patch).eq('id', req.params.id).select().single()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Ticket type not found' })
    res.json({ type: data })
  } catch (err) {
    console.error('[Ticketing] update type failed:', err.message)
    res.status(500).json({ error: 'Failed to update ticket type' })
  }
})

// DELETE /ticketing/types/:id — only when no tickets reference it. Otherwise
// the caller should deactivate instead (preserves history).
router.delete('/types/:id', async (req, res) => {
  try {
    const { count } = await supabaseAdmin.from('tickets')
      .select('id', { count: 'exact', head: true }).eq('type_id', req.params.id)
    if (count && count > 0) {
      return res.status(409).json({ error: `In use by ${count} ticket(s). Deactivate it instead.` })
    }
    const { error } = await supabaseAdmin.from('ticket_types').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    console.error('[Ticketing] delete type failed:', err.message)
    res.status(500).json({ error: 'Failed to delete ticket type' })
  }
})

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

// GET /ticketing — inbox list with filters ?status= &type_id= &q=
router.get('/', async (req, res) => {
  try {
    let q = supabaseAdmin.from('tickets').select('*').order('created_at', { ascending: false }).limit(500)
    if (req.query.status) q = q.eq('status', req.query.status)
    if (req.query.type_id) q = q.eq('type_id', req.query.type_id)
    const { data: tickets, error } = await q
    if (error) throw error
    let rows = tickets || []

    const term = String(req.query.q || '').trim().toLowerCase()
    if (term) rows = rows.filter(t => (t.title || '').toLowerCase().includes(term))

    const typeIds = [...new Set(rows.map(t => t.type_id))]
    const [{ data: types }, names] = await Promise.all([
      typeIds.length ? supabaseAdmin.from('ticket_types').select('id, name, icon').in('id', typeIds) : Promise.resolve({ data: [] }),
      nameMap(rows.map(t => t.submitter_id).concat(rows.map(t => t.assigned_to))),
    ])
    const typeMap = Object.fromEntries((types || []).map(t => [t.id, t]))

    res.json({
      tickets: rows.map(t => ({
        ...t,
        type_name: typeMap[t.type_id]?.name || 'Ticket',
        type_icon: typeMap[t.type_id]?.icon || null,
        submitter_name: names[t.submitter_id] || 'Unknown',
        assignee_name: t.assigned_to ? (names[t.assigned_to] || 'Unknown') : null,
      })),
    })
  } catch (err) {
    console.error('[Ticketing] list tickets failed:', err.message)
    res.status(500).json({ error: 'Failed to load tickets' })
  }
})

// Counts by status for the board header. Kept separate so the list can be
// filtered without losing the totals.
router.get('/summary', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('tickets').select('status')
    if (error) throw error
    const counts = { open: 0, in_progress: 0, complete: 0, closed: 0 }
    for (const r of data || []) if (counts[r.status] !== undefined) counts[r.status]++
    res.json({ counts, total: (data || []).length })
  } catch (err) {
    console.error('[Ticketing] summary failed:', err.message)
    res.status(500).json({ error: 'Failed to load summary' })
  }
})

// POST /ticketing — submit a ticket against an active type
router.post('/', async (req, res) => {
  try {
    const { type_id, data = {}, priority, location_id } = req.body || {}
    if (!type_id) return res.status(400).json({ error: 'type_id is required' })
    const { data: type, error: typeErr } = await supabaseAdmin.from('ticket_types').select('*').eq('id', type_id).maybeSingle()
    if (typeErr) throw typeErr
    if (!type) return res.status(404).json({ error: 'Ticket type not found' })
    if (!type.active) return res.status(400).json({ error: 'This ticket type is inactive' })

    const v = validateSubmission(type.schema || [], data)
    if (!v.ok) return res.status(400).json({ error: 'Validation failed', errors: v.errors })

    const insert = {
      type_id,
      title: deriveTitle(type.schema || [], v.cleaned, type.name),
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

// GET /ticketing/:id — full detail: type schema, comments, attachments
router.get('/:id', async (req, res) => {
  try {
    const { data: ticket, error } = await supabaseAdmin.from('tickets').select('*').eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' })

    const [{ data: type }, { data: comments }, { data: attachments }] = await Promise.all([
      supabaseAdmin.from('ticket_types').select('*').eq('id', ticket.type_id).maybeSingle(),
      supabaseAdmin.from('ticket_comments').select('*').eq('ticket_id', ticket.id).order('created_at'),
      supabaseAdmin.from('ticket_attachments').select('*').eq('ticket_id', ticket.id).order('created_at'),
    ])

    const names = await nameMap(
      [ticket.submitter_id, ticket.assigned_to]
        .concat((comments || []).map(c => c.author_id))
        .concat((attachments || []).map(a => a.uploaded_by))
    )
    const signed = await Promise.all((attachments || []).map(a => signAttachment(a.storage_path)))

    res.json({
      ticket: {
        ...ticket,
        type_name: type?.name || 'Ticket',
        submitter_name: names[ticket.submitter_id] || 'Unknown',
        assignee_name: ticket.assigned_to ? (names[ticket.assigned_to] || 'Unknown') : null,
      },
      type: type || null,
      comments: (comments || []).map(c => ({ ...c, author_name: c.author_id ? (names[c.author_id] || 'Unknown') : 'System' })),
      attachments: (attachments || []).map((a, i) => ({
        ...a,
        uploader_name: names[a.uploaded_by] || 'Unknown',
        url: signed[i],
      })),
    })
  } catch (err) {
    console.error('[Ticketing] get ticket failed:', err.message)
    res.status(500).json({ error: 'Failed to load ticket' })
  }
})

// PATCH /ticketing/:id — status / priority / assignment. Each change is logged
// as a system comment so the timeline reads as an activity log.
router.patch('/:id', async (req, res) => {
  try {
    const { data: ticket, error: getErr } = await supabaseAdmin.from('tickets').select('*').eq('id', req.params.id).maybeSingle()
    if (getErr) throw getErr
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' })

    const b = req.body || {}
    const patch = {}
    const logs = []
    if (b.status !== undefined) {
      if (!['open', 'in_progress', 'complete', 'closed'].includes(b.status)) {
        return res.status(400).json({ error: 'Invalid status' })
      }
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

// POST /ticketing/:id/comments — add a progress note
router.post('/:id/comments', async (req, res) => {
  try {
    const body = String(req.body?.body || '').trim()
    if (!body) return res.status(400).json({ error: 'Comment cannot be empty' })
    if (body.length > 5000) return res.status(400).json({ error: 'Comment is too long' })
    const { data: ticket } = await supabaseAdmin.from('tickets').select('id').eq('id', req.params.id).maybeSingle()
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' })
    const { data, error } = await supabaseAdmin.from('ticket_comments')
      .insert({ ticket_id: ticket.id, author_id: req.staff.id, body, system: false }).select().single()
    if (error) throw error
    // Nudge updated_at so the inbox re-sorts.
    await supabaseAdmin.from('tickets').update({ updated_at: new Date().toISOString() }).eq('id', ticket.id)
    res.status(201).json({ comment: { ...data, author_name: req.staff.display_name || 'You' } })
  } catch (err) {
    console.error('[Ticketing] add comment failed:', err.message)
    res.status(500).json({ error: 'Failed to add comment' })
  }
})

// POST /ticketing/:id/attachments — upload a file to a ticket (multipart).
// Optional ?comment_id ties it to a specific comment.
router.post('/:id/attachments', uploadSingle, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    const { data: ticket } = await supabaseAdmin.from('tickets').select('id').eq('id', req.params.id).maybeSingle()
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' })

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

// GET /ticketing/attachments/:id/url — mint a fresh signed URL for a download
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

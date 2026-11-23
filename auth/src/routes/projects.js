// Projects: the team task tracker. Members (Admin > Projects) see every task,
// create tasks and assign them to any member. Nothing is deleted: tasks are
// marked Skipped and can be restored. Admins manage members and categories.
const { Router } = require('express')
const multer = require('multer')
const crypto = require('crypto')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { isProjectsMember } = require('../services/projects/members')
const { queueTaskEvent } = require('../services/projects/notify')
const { cleanLink, safeFileName } = require('../services/projects/files')
const { cleanTaskInput, statusPatch, cleanAssigneeIds, activityFor, cleanCommentBody, isUuid } = require('../services/projects/taskModel')
const {
  staffName, memberIds, memberList, withAssignees, loadTask, categoryExists, setAssignees, logActivity, createTask,
} = require('../services/projects/store')

const router = Router()

function sendError(res, e) {
  res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 500).json({ error: e.message })
}

async function requireMember(req, res, next) {
  if (await isProjectsMember(req.staff?.id)) return next()
  res.status(403).json({ error: 'Not available' })
}

// Comment / file counts per task, for the list. Best-effort like the history.
async function countByTask(table, onlyActive = false) {
  let q = supabaseAdmin.from(table).select('task_id').limit(50000)
  if (onlyActive) q = q.is('removed_at', null)
  const { data, error } = await q
  if (error) { console.error(`[projects] ${table} counts failed:`, error.message); return new Map() }
  const out = new Map()
  for (const r of data || []) out.set(r.task_id, (out.get(r.task_id) || 0) + 1)
  return out
}

// ---- Admin: members + categories ------------------------------------------

const adminOnly = [authenticate, requireRole('admin')]

router.get('/admin/members', adminOnly, async (req, res) => {
  try {
    const [members, { data: staff, error }] = await Promise.all([
      memberList(),
      supabaseAdmin.from('staff').select('id, email, display_name, first_name, last_name')
        .eq('is_active', true).order('display_name'),
    ])
    if (error) throw error
    const inList = new Set(members.map(m => m.id))
    res.json({
      members,
      candidates: (staff || []).filter(s => !inList.has(s.id))
        .map(s => ({ id: s.id, name: staffName(s), email: s.email })),
    })
  } catch (e) { sendError(res, e) }
})

router.post('/admin/members', adminOnly, async (req, res) => {
  try {
    const staffId = String(req.body?.staff_id || '')
    if (!isUuid(staffId)) return res.status(400).json({ error: 'Pick a staff member' })
    const { error } = await supabaseAdmin.from('project_members')
      .upsert({ staff_id: staffId, added_by: req.staff.id }, { onConflict: 'staff_id', ignoreDuplicates: true })
    if (error) throw error
    res.json({ members: await memberList() })
  } catch (e) { sendError(res, e) }
})

// Removing a member keeps their past assignments (history), but they lose
// the tile and drop out of the assignee picker.
router.delete('/admin/members/:staffId', adminOnly, async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('project_members').delete().eq('staff_id', req.params.staffId)
    if (error) throw error
    res.json({ members: await memberList() })
  } catch (e) { sendError(res, e) }
})

function cleanCategory(body = {}) {
  const out = {}
  if (body.name !== undefined) {
    const name = String(body.name || '').trim().slice(0, 60)
    if (!name) return { error: 'Name is required' }
    out.name = name
  }
  if (body.sort !== undefined) out.sort = Number.isFinite(Number(body.sort)) ? Math.trunc(Number(body.sort)) : 0
  return { out }
}

function categoryError(res, e) {
  if (e.code === '23505') return res.status(409).json({ error: 'A category with that name already exists' })
  sendError(res, e)
}

router.post('/admin/categories', adminOnly, async (req, res) => {
  try {
    const { out, error } = cleanCategory(req.body)
    if (error || !out.name) return res.status(400).json({ error: error || 'Name is required' })
    const { data, error: insErr } = await supabaseAdmin.from('project_categories').insert(out).select('*').single()
    if (insErr) throw insErr
    res.json({ category: data })
  } catch (e) { categoryError(res, e) }
})

router.patch('/admin/categories/:id', adminOnly, async (req, res) => {
  try {
    const { out, error } = cleanCategory(req.body)
    if (error) return res.status(400).json({ error })
    const { data, error: upErr } = await supabaseAdmin.from('project_categories').update(out)
      .eq('id', req.params.id).select('*').maybeSingle()
    if (upErr) throw upErr
    if (!data) return res.status(404).json({ error: 'Not found' })
    res.json({ category: data })
  } catch (e) { categoryError(res, e) }
})

// ---- Members: tasks --------------------------------------------------------

const memberOnly = [authenticate, requireMember]

// Sign-in only: admins who are not members still manage categories in Admin.
router.get('/categories', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('project_categories').select('*').order('sort').order('name')
    if (error) throw error
    res.json({ categories: data || [] })
  } catch (e) { sendError(res, e) }
})

router.get('/tasks', memberOnly, async (req, res) => {
  try {
    const [{ data: tasks, error: tErr }, { data: categories, error: cErr }, members, counts, files] = await Promise.all([
      supabaseAdmin.from('project_tasks').select('*').order('created_at', { ascending: false }).limit(5000),
      supabaseAdmin.from('project_categories').select('*').order('sort').order('name'),
      memberList(),
      countByTask('project_task_comments'),
      countByTask('project_task_files', true),
    ])
    if (tErr) throw tErr
    if (cErr) throw cErr
    const rows = (await withAssignees(tasks || [])).map(t => ({ ...t, comment_count: counts.get(t.id) || 0, file_count: files.get(t.id) || 0 }))
    res.json({ tasks: rows, categories: categories || [], members, me: req.staff.id })
  } catch (e) { sendError(res, e) }
})

router.get('/tasks/:id', memberOnly, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' })
    const task = await loadTask(req.params.id)
    if (!task) return res.status(404).json({ error: 'Not found' })
    res.json({ task })
  } catch (e) { sendError(res, e) }
})

router.post('/tasks', memberOnly, async (req, res) => {
  try {
    res.json({ task: await createTask(req.body || {}, req.staff) })
  } catch (e) { sendError(res, e) }
})

router.patch('/tasks/:id', memberOnly, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' })
    const body = req.body || {}
    const { fields, error } = cleanTaskInput(body, { partial: true })
    if (error) return res.status(400).json({ error })
    if ('category_id' in fields && !(await categoryExists(fields.category_id))) {
      return res.status(400).json({ error: 'Unknown category' })
    }
    const existing = await loadTask(req.params.id)
    if (!existing) return res.status(404).json({ error: 'Not found' })

    // A partial date change is checked against the stored other date.
    const start = 'start_date' in fields ? fields.start_date : existing.start_date
    const due = 'due_date' in fields ? fields.due_date : existing.due_date
    if (start && due && start > due) return res.status(400).json({ error: 'Start date is after the due date' })

    const patch = { ...fields, updated_at: new Date().toISOString() }
    if (body.status !== undefined && body.status !== existing.status) {
      const s = statusPatch(body.status, { actorId: req.staff.id, now: patch.updated_at, reason: body.skip_reason })
      if (s.error) return res.status(400).json({ error: s.error })
      Object.assign(patch, s.patch)
    } else if (body.skip_reason !== undefined && existing.status === 'skipped') {
      patch.skip_reason = String(body.skip_reason || '').trim().slice(0, 500) || null
    }
    if (body.sort_order !== undefined && Number.isFinite(Number(body.sort_order))) {
      patch.sort_order = Number(body.sort_order)
    }

    const { error: upErr } = await supabaseAdmin.from('project_tasks').update(patch).eq('id', existing.id)
    if (upErr) throw upErr
    let diff = { add: [], remove: [] }
    if (body.assignee_ids !== undefined) {
      // Current members, plus anyone already on the task who has since left
      // the members list (so they can stay on it or be taken off).
      const allowed = [...await memberIds(), ...existing.assignees.map(a => a.staff_id)]
      diff = await setAssignees(existing.id, cleanAssigneeIds(body.assignee_ids, allowed), req.staff.id)
    }
    await logActivity(existing.id, req.staff.id, activityFor(existing, patch, diff))
    const task = await loadTask(existing.id)
    res.json({ task })
    if (diff.add.length) queueTaskEvent({ event: 'assigned', task, actor: req.staff, added: diff.add })
    if (patch.status === 'complete' && existing.status !== 'complete') queueTaskEvent({ event: 'complete', task, actor: req.staff })
  } catch (e) { sendError(res, e) }
})

// ---- Members: comments + history -------------------------------------------

async function taskExists(id) {
  if (!isUuid(id)) return false
  const { data } = await supabaseAdmin.from('project_tasks').select('id').eq('id', id).maybeSingle()
  return !!data
}

// Comments and history for one task, each oldest first; the portal merges
// them into one timeline.
router.get('/tasks/:id/thread', memberOnly, async (req, res) => {
  try {
    if (!(await taskExists(req.params.id))) return res.status(404).json({ error: 'Not found' })
    const [{ data: comments, error: cErr }, { data: activity, error: aErr }] = await Promise.all([
      supabaseAdmin.from('project_task_comments').select('*').eq('task_id', req.params.id).order('created_at'),
      supabaseAdmin.from('project_task_activity').select('*').eq('task_id', req.params.id).order('created_at'),
    ])
    if (cErr) throw cErr
    if (aErr) throw aErr
    res.json({ comments: comments || [], activity: activity || [] })
  } catch (e) { sendError(res, e) }
})

// Any member can comment, assigned or not.
router.post('/tasks/:id/comments', memberOnly, async (req, res) => {
  try {
    if (!(await taskExists(req.params.id))) return res.status(404).json({ error: 'Not found' })
    const { body, error } = cleanCommentBody(req.body?.body)
    if (error) return res.status(400).json({ error })
    const { data, error: insErr } = await supabaseAdmin.from('project_task_comments')
      .insert({ task_id: req.params.id, author_id: req.staff.id, body }).select('*').single()
    if (insErr) throw insErr
    res.json({ comment: data })
    // Edits never re-notify; only a new comment does.
    loadTask(req.params.id).then(task => queueTaskEvent({ event: 'comment', task, actor: req.staff, commentBody: body }))
      .catch(e => console.error('[projects] comment notify failed:', e.message))
  } catch (e) { sendError(res, e) }
})

// Authors edit their own comments. There is no delete.
router.patch('/tasks/:id/comments/:commentId', memberOnly, async (req, res) => {
  try {
    if (!isUuid(req.params.commentId)) return res.status(404).json({ error: 'Not found' })
    const { body, error } = cleanCommentBody(req.body?.body)
    if (error) return res.status(400).json({ error })
    const { data, error: upErr } = await supabaseAdmin.from('project_task_comments')
      .update({ body, edited_at: new Date().toISOString() })
      .eq('id', req.params.commentId).eq('task_id', req.params.id).eq('author_id', req.staff.id)
      .select('*').maybeSingle()
    if (upErr) throw upErr
    if (!data) return res.status(404).json({ error: 'Not found' })
    res.json({ comment: data })
  } catch (e) { sendError(res, e) }
})

// ---- Members: files + links ------------------------------------------------

const FILE_BUCKET = 'project-files'
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 10 } })

let fileBucketReady = false
async function ensureFileBucket() {
  if (fileBucketReady) return
  const { error } = await supabaseAdmin.storage.createBucket(FILE_BUCKET, { public: false, fileSizeLimit: '25MB' })
  if (error && !/exist/i.test(error.message || '')) throw error
  fileBucketReady = true
}

function uploadFiles(req, res, next) {
  upload.array('files', 10)(req, res, err => {
    if (!err) return next()
    const tooBig = err.code === 'LIMIT_FILE_SIZE'
    res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'Each file must be 25 MB or less' : 'Upload failed' })
  })
}

async function signFile(path) {
  const { data } = await supabaseAdmin.storage.from(FILE_BUCKET).createSignedUrl(path, 60 * 60)
  return data?.signedUrl || null
}

// Files get a fresh 1-hour URL each time the list is read; links are as-is.
async function withUrls(rows) {
  return Promise.all(rows.map(async f => (f.kind === 'file' ? { ...f, url: await signFile(f.storage_path) } : f)))
}

router.get('/tasks/:id/files', memberOnly, async (req, res) => {
  try {
    if (!(await taskExists(req.params.id))) return res.status(404).json({ error: 'Not found' })
    const { data, error } = await supabaseAdmin.from('project_task_files').select('*')
      .eq('task_id', req.params.id).is('removed_at', null).order('created_at')
    if (error) throw error
    res.json({ files: await withUrls(data || []) })
  } catch (e) { sendError(res, e) }
})

router.post('/tasks/:id/files', memberOnly, uploadFiles, async (req, res) => {
  try {
    if (!(await taskExists(req.params.id))) return res.status(404).json({ error: 'Not found' })
    const files = req.files || []
    if (!files.length) return res.status(400).json({ error: 'Pick a file to upload' })
    await ensureFileBucket()
    const rows = []
    for (const f of files) {
      // multer reads names as latin1; browsers send UTF-8.
      const name = safeFileName(Buffer.from(f.originalname || 'file', 'latin1').toString('utf8'))
      const path = `${req.params.id}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${name}`
      const { error: upErr } = await supabaseAdmin.storage.from(FILE_BUCKET)
        .upload(path, f.buffer, { contentType: f.mimetype || 'application/octet-stream', upsert: false })
      if (upErr) throw upErr
      rows.push({
        task_id: req.params.id, kind: 'file', title: name, storage_path: path,
        content_type: f.mimetype || null, size_bytes: f.size || null, added_by: req.staff.id,
      })
    }
    const { data, error } = await supabaseAdmin.from('project_task_files').insert(rows).select('*')
    if (error) throw error
    await logActivity(req.params.id, req.staff.id,
      (data || []).map(f => ({ kind: 'file_added', detail: { name: f.title, type: 'file' } })))
    res.json({ files: await withUrls(data || []) })
  } catch (e) { sendError(res, e) }
})

router.post('/tasks/:id/links', memberOnly, async (req, res) => {
  try {
    if (!(await taskExists(req.params.id))) return res.status(404).json({ error: 'Not found' })
    const { url, title, error } = cleanLink(req.body || {})
    if (error) return res.status(400).json({ error })
    const { data, error: insErr } = await supabaseAdmin.from('project_task_files')
      .insert({ task_id: req.params.id, kind: 'link', title, url, added_by: req.staff.id }).select('*').single()
    if (insErr) throw insErr
    await logActivity(req.params.id, req.staff.id, [{ kind: 'file_added', detail: { name: title, type: 'link' } }])
    res.json({ file: data })
  } catch (e) { sendError(res, e) }
})

// Remove hides the file or link; the row and the stored bytes are kept.
router.post('/tasks/:id/files/:fileId/remove', memberOnly, async (req, res) => {
  try {
    if (!isUuid(req.params.fileId)) return res.status(404).json({ error: 'Not found' })
    const { data, error } = await supabaseAdmin.from('project_task_files')
      .update({ removed_at: new Date().toISOString(), removed_by: req.staff.id })
      .eq('id', req.params.fileId).eq('task_id', req.params.id).is('removed_at', null)
      .select('*').maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Not found' })
    await logActivity(req.params.id, req.staff.id, [{ kind: 'file_removed', detail: { name: data.title, type: data.kind } }])
    res.json({ ok: true })
  } catch (e) { sendError(res, e) }
})

module.exports = router

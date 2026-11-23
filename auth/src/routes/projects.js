// Projects: the team task tracker. Members (Admin > Projects) see every task,
// create tasks and assign them to any member. Nothing is deleted: tasks are
// marked Skipped and can be restored. Admins manage members and categories.
const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { isProjectsMember } = require('../services/projects/members')
const { cleanTaskInput, statusPatch, cleanAssigneeIds, diffAssignees, isUuid } = require('../services/projects/taskModel')

const router = Router()

function sendError(res, e) {
  res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 500).json({ error: e.message })
}

const staffName = s => s.display_name || [s.first_name, s.last_name].filter(Boolean).join(' ') || s.email

async function requireMember(req, res, next) {
  if (await isProjectsMember(req.staff?.id)) return next()
  res.status(403).json({ error: 'Not available' })
}

async function memberIds() {
  const { data, error } = await supabaseAdmin.from('project_members').select('staff_id')
  if (error) throw error
  return (data || []).map(r => r.staff_id)
}

async function memberList() {
  const ids = await memberIds()
  if (!ids.length) return []
  const { data, error } = await supabaseAdmin.from('staff')
    .select('id, email, display_name, first_name, last_name, is_active').in('id', ids)
  if (error) throw error
  return (data || []).filter(s => s.is_active !== false)
    .map(s => ({ id: s.id, name: staffName(s), email: s.email }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function withAssignees(tasks) {
  const ids = tasks.map(t => t.id)
  const byTask = new Map(ids.map(id => [id, []]))
  if (ids.length) {
    const { data, error } = await supabaseAdmin.from('project_task_assignees')
      .select('task_id, staff_id, assigned_at, assigned_by').in('task_id', ids)
    if (error) throw error
    for (const a of data || []) byTask.get(a.task_id)?.push(a)
  }
  return tasks.map(t => ({ ...t, assignees: byTask.get(t.id) || [] }))
}

async function loadTask(id) {
  const { data, error } = await supabaseAdmin.from('project_tasks').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) return null
  return (await withAssignees([data]))[0]
}

async function categoryExists(id) {
  if (!id) return true
  const { data } = await supabaseAdmin.from('project_categories').select('id').eq('id', id).maybeSingle()
  return !!data
}

// Replace the assignee set; new rows record who assigned them and when.
async function setAssignees(taskId, wantedIds, actorId) {
  const { data: cur, error } = await supabaseAdmin.from('project_task_assignees')
    .select('staff_id').eq('task_id', taskId)
  if (error) throw error
  const { add, remove } = diffAssignees((cur || []).map(r => r.staff_id), wantedIds)
  if (remove.length) {
    const { error: dErr } = await supabaseAdmin.from('project_task_assignees')
      .delete().eq('task_id', taskId).in('staff_id', remove)
    if (dErr) throw dErr
  }
  if (add.length) {
    const { error: iErr } = await supabaseAdmin.from('project_task_assignees')
      .insert(add.map(staff_id => ({ task_id: taskId, staff_id, assigned_by: actorId })))
    if (iErr) throw iErr
  }
  return { add, remove }
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
    const [{ data: tasks, error: tErr }, { data: categories, error: cErr }, members] = await Promise.all([
      supabaseAdmin.from('project_tasks').select('*').order('created_at', { ascending: false }).limit(5000),
      supabaseAdmin.from('project_categories').select('*').order('sort').order('name'),
      memberList(),
    ])
    if (tErr) throw tErr
    if (cErr) throw cErr
    res.json({ tasks: await withAssignees(tasks || []), categories: categories || [], members, me: req.staff.id })
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
    const body = req.body || {}
    const { fields, error } = cleanTaskInput(body)
    if (error) return res.status(400).json({ error })
    if (!(await categoryExists(fields.category_id))) return res.status(400).json({ error: 'Unknown category' })
    let status = {}
    if (body.status !== undefined) {
      const s = statusPatch(body.status, { actorId: req.staff.id, reason: body.skip_reason })
      if (s.error) return res.status(400).json({ error: s.error })
      status = s.patch
    }
    const { data, error: insErr } = await supabaseAdmin.from('project_tasks')
      .insert({ ...fields, ...status, created_by: req.staff.id, sort_order: Date.now() }).select('*').single()
    if (insErr) throw insErr
    const assignees = cleanAssigneeIds(body.assignee_ids, await memberIds())
    if (assignees.length) await setAssignees(data.id, assignees, req.staff.id)
    res.json({ task: await loadTask(data.id) })
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
    if (body.assignee_ids !== undefined) {
      // Current members, plus anyone already on the task who has since left
      // the members list (so they can stay on it or be taken off).
      const allowed = [...await memberIds(), ...existing.assignees.map(a => a.staff_id)]
      await setAssignees(existing.id, cleanAssigneeIds(body.assignee_ids, allowed), req.staff.id)
    }
    res.json({ task: await loadTask(existing.id) })
  } catch (e) { sendError(res, e) }
})

module.exports = router

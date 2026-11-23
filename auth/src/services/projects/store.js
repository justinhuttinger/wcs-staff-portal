// Projects data access shared by the portal routes and the Google Chat app,
// so a task made with /task in Chat goes through exactly the same checks,
// history and Chat notifications as one made in the portal.
const { supabaseAdmin } = require('../supabase')
const { queueTaskEvent } = require('./notify')
const { cleanTaskInput, statusPatch, cleanAssigneeIds, diffAssignees } = require('./taskModel')

const staffName = s => s.display_name || [s.first_name, s.last_name].filter(Boolean).join(' ') || s.email

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

async function categoryList() {
  const { data, error } = await supabaseAdmin.from('project_categories').select('*').order('sort').order('name')
  if (error) throw error
  return data || []
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

// History is best-effort: a failed log line never fails the task write.
async function logActivity(taskId, actorId, rows) {
  if (!rows.length) return
  const { error } = await supabaseAdmin.from('project_task_activity')
    .insert(rows.map(r => ({ task_id: taskId, actor_id: actorId, kind: r.kind, detail: r.detail || {} })))
  if (error) console.error('[projects] activity log failed:', error.message)
}

function badRequest(message) {
  const e = new Error(message)
  e.status = 400
  return e
}

// Create a task as `actor` (a staff row). Throws a 400 error for bad input.
// Assignees outside the members list are dropped. Assignees get their
// "assigned you" Chat DM after the task is saved.
async function createTask(body, actor) {
  const { fields, error } = cleanTaskInput(body || {})
  if (error) throw badRequest(error)
  if (!(await categoryExists(fields.category_id))) throw badRequest('Unknown category')
  let status = {}
  if (body.status !== undefined) {
    const s = statusPatch(body.status, { actorId: actor.id, reason: body.skip_reason })
    if (s.error) throw badRequest(s.error)
    status = s.patch
  }
  const { data, error: insErr } = await supabaseAdmin.from('project_tasks')
    .insert({ ...fields, ...status, created_by: actor.id, sort_order: Date.now() }).select('*').single()
  if (insErr) throw insErr
  const assignees = cleanAssigneeIds(body.assignee_ids, await memberIds())
  if (assignees.length) await setAssignees(data.id, assignees, actor.id)
  await logActivity(data.id, actor.id, [
    { kind: 'created' },
    ...(assignees.length ? [{ kind: 'assigned', detail: { staff_ids: assignees } }] : []),
  ])
  const task = await loadTask(data.id)
  if (assignees.length) queueTaskEvent({ event: 'assigned', task, actor, added: assignees })
  return task
}

module.exports = {
  staffName, memberIds, memberList, withAssignees, loadTask, categoryExists, categoryList,
  setAssignees, logActivity, createTask,
}

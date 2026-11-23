// Pure helpers for Projects tasks: input cleaning, status transitions and
// assignee diffs. No I/O, so they are unit-tested.

const PRIORITIES = ['urgent', 'high', 'medium', 'low']
const STATUSES = ['not_started', 'in_progress', 'complete', 'skipped']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isUuid = v => UUID_RE.test(String(v || ''))
const cleanDate = v => (v && DATE_RE.test(String(v)) ? String(v) : null)

// Returns { fields } or { error }. With partial, only keys present in body
// are returned (PATCH); without, defaults fill the rest (create). Status and
// assignees are handled separately (statusPatch, cleanAssigneeIds).
function cleanTaskInput(body = {}, { partial = false } = {}) {
  const has = k => Object.prototype.hasOwnProperty.call(body, k)
  const fields = {}

  if (!partial || has('title')) {
    const title = String(body.title || '').trim().slice(0, 300)
    if (!title) return { error: 'Title is required' }
    fields.title = title
  }
  if (!partial || has('description')) {
    fields.description = String(body.description || '').trim().slice(0, 20000) || null
  }
  if (!partial || has('priority')) {
    const p = body.priority == null || body.priority === '' ? 'medium' : String(body.priority)
    if (!PRIORITIES.includes(p)) return { error: 'Bad priority' }
    fields.priority = p
  }
  if (!partial || has('start_date')) fields.start_date = cleanDate(body.start_date)
  if (!partial || has('due_date')) fields.due_date = cleanDate(body.due_date)
  if (fields.start_date && fields.due_date && fields.start_date > fields.due_date) {
    return { error: 'Start date is after the due date' }
  }
  if (!partial || has('category_id')) {
    fields.category_id = isUuid(body.category_id) ? String(body.category_id) : null
  }
  return { fields }
}

// The columns to write when status changes. Complete stamps who/when;
// leaving Complete clears them. Skip keeps an optional reason; leaving
// Skipped clears it.
function statusPatch(status, { actorId, now = new Date().toISOString(), reason } = {}) {
  if (!STATUSES.includes(status)) return { error: 'Bad status' }
  const patch = { status, completed_at: null, completed_by: null, skip_reason: null }
  if (status === 'complete') { patch.completed_at = now; patch.completed_by = actorId || null }
  if (status === 'skipped') patch.skip_reason = String(reason || '').trim().slice(0, 500) || null
  return { patch }
}

// Keep only uuids that are current members, de-duplicated, in input order.
function cleanAssigneeIds(list, memberIds) {
  if (!Array.isArray(list)) return []
  const members = new Set(memberIds)
  return [...new Set(list.map(String))].filter(id => isUuid(id) && members.has(id))
}

function diffAssignees(currentIds, nextIds) {
  const cur = new Set(currentIds)
  const next = new Set(nextIds)
  return {
    add: nextIds.filter(id => !cur.has(id)),
    remove: currentIds.filter(id => !next.has(id)),
  }
}

// History rows for one PATCH: what changed between the stored task and the
// patch that was written, plus the assignee diff. Unchanged fields add
// nothing. Description only records that it was edited, not the text.
const TRACKED = ['title', 'priority', 'due_date', 'start_date']
function activityFor(existing, patch, { add = [], remove = [] } = {}) {
  const rows = []
  if (patch.status !== undefined && patch.status !== existing.status) {
    const detail = { from: existing.status, to: patch.status }
    if (patch.status === 'skipped' && patch.skip_reason) detail.reason = patch.skip_reason
    rows.push({ kind: 'status', detail })
  }
  for (const k of TRACKED) {
    if (patch[k] !== undefined && (patch[k] || null) !== (existing[k] || null)) {
      rows.push({ kind: k, detail: { from: existing[k] || null, to: patch[k] || null } })
    }
  }
  if (patch.category_id !== undefined && (patch.category_id || null) !== (existing.category_id || null)) {
    rows.push({ kind: 'category', detail: { from: existing.category_id || null, to: patch.category_id || null } })
  }
  if (patch.description !== undefined && (patch.description || null) !== (existing.description || null)) {
    rows.push({ kind: 'description', detail: {} })
  }
  if (add.length) rows.push({ kind: 'assigned', detail: { staff_ids: add } })
  if (remove.length) rows.push({ kind: 'unassigned', detail: { staff_ids: remove } })
  return rows
}

function cleanCommentBody(body) {
  const text = String(body == null ? '' : body).trim().slice(0, 10000)
  return text ? { body: text } : { error: 'Comment is empty' }
}

module.exports = { cleanTaskInput, statusPatch, cleanAssigneeIds, diffAssignees, activityFor, cleanCommentBody, PRIORITIES, STATUSES, isUuid }

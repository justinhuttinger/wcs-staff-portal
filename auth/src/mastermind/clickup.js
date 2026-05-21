const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2'
const DOCS_API_BASE = 'https://api.clickup.com/api/v3'
const TOKEN = process.env.CLICKUP_API_KEY

async function cuFetch(path, opts = {}) {
  if (!TOKEN) throw new Error('CLICKUP_API_KEY not set')
  const url = path.startsWith('http') ? path : `${CLICKUP_API_BASE}${path}`
  const r = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': TOKEN,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  const text = await r.text()
  let json
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
  if (!r.ok) {
    const err = new Error(`ClickUp ${r.status} ${path}: ${String(text).slice(0, 200)}`)
    err.status = r.status
    err.body = json
    throw err
  }
  return json
}

async function docsFetch(path, opts = {}) {
  if (!TOKEN) throw new Error('CLICKUP_API_KEY not set')
  const url = `${DOCS_API_BASE}${path}`
  const r = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': TOKEN,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  const text = await r.text()
  let json
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
  if (!r.ok) {
    const err = new Error(`ClickUp Docs ${r.status} ${path}: ${String(text).slice(0, 200)}`)
    err.status = r.status
    err.body = json
    throw err
  }
  return json
}

async function getTask(taskId) {
  return cuFetch(`/task/${taskId}?include_subtasks=true&include_markdown_description=true`)
}

async function getTaskComments(taskId) {
  const r = await cuFetch(`/task/${taskId}/comment`)
  return r.comments || []
}

async function postComment(taskId, text) {
  const r = await cuFetch(`/task/${taskId}/comment`, {
    method: 'POST',
    body: JSON.stringify({ comment_text: text, notify_all: false }),
  })
  return r.id || r.hist_id || null
}

async function updateTaskStatus(taskId, status) {
  return cuFetch(`/task/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  })
}

async function clearCustomField(taskId, fieldId) {
  return cuFetch(`/task/${taskId}/field/${fieldId}`, { method: 'DELETE' })
}

async function setCustomField(taskId, fieldId, value) {
  return cuFetch(`/task/${taskId}/field/${fieldId}`, {
    method: 'POST',
    body: JSON.stringify({ value }),
  })
}

// Set a custom field by NAME by inspecting the task's custom_fields array.
// Returns true if field was found and set, false otherwise.
async function setFieldByName(task, name, value) {
  const fields = task?.custom_fields || []
  const f = fields.find(x => x?.name === name)
  if (!f?.id) return false
  // For dropdown fields, find the option ID matching value (case-insensitive)
  if (f.type === 'drop_down' && f.type_config?.options) {
    const target = String(value || '').toLowerCase().trim()
    const opt = f.type_config.options.find(o => String(o?.name || '').toLowerCase().trim() === target)
    if (opt) {
      await setCustomField(task.id, f.id, opt.id)
      return true
    }
    return false
  }
  await setCustomField(task.id, f.id, value)
  return true
}

async function updateTaskDescription(taskId, description) {
  return cuFetch(`/task/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify({ description }),
  })
}

async function moveTaskToList(taskId, listId) {
  return cuFetch(`/list/${listId}/task/${taskId}`, { method: 'POST' })
}

async function createSubtask(parentTaskId, listId, { name, description }) {
  return cuFetch(`/list/${listId}/task`, {
    method: 'POST',
    body: JSON.stringify({ name, description, parent: parentTaskId }),
  })
}

async function createTask(listId, { name, description }) {
  return cuFetch(`/list/${listId}/task`, {
    method: 'POST',
    body: JSON.stringify({ name, description: description || '' }),
  })
}

async function createList(folderId, { name, statuses, content }) {
  const body = { name, content: content || '' }
  if (Array.isArray(statuses) && statuses.length > 0) body.statuses = statuses
  return cuFetch(`/folder/${folderId}/list`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// Tasks in Multiple Lists: adds an existing task to an additional list.
// Requires the "Tasks in Multiple Lists" ClickApp enabled (Business+ plan).
async function addTaskToList(listId, taskId) {
  return cuFetch(`/list/${listId}/task/${taskId}`, { method: 'POST' })
}

async function createDoc(workspaceId, parentTaskId, { name, content }) {
  if (!workspaceId) throw new Error('CLICKUP_WORKSPACE_ID required for createDoc')
  // Docs API v3
  const doc = await docsFetch(`/workspaces/${workspaceId}/docs`, {
    method: 'POST',
    body: JSON.stringify({
      name,
      parent: { id: parentTaskId, type: 6 }, // 6 = task
      visibility: 'PRIVATE',
      create_page: true,
    }),
  })
  if (doc?.id && doc?.pages?.[0]?.id && content) {
    await docsFetch(`/workspaces/${workspaceId}/docs/${doc.id}/pages/${doc.pages[0].id}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    })
  }
  return doc
}

module.exports = {
  cuFetch,
  getTask,
  getTaskComments,
  postComment,
  updateTaskStatus,
  updateTaskDescription,
  moveTaskToList,
  clearCustomField,
  setCustomField,
  setFieldByName,
  createSubtask,
  createTask,
  addTaskToList,
  createList,
  createDoc,
}

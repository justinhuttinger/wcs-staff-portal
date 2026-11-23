// The Projects Chat app's cards and event parsing (Google Workspace add-on
// format). Pure, so it is unit-tested. Google's docs leave a few paths
// unstated, so readers below accept every shape the docs show.

const TASK_COMMAND_ID = 1 // /task, configured in the Chat API console
const PRIORITY_ITEMS = [
  { text: 'Urgent', value: 'urgent' },
  { text: 'High', value: 'high' },
  { text: 'Medium', value: 'medium' },
  { text: 'Low', value: 'low' },
]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// What kind of event this is.
//   submit  - the dialog's Create button (actionName=createTask)
//   command - a slash command (with its id)
//   message - a plain message to the app, or the app added to a space
//   other   - anything else (answered with an empty response)
function eventKind(body = {}) {
  const chat = body.chat || {}
  const params = formParams(body)
  if (params.actionName === 'createTask') return { kind: 'submit' }
  const cmd = chat.appCommandPayload
  if (cmd) return { kind: 'command', id: Number(cmd.appCommandMetadata?.appCommandId) || null }
  if (chat.messagePayload || chat.addedToSpacePayload) return { kind: 'message' }
  return { kind: 'other' }
}

function formParams(body = {}) {
  return (body.commonEventObject || body.common || {}).parameters || {}
}

// The person acting: their Google Workspace email, lower-cased.
function actorEmail(body = {}) {
  const chat = body.chat || {}
  const email = chat.user?.email
    || chat.appCommandPayload?.message?.sender?.email
    || chat.messagePayload?.message?.sender?.email
    || body.user?.email
  return email ? String(email).trim().toLowerCase() : null
}

// DATE_ONLY pickers send midnight UTC of the chosen day.
function dateFromMs(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return null
  return new Date(n).toISOString().slice(0, 10)
}

function msFromDate(day) {
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T00:00:00Z`) : null
}

// Form values from a dialog submit, as the portal's task body.
function readTaskForm(body = {}) {
  const inputs = (body.commonEventObject || body.common || {}).formInputs || {}
  const strings = name => inputs[name]?.stringInputs?.value || []
  const one = name => (strings(name)[0] ?? '').toString()
  const category = one('category')
  return {
    title: one('title').trim(),
    description: one('description').trim(),
    assignee_ids: strings('assignees').map(String).filter(Boolean),
    priority: one('priority') || 'medium',
    category_id: category && category !== 'none' ? category : null,
    due_date: dateFromMs(inputs.due_date?.dateInput?.msSinceEpoch),
  }
}

// The /task dialog. `values` pre-fills it (after a validation error);
// `error` shows a red line at the top.
function taskDialogCard({ members = [], categories = [], actorId, values = {}, error, endpoint }) {
  const picked = new Set(values.assignee_ids || (actorId ? [actorId] : []))
  const widgets = []
  if (error) widgets.push({ textParagraph: { text: `<font color="#d93025"><b>${escapeHtml(error)}</b></font>` } })
  widgets.push(
    { textInput: { name: 'title', label: 'Title', type: 'SINGLE_LINE', value: values.title || '' } },
    { textInput: { name: 'description', label: 'Description (optional)', type: 'MULTIPLE_LINE', value: values.description || '' } },
    {
      selectionInput: {
        name: 'assignees', label: 'Assigned to', type: 'MULTI_SELECT',
        multiSelectMaxSelectedItems: Math.max(1, members.length),
        items: members.map(m => ({ text: m.name, value: m.id, selected: picked.has(m.id) })),
      },
    },
    {
      selectionInput: {
        name: 'priority', label: 'Priority', type: 'DROPDOWN',
        items: PRIORITY_ITEMS.map(p => ({ ...p, selected: p.value === (values.priority || 'medium') })),
      },
    },
    {
      selectionInput: {
        name: 'category', label: 'Category', type: 'DROPDOWN',
        items: [
          { text: 'No category', value: 'none', selected: !values.category_id },
          ...categories.map(c => ({ text: c.name, value: c.id, selected: c.id === values.category_id })),
        ],
      },
    },
    {
      dateTimePicker: {
        name: 'due_date', label: 'Due date (optional)', type: 'DATE_ONLY',
        ...(msFromDate(values.due_date) ? { valueMsEpoch: String(msFromDate(values.due_date)) } : {}),
      },
    },
    {
      buttonList: {
        buttons: [{
          text: 'Create task',
          onClick: { action: { function: endpoint, parameters: [{ key: 'actionName', value: 'createTask' }] } },
        }],
      },
    },
  )
  return { header: { title: 'New task', subtitle: 'WCS Projects' }, sections: [{ widgets }] }
}

function noticeCard(title, text) {
  return { header: { title }, sections: [{ widgets: [{ textParagraph: { text: escapeHtml(text) } }] }] }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Responses.
const openDialog = card => ({ action: { navigations: [{ pushCard: card }] } })
const updateDialog = card => ({ action: { navigations: [{ updateCard: card }] } })
const closeDialog = text => ({ action: { navigations: [{ endNavigation: { action: 'CLOSE_DIALOG' } }], notification: { text } } })
const replyText = text => ({ hostAppDataAction: { chatDataAction: { createMessageAction: { message: { text } } } } })

// "Created "Order mats" · assigned to Jon, Paige · due Dec 5"
function createdSummary(task, nameOf) {
  const who = (task.assignees || []).map(a => nameOf(a.staff_id))
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(task.due_date || '')
  const bits = [
    `Created "${task.title}"`,
    who.length ? `assigned to ${who.join(', ')}` : 'unassigned',
    m ? `due ${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : null,
  ].filter(Boolean)
  return bits.join(' · ')
}

module.exports = {
  TASK_COMMAND_ID, eventKind, actorEmail, readTaskForm, dateFromMs, taskDialogCard, noticeCard,
  openDialog, updateDialog, closeDialog, replyText, createdSummary,
}

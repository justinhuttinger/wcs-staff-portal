const test = require('node:test')
const assert = require('node:assert/strict')
const {
  eventKind, actorEmail, readTaskForm, dateFromMs, taskDialogCard, openDialog, closeDialog, createdSummary,
} = require('../src/services/projects/chatCards')

const ENDPOINT = 'https://api.example.com/projects-chat/events'

test('eventKind: slash command, dialog submit, message, other', () => {
  assert.deepEqual(eventKind({ chat: { appCommandPayload: { appCommandMetadata: { appCommandId: 1, appCommandType: 'SLASH_COMMAND' } } } }), { kind: 'command', id: 1 })
  assert.deepEqual(eventKind({ chat: { buttonClickedPayload: {} }, commonEventObject: { parameters: { actionName: 'createTask' } } }), { kind: 'submit' })
  assert.deepEqual(eventKind({ common: { parameters: { actionName: 'createTask' } } }), { kind: 'submit' })
  assert.deepEqual(eventKind({ chat: { messagePayload: { message: { text: 'hi' } } } }), { kind: 'message' })
  assert.deepEqual(eventKind({ chat: { addedToSpacePayload: {} } }), { kind: 'message' })
  assert.deepEqual(eventKind({}), { kind: 'other' })
})

test('actorEmail prefers chat.user, falls back to the message sender, lower-cases', () => {
  assert.equal(actorEmail({ chat: { user: { email: 'Justin@Example.com' } } }), 'justin@example.com')
  assert.equal(actorEmail({ chat: { appCommandPayload: { message: { sender: { email: 'a@b.com' } } } } }), 'a@b.com')
  assert.equal(actorEmail({}), null)
})

test('readTaskForm maps text, multi-select, dropdowns and the date', () => {
  const body = { commonEventObject: { formInputs: {
    title: { stringInputs: { value: ['  Order mats  '] } },
    description: { stringInputs: { value: ['Free-weight area'] } },
    assignees: { stringInputs: { value: ['u1', 'u4'] } },
    priority: { stringInputs: { value: ['urgent'] } },
    category: { stringInputs: { value: ['none'] } },
    due_date: { dateInput: { msSinceEpoch: Date.UTC(2026, 11, 5) } },
  } } }
  assert.deepEqual(readTaskForm(body), {
    title: 'Order mats', description: 'Free-weight area', assignee_ids: ['u1', 'u4'],
    priority: 'urgent', category_id: null, due_date: '2026-12-05',
  })
  assert.deepEqual(readTaskForm({}), { title: '', description: '', assignee_ids: [], priority: 'medium', category_id: null, due_date: null })
})

test('dateFromMs: midnight UTC becomes that day; junk is null', () => {
  assert.equal(dateFromMs(Date.UTC(2027, 0, 1)), '2027-01-01')
  assert.equal(dateFromMs('nope'), null)
})

test('the dialog pre-selects the actor, offers members and categories, and posts back to the endpoint', () => {
  const card = taskDialogCard({
    members: [{ id: 'u1', name: 'Justin' }, { id: 'u2', name: 'Alex' }],
    categories: [{ id: 'c1', name: 'Marketing' }], actorId: 'u1', endpoint: ENDPOINT,
  })
  const w = card.sections[0].widgets
  const assignees = w.find(x => x.selectionInput?.name === 'assignees').selectionInput
  assert.equal(assignees.type, 'MULTI_SELECT')
  assert.deepEqual(assignees.items.map(i => [i.value, i.selected]), [['u1', true], ['u2', false]])
  assert.equal(w.find(x => x.selectionInput?.name === 'priority').selectionInput.items.find(i => i.selected).value, 'medium')
  assert.deepEqual(w.find(x => x.selectionInput?.name === 'category').selectionInput.items.map(i => i.value), ['none', 'c1'])
  const btn = w.find(x => x.buttonList).buttonList.buttons[0]
  assert.equal(btn.onClick.action.function, ENDPOINT)
  assert.deepEqual(btn.onClick.action.parameters, [{ key: 'actionName', value: 'createTask' }])
  assert.deepEqual(openDialog(card).action.navigations[0].pushCard, card)
})

test('after an error the dialog keeps what was typed and shows the message', () => {
  const card = taskDialogCard({ members: [{ id: 'u1', name: 'J' }], values: { title: 'x', priority: 'low', due_date: '2026-12-05', assignee_ids: [] }, error: 'Add a <title>', endpoint: ENDPOINT })
  const w = card.sections[0].widgets
  assert.match(w[0].textParagraph.text, /Add a &lt;title&gt;/)
  assert.equal(w.find(x => x.textInput?.name === 'title').textInput.value, 'x')
  assert.equal(w.find(x => x.dateTimePicker).dateTimePicker.valueMsEpoch, String(Date.UTC(2026, 11, 5)))
  assert.equal(w.find(x => x.selectionInput?.name === 'assignees').selectionInput.items[0].selected, false)
})

test('closeDialog and the created summary', () => {
  assert.deepEqual(closeDialog('Done'), { action: { navigations: [{ endNavigation: { action: 'CLOSE_DIALOG' } }], notification: { text: 'Done' } } })
  const names = { u1: 'Jon', u2: 'Paige' }
  assert.equal(createdSummary({ title: 'Order mats', due_date: '2026-12-05', assignees: [{ staff_id: 'u1' }, { staff_id: 'u2' }] }, id => names[id]),
    'Created "Order mats" · assigned to Jon, Paige · due Dec 5')
  assert.equal(createdSummary({ title: 'X', assignees: [] }, () => ''), 'Created "X" · unassigned')
})

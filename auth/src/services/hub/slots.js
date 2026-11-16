// Deliverable slots for Hub tasks: one slot per club per deliverable (one
// club-less slot when the task has no clubs), what each kind accepts, and the
// checks behind the no-login upload link. Pure or db-injected; unit-tested.
const crypto = require('crypto')

// Which club slots to add and which to remove for a task's club list. A slot
// that already holds something is never removed.
function planSlots(clubs, existing) {
  const target = clubs.length ? clubs : [null]
  const have = new Set(existing.map(s => s.club ?? null))
  const add = target.filter(c => !have.has(c))
  const remove = existing.filter(s => !s.filled && !target.includes(s.club ?? null)).map(s => s.club ?? null)
  return { add, remove }
}

function kindAccepts(kind, mime) {
  if (kind === 'image') return /^image\//.test(String(mime || ''))
  if (kind === 'file') return true
  return false
}

function newUploadToken() {
  return crypto.randomBytes(24).toString('base64url')
}

function fail(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

// db: getToken(token) -> {person_id}|null, getPerson(id) -> {id, task_id}|null,
// getTask(id) -> {id, status}|null, getSlot(id) -> {id, club, deliverable:{person_id, task_id, kind, name}}|null
async function validateUploadTarget({ db, token, slotId }) {
  const tok = token ? await db.getToken(token) : null
  if (!tok) throw fail(404, 'This link is not valid')
  const person = await db.getPerson(tok.person_id)
  if (!person) throw fail(404, 'This link is not valid')
  const task = await db.getTask(person.task_id)
  if (!task) throw fail(404, 'This link is not valid')
  if (task.status === 'done' || task.status === 'dropped') throw fail(410, 'This request is closed')
  if (slotId === undefined) return { person, task }
  const slot = await db.getSlot(slotId)
  if (!slot) throw fail(404, 'Not found')
  if (slot.deliverable.person_id !== person.id || slot.deliverable.task_id !== task.id) throw fail(403, 'Not yours to fill')
  return { person, task, slot }
}

function slotLabel(deliverable, club, clubNames) {
  if (!club) return deliverable.name
  return `${clubNames[club] || club} ${deliverable.name}`
}

function allFilled(slots) {
  return slots.length > 0 && slots.every(s => s.filled)
}

// Claude is asked to put the upload link in; if it didn't, add it at the end.
function withUploadLink(body, url) {
  if (!url || String(body).includes(url)) return body
  return `${String(body).trimEnd()}

Upload here: ${url}`
}

module.exports = { planSlots, kindAccepts, newUploadToken, validateUploadTarget, slotLabel, allFilled, withUploadLink }

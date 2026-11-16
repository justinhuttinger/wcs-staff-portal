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
// getTask(id) -> {id, status}|null, getSlot(id) -> {id, club, person_id, deliverable:{task_id, kind, name}}|null
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
  // Each club's slot has its own owner.
  if (slot.person_id !== person.id || slot.deliverable.task_id !== task.id) throw fail(403, 'Not yours to fill')
  return { person, task, slot }
}

// The person on a task who covers a club: the first added wins. A club-less
// slot has no automatic owner (it is assigned by hand).
function ownerForClub(club, people) {
  if (!club) return null
  const covering = people.filter(p => (p.clubs || []).includes(club))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  return covering.length ? covering[0].id : null
}

// Owner updates so every automatic club slot belongs to the person covering
// its club (unassigned when nobody does). Slots set by hand (owner_manual) and
// club-less slots are never changed here.
function planOwners(slots, people) {
  const out = []
  for (const s of slots) {
    if (s.owner_manual || !s.club) continue
    const owner = ownerForClub(s.club, people)
    if ((s.person_id || null) !== owner) out.push({ id: s.id, person_id: owner })
  }
  return out
}

// A saved person's clubs as they apply to one task: only the task's clubs,
// or all of theirs when the task has none.
function personClubsFor(contactClubs, taskClubs) {
  const mine = Array.isArray(contactClubs) ? contactClubs : []
  if (!taskClubs || !taskClubs.length) return [...mine]
  return mine.filter(c => taskClubs.includes(c))
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

// Express middleware: check the token, task and slot BEFORE the upload body
// is read, so a bad link can't make the server buffer a 25 MB file.
function preValidate(validate) {
  return async (req, res, next) => {
    try {
      req.uploadTarget = await validate({ token: req.params.token, slotId: req.params.slotId })
      next()
    } catch (e) {
      res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 500).json({ error: e.status ? e.message : 'Something went wrong, please try again' })
    }
  }
}

function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

module.exports = { personClubsFor, ownerForClub, planOwners, preValidate, chunk, planSlots, kindAccepts, newUploadToken, validateUploadTarget, slotLabel, allFilled, withUploadLink }

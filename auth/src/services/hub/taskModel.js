// Pure helpers for Hub tasks: input cleaning and the list-row signal
// (needs review / waiting N days / all in). No I/O, so they are unit-tested.

const PRIORITIES = ['high', 'medium', 'low']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const SLUG_RE = /^[a-z0-9-]{2,40}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY_MS = 24 * 60 * 60 * 1000
// Plan my week: optional override of Claude's block estimate, in minutes.
const TIME_NEEDED = [30, 60, 90, 120, 180]

// Returns { fields } or { error }. With partial, only keys present in body
// are returned (for PATCH); without, defaults fill the rest (for create).
function cleanTaskInput(body = {}, { partial = false } = {}) {
  const has = k => Object.prototype.hasOwnProperty.call(body, k)
  const fields = {}

  if (!partial || has('title')) {
    const title = String(body.title || '').trim().slice(0, 300)
    if (!title) return { error: 'Title is required' }
    fields.title = title
  }
  if (!partial || has('description')) {
    fields.description = String(body.description || '').trim().slice(0, 10000) || null
  }
  if (!partial || has('priority')) {
    const p = body.priority == null || body.priority === '' ? 'medium' : String(body.priority)
    if (!PRIORITIES.includes(p)) return { error: 'Bad priority' }
    fields.priority = p
  }
  if (!partial || has('due_date')) {
    fields.due_date = body.due_date && DATE_RE.test(String(body.due_date)) ? String(body.due_date) : null
  }
  if (!partial || has('clubs')) {
    const list = Array.isArray(body.clubs) ? body.clubs : []
    fields.clubs = [...new Set(list.map(String).filter(s => SLUG_RE.test(s)))]
  }
  if (!partial || has('category_id')) {
    fields.category_id = body.category_id && UUID_RE.test(String(body.category_id)) ? String(body.category_id) : null
  }
  if (!partial || has('minutes_override')) {
    const v = body.minutes_override
    if (v == null || v === '') fields.minutes_override = null
    else if (TIME_NEEDED.includes(Number(v))) fields.minutes_override = Number(v)
    else return { error: 'Bad time needed' }
  }
  return { fields }
}

function rowSignal(task, people = [], { allIn = false, newItems = 0 } = {}) {
  const needsReview = newItems > 0 || people.some(p => p.state === 'replied' && !p.reply_seen)
  const sends = people
    .filter(p => p.state === 'waiting' && p.last_sent_at)
    .map(p => new Date(p.last_sent_at).getTime())
  const waitingDays = sends.length ? Math.floor((Date.now() - Math.min(...sends)) / DAY_MS) : null
  return { needsReview, waitingDays, allIn }
}

// Person columns returned with tasks (subject is needed for "Re:" on nudges).
const PERSON_LIST_COLS = 'id, task_id, contact_id, clubs, name, email, state, subject, gmail_thread_id, first_message_id_header, last_sent_at, last_reply_at, last_reply_snippet, reply_seen, created_at'

module.exports = { cleanTaskInput, rowSignal, PRIORITIES, PERSON_LIST_COLS }

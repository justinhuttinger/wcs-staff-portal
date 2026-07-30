// All ABC HTTP for Group X lives here. No Express, no Supabase — the shaping
// functions are pure and unit-tested, the network functions are thin.
//
// Verified live against the production ABC API 2026-07-30:
//   GET  /{club}/calendars/eventtypes   -> 21 types/club, 6 with category "class"
//   GET  /{club}/employees              -> employment.departments.department[]
//   GET  /{club}/calendars/events       -> both future ("Pending") and past
//                                          ("Completed") when no eventStatus filter
//   POST /{club}/calendars/events       -> create (no member required for a class)
//   DELETE /{club}/calendars/events/{id}
// Uses native fetch, matching the rest of the ABC services (abcEmployeeRoster,
// abcInventory, ...). Only the legacy abcScheduler.js uses axios, which is not
// even declared in auth/package.json.
const { parseAbcTs, padDate } = require('../lib/abcTime')
const { isKnownClubNumber } = require('../lib/groupXClubs')
const cache = require('./memoryCache')

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest'

// Instructors come from these ABC departments, in this order. Only 1-2 staff
// per club are tagged "Group Exercise" today, so Personal Trainers keeps the
// dropdown usable until that is fixed on the ABC side.
const GX_DEPARTMENTS = ['Group Exercise', 'Personal Trainers']

// ABC club rosters carry integration and placeholder accounts that are tagged
// into real departments. "ABC SUPPORT" shows up under Personal Trainers at
// Salem. Mirrors EMPLOYEE_EXCLUDED_NAMES in routes/abcScheduler.js.
const EXCLUDED_NAMES = new Set([
  'easalytics bot', 'click2save bot', 'reporting bot',
  'abc support', 'test test', 'personal trainer',
])

const TYPES_TTL_MS = 60 * 60 * 1000
const EMPLOYEES_TTL_MS = 60 * 60 * 1000

function abcHeaders() {
  // Read at call time, not module load: tests and scripts load dotenv after
  // require().
  const appId = process.env.ABC_APP_ID
  const appKey = process.env.ABC_APP_KEY
  if (!appId || !appKey) throw new Error('ABC_APP_ID and ABC_APP_KEY must be set')
  return { app_id: appId, app_key: appKey, Accept: 'application/json' }
}

function assertClub(clubNumber) {
  if (!isKnownClubNumber(clubNumber)) throw new Error(`Unknown club number: ${clubNumber}`)
}

// GET returning parsed JSON, throwing on a non-2xx. `params` is a plain object.
async function abcGet(path, params, timeoutMs = 30000) {
  const qs = new URLSearchParams(params || {}).toString()
  const url = `${ABC_BASE_URL}${path}${qs ? `?${qs}` : ''}`
  const res = await fetch(url, {
    headers: abcHeaders(),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`ABC API HTTP ${res.status} for ${path}`)
  return res.json()
}

// Mutating call that reports failure as a value rather than throwing, so a
// series fan-out can record per-occurrence outcomes and keep going.
async function abcMutate(method, path, body, timeoutMs = 30000) {
  const res = await fetch(`${ABC_BASE_URL}${path}`, {
    method,
    headers: body
      ? { ...abcHeaders(), 'Content-Type': 'application/json' }
      : abcHeaders(),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  })
  let data = null
  try { data = await res.json() } catch { /* empty or non-JSON body is fine */ }
  if (!res.ok) {
    console.error(`[abcGroupX] ${method} ${path} failed:`, res.status, JSON.stringify(data))
    return {
      ok: false,
      http: res.status,
      data,
      error: data?.status?.message || data?.message || `HTTP ${res.status}`,
    }
  }
  // A 200 is not success on its own. ABC reports write failures (missing member,
  // event type not online, unknown training level) inside a 200 body. Treating
  // that as success would tell staff a class was created when it was not.
  const bodyErr = _abcBodyError(data)
  if (bodyErr) {
    console.error(`[abcGroupX] ${method} ${path} rejected:`, bodyErr.code, bodyErr.message)
    return {
      ok: false,
      http: res.status,
      data,
      error: `${bodyErr.code}: ${bodyErr.message}`,
    }
  }
  return { ok: true, http: res.status, data, error: null }
}

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = parseInt(v, 10)
  return Number.isNaN(n) ? null : n
}

// ABC pads names with stray double spaces. Always rebuild from first/last.
function joinName(first, last) {
  return [first, last].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

function _shapeClassType(raw) {
  return {
    event_type_id: raw.eventTypeId,
    name: raw.name,
    description: raw.description || null,
    duration_minutes: num(raw.duration),
    max_attendees: num(raw.maxAttendees),
    training_levels: (raw.eventTrainingLevels || []).map(l => ({
      level_id: l.levelId,
      level_name: l.levelName,
    })),
  }
}

function _shapeInstructor(raw) {
  const depts = raw.employment?.departments?.department || []
  return {
    employee_id: raw.employeeId,
    first_name: raw.personal?.firstName || '',
    last_name: raw.personal?.lastName || '',
    display_name: joinName(raw.personal?.firstName, raw.personal?.lastName) || 'Unknown',
    department: depts.find(d => GX_DEPARTMENTS.includes(d)) || depts[0] || null,
  }
}

function _shapeClassEvent(raw) {
  const ts = parseAbcTs(raw.eventTimestamp)
  // ABC represents an open/unassigned class slot with the literal employee name
  // "Unbooked Unbooked". Real observed data at Salem. Surface it as no
  // instructor rather than printing "Unbooked U." on a TV in the gym.
  const rawName = joinName(raw.employeeFirstName, raw.employeeLastName)
  const instructor = /^unbooked\b/i.test(rawName) ? null : (rawName || null)
  return {
    event_id: raw.eventId,
    event_type_id: raw.eventTypeId || null,
    class_name: raw.eventName || null,
    event_timestamp: ts.utc,
    event_timestamp_local: ts.local,
    status: raw.status || null,
    duration_minutes: num(raw.duration),
    max_attendees: num(raw.maxAttendees),
    employee_id: raw.employeeId || null,
    instructor_name: instructor,
    unbooked: instructor === null,
  }
}

// A successful create does not return the event object. It returns a link:
//   { result: { links: [{ rel: 'events', href: '/rest/30935/calendars/events/<id>' }] } }
// The new event id is the last path segment.
function _createdEventId(body) {
  const links = body?.result?.links || []
  const href = (links.find(l => l.rel === 'events') || links[0] || {}).href
  if (!href) return null
  const id = String(href).split('/').filter(Boolean).pop()
  return id || null
}

async function listClassTypes(clubNumber) {
  assertClub(clubNumber)
  return cache.wrap(`gx:types:${clubNumber}`, TYPES_TTL_MS, async () => {
    const body = await abcGet(`/${clubNumber}/calendars/eventtypes`, null, 20000)
    return (body?.eventTypes || [])
      // /calendars/eventtypes says "class"; /calendars/events says "Class".
      .filter(t => String(t.category || '').toLowerCase() === 'class')
      .map(_shapeClassType)
      .sort((a, b) => a.name.localeCompare(b.name))
  })
}

async function listInstructors(clubNumber) {
  assertClub(clubNumber)
  return cache.wrap(`gx:instructors:${clubNumber}`, EMPLOYEES_TTL_MS, async () => {
    const body = await abcGet(`/${clubNumber}/employees`, null, 20000)
    return (body?.employees || [])
      .filter(e => String(e.employment?.employeeStatus || '').toLowerCase() === 'active')
      .map(_shapeInstructor)
      .filter(e => e.employee_id && GX_DEPARTMENTS.includes(e.department))
      .filter(e => !EXCLUDED_NAMES.has(e.display_name.toLowerCase()))
      .sort((a, b) => {
        const d = GX_DEPARTMENTS.indexOf(a.department) - GX_DEPARTMENTS.indexOf(b.department)
        return d !== 0 ? d : a.display_name.localeCompare(b.display_name)
      })
  })
}

// ABC rejects an eventDateRange wider than 31 days with
// API-CAL-EVT-0017, and does it as an HTTP 200 carrying an error in the body.
// We pad the range +/-1 day for the Pacific/UTC edge, so cap our own windows
// below 31 to leave room for that padding.
const MAX_RANGE_DAYS = 28

// Splits an inclusive date range into windows of at most MAX_RANGE_DAYS days.
function _chunkDateRange(startDate, endDate, maxDays = MAX_RANGE_DAYS) {
  const out = []
  let cursor = startDate
  while (cursor <= endDate) {
    const tentative = padDate(cursor, maxDays - 1)
    const chunkEnd = tentative > endDate ? endDate : tentative
    out.push({ start: cursor, end: chunkEnd })
    if (chunkEnd >= endDate) break
    cursor = padDate(chunkEnd, 1)
  }
  return out
}

// ABC signals success with messageCode API-CAL-EVT-0000 and reports failures
// as an HTTP 200 carrying the error in the body. Reads that ignore this turn a
// failed fetch into an empty calendar; writes that ignore it report a create
// that never happened as a success.
const ABC_OK_CODE = 'API-CAL-EVT-0000'

function _abcBodyError(body) {
  const code = body?.status?.messageCode
  if (!code || code === ABC_OK_CODE) return null
  return { code, message: (body.status.message || '').trim() }
}

function _assertAbcOk(body, context) {
  const err = _abcBodyError(body)
  if (err) throw new Error(`ABC ${err.code}: ${err.message} (${context})`)
}

async function _fetchClassWindow(clubNumber, start, end) {
  // No eventStatus filter: that is what makes future "Pending" classes visible.
  // Widen by a day each side: ABC reads eventDateRange as club-local Pacific
  // while we reason in UTC. Trimmed back by the caller.
  const body = await abcGet(`/${clubNumber}/calendars/events`, {
    eventDateRange: `${padDate(start, -1)},${padDate(end, 1)}`,
    size: 500,
  })
  _assertAbcOk(body, `${clubNumber} ${start}..${end}`)
  const events = body?.events || []
  const reported = parseInt(body?.status?.count, 10)
  // size is capped at 500. If ABC ever reports more than it returned, we are
  // silently truncating a club's calendar — say so rather than under-report.
  if (Number.isInteger(reported) && reported > events.length) {
    console.warn(`[abcGroupX] truncated window ${clubNumber} ${start}..${end}: ABC reported ${reported}, returned ${events.length}`)
  }
  return events
}

// startDate/endDate are 'YYYY-MM-DD' inclusive, interpreted club-local.
async function listClasses(clubNumber, startDate, endDate) {
  assertClub(clubNumber)
  const windows = _chunkDateRange(startDate, endDate)
  const batches = []
  for (const w of windows) {
    batches.push(await _fetchClassWindow(clubNumber, w.start, w.end))
  }

  // Windows are padded +/-1 day, so adjacent windows overlap. Dedupe by eventId.
  const byId = new Map()
  for (const raw of batches.flat()) {
    if (String(raw.category || '').toLowerCase() !== 'class') continue
    const shaped = _shapeClassEvent(raw)
    const day = (shaped.event_timestamp_local || '').slice(0, 10)
    if (day < startDate || day > endDate) continue
    byId.set(shaped.event_id, shaped)
  }
  return [...byId.values()]
    .sort((a, b) => String(a.event_timestamp).localeCompare(String(b.event_timestamp)))
}

async function createClass(clubNumber, opts) {
  assertClub(clubNumber)
  // Field names confirmed against a working call 2026-07-30. These differ from
  // the names GET responses use, which is what made this look like an ABC-side
  // problem for a while:
  //   startTime  (NOT eventTimestamp) — naive club-local "YYYY-MM-DD HH:mm:ss"
  //   levelId    (NOT eventTrainingLevelId)
  // Duration is taken from the event type; POST does not accept it.
  //
  // ABC rejects the create with API-CAL-EVT-0060 ("The event training level
  // doesn't exist") whenever the event type HAS a training level and levelId is
  // absent. Every WCS class type has exactly one, so resolve a default here
  // rather than trusting every caller to remember. Forgetting the level is the
  // single most common way to hit 0060 and it is entirely avoidable.
  let levelId = opts.training_level_id
  if (!levelId) {
    try {
      const types = await listClassTypes(clubNumber)
      const type = types.find(t => t.event_type_id === opts.event_type_id)
      levelId = type?.training_levels?.[0]?.level_id || null
    } catch (err) {
      console.warn('[abcGroupX] could not resolve a default training level:', err.message)
    }
  }

  const payload = {
    eventTypeId: opts.event_type_id,
    employeeId: opts.employee_id,
    startTime: opts.event_timestamp_local,
  }
  if (levelId) payload.levelId = levelId

  const r = await abcMutate('POST', `/${clubNumber}/calendars/events`, payload)
  if (!r.ok) return { ok: false, event_id: null, http: r.http, error: r.error }

  // A real create always answers with a link to the new event. Without it we
  // cannot confirm anything was created, so do NOT report success — an empty or
  // unparseable 2xx body would otherwise read as "created" and the class would
  // silently never appear on the calendar.
  const eventId = _createdEventId(r.data)
  if (!eventId) {
    console.error('[abcGroupX] create returned no event link:', JSON.stringify(r.data))
    return {
      ok: false,
      event_id: null,
      http: r.http,
      error: 'ABC accepted the request but returned no event, so the class was not created. Try again.',
    }
  }
  return { ok: true, event_id: eventId, http: r.http, error: null }
}

async function cancelClass(clubNumber, eventId) {
  assertClub(clubNumber)
  const r = await abcMutate(
    'DELETE',
    `/${clubNumber}/calendars/events/${encodeURIComponent(eventId)}`,
    null,
  )
  return { ok: r.ok, http: r.http, error: r.error }
}

module.exports = {
  GX_DEPARTMENTS, EXCLUDED_NAMES,
  listClassTypes, listInstructors, listClasses, createClass, cancelClass,
  _shapeClassType, _shapeInstructor, _shapeClassEvent,
  _chunkDateRange, _assertAbcOk, _abcBodyError, _createdEventId, MAX_RANGE_DAYS, ABC_OK_CODE,
}

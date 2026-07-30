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
const axios = require('axios')
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

async function listClassTypes(clubNumber) {
  assertClub(clubNumber)
  return cache.wrap(`gx:types:${clubNumber}`, TYPES_TTL_MS, async () => {
    const r = await axios.get(`${ABC_BASE_URL}/${clubNumber}/calendars/eventtypes`, {
      headers: abcHeaders(), timeout: 20000,
    })
    return (r.data?.eventTypes || [])
      // /calendars/eventtypes says "class"; /calendars/events says "Class".
      .filter(t => String(t.category || '').toLowerCase() === 'class')
      .map(_shapeClassType)
      .sort((a, b) => a.name.localeCompare(b.name))
  })
}

async function listInstructors(clubNumber) {
  assertClub(clubNumber)
  return cache.wrap(`gx:instructors:${clubNumber}`, EMPLOYEES_TTL_MS, async () => {
    const r = await axios.get(`${ABC_BASE_URL}/${clubNumber}/employees`, {
      headers: abcHeaders(), timeout: 20000,
    })
    return (r.data?.employees || [])
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

// ABC signals success with messageCode API-CAL-EVT-0000. Anything else on a
// 200 is a real error hiding in a success response, and must not be read as
// "no classes" — that silently turns a failed read into an empty calendar.
function _assertAbcOk(body, context) {
  const code = body?.status?.messageCode
  if (code && code !== 'API-CAL-EVT-0000') {
    throw new Error(`ABC ${code}: ${(body.status.message || '').trim()} (${context})`)
  }
}

async function _fetchClassWindow(clubNumber, start, end) {
  const r = await axios.get(`${ABC_BASE_URL}/${clubNumber}/calendars/events`, {
    headers: abcHeaders(),
    // No eventStatus filter: that is what makes future "Pending" classes visible.
    // Widen by a day each side: ABC reads eventDateRange as club-local Pacific
    // while we reason in UTC. Trimmed back by the caller.
    params: { eventDateRange: `${padDate(start, -1)},${padDate(end, 1)}`, size: 500 },
    timeout: 30000,
  })
  _assertAbcOk(r.data, `${clubNumber} ${start}..${end}`)
  const events = r.data?.events || []
  const reported = parseInt(r.data?.status?.count, 10)
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
  const payload = {
    eventTypeId: opts.event_type_id,
    employeeId: opts.employee_id,
    eventTimestamp: opts.event_timestamp_local, // "YYYY-MM-DD HH:mm:ss", club-local
    duration: String(opts.duration_minutes),
  }
  if (opts.training_level_id) payload.eventTrainingLevelId = opts.training_level_id

  const r = await axios.post(`${ABC_BASE_URL}/${clubNumber}/calendars/events`, payload, {
    headers: { ...abcHeaders(), 'Content-Type': 'application/json' },
    timeout: 30000,
    validateStatus: () => true,
  })
  if (r.status < 200 || r.status >= 300) {
    console.error('[abcGroupX] createClass failed:', r.status, JSON.stringify(r.data))
    return {
      ok: false,
      event_id: null,
      http: r.status,
      error: r.data?.status?.message || r.data?.message || `HTTP ${r.status}`,
    }
  }
  const created = r.data?.events?.[0] || r.data?.event || r.data
  return { ok: true, event_id: created?.eventId || null, http: r.status, error: null }
}

async function cancelClass(clubNumber, eventId) {
  assertClub(clubNumber)
  const r = await axios.delete(
    `${ABC_BASE_URL}/${clubNumber}/calendars/events/${encodeURIComponent(eventId)}`,
    { headers: abcHeaders(), timeout: 30000, validateStatus: () => true },
  )
  if (r.status < 200 || r.status >= 300) {
    console.error('[abcGroupX] cancelClass failed:', r.status, JSON.stringify(r.data))
    return {
      ok: false,
      http: r.status,
      error: r.data?.status?.message || r.data?.message || `HTTP ${r.status}`,
    }
  }
  return { ok: true, http: r.status, error: null }
}

module.exports = {
  GX_DEPARTMENTS, EXCLUDED_NAMES,
  listClassTypes, listInstructors, listClasses, createClass, cancelClass,
  _shapeClassType, _shapeInstructor, _shapeClassEvent,
  _chunkDateRange, _assertAbcOk, MAX_RANGE_DAYS,
}

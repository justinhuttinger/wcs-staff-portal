// Pure helpers for the PT Scheduler (/abc-scheduler routes).
// Kept free of I/O so they can be unit-tested directly.

// The four ABC event statuses the scheduler writes. These are the exact
// strings ABC's undocumented PUT /calendars/events/{id}/status accepts.
const EVENT_STATUSES = ['Completed', 'Pending', 'Canceled-Charge', 'Canceled-No Charge']

// ABC's departments block is `{ department: [...] }` where the array holds
// plain strings. Defensive about the singular/absent shapes because ABC
// returns `{ department: [] }` for staff with no department set.
function employeeDepartments(emp) {
  const d = emp?.employment?.departments?.department
  if (Array.isArray(d)) return d.filter(Boolean).map(String)
  if (typeof d === 'string' && d) return [d]
  return []
}

const PT_DEPARTMENT = 'personal trainers'

// A trainer is anyone with "Personal Trainers" among their departments —
// not necessarily their only one (plenty are Front Desk + PT).
function isPersonalTrainer(emp) {
  return employeeDepartments(emp).some(d => d.trim().toLowerCase() === PT_DEPARTMENT)
}

// ABC's purchasehistory returns one summary per billing lot, so a client with
// five past packages has five rows. The scheduler only wants a single number:
// how many sessions they have left right now.
function sumSessionSummaries(payload) {
  const summaries = payload?.members?.[0]?.serviceSummaries
    || payload?.serviceSummaries
    || []
  const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
  return summaries.reduce((acc, s) => ({
    available: acc.available + n(s.available),
    scheduled: acc.scheduled + n(s.scheduled),
    purchased: acc.purchased + n(s.purchased),
  }), { available: 0, scheduled: 0, purchased: 0 })
}

// ABC answers business rejections with HTTP 200 and a messageCode, so the HTTP
// status alone is never proof of success.
const ABC_SUCCESS_CODE = 'API-CAL-EVT-0000'

function isAbcSuccess(httpStatus, body) {
  return httpStatus >= 200 && httpStatus < 300
    && body?.status?.messageCode === ABC_SUCCESS_CODE
}

// Pull the new eventId out of the HATEOAS link ABC returns on a successful
// POST /calendars/events.
function extractEventId(body) {
  const href = body?.result?.links?.[0]?.href
  if (!href) return null
  return href.split('/').filter(Boolean).pop() || null
}

module.exports = {
  EVENT_STATUSES,
  PT_DEPARTMENT,
  employeeDepartments,
  isPersonalTrainer,
  sumSessionSummaries,
  isAbcSuccess,
  extractEventId,
  ABC_SUCCESS_CODE,
}

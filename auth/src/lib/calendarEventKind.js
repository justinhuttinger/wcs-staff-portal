// What a calendar event actually is.
//
// ABC files everything a trainer's diary holds under one category, so a report
// that counts "Completed Appointments" counts a member's training session, an
// hour of desk work and a sales consult as the same thing. For August that made
// Trainer Performance report 2,128 sessions when only 1,898 involved a member —
// 10.6% of a trainer's "sessions" were admin blocks and floor shifts.
//
// FOUR KINDS, and every report that touches the calendar should say which it
// means:
//
//   session  training that was delivered to a member
//   consult  a Day One / PT consult — a sales appointment, not training
//   admin    desk time, floor hours, blocked-out diary. Not client work at all
//   class    a group class, which ABC already separates by category
//
// MATCHED ON THE EVENT NAME, because that is the only thing ABC gives us. The
// names are per-club and hand-typed, so this matches on shape rather than an
// exact list — PT Consult, PT Consult 1 and PT Consult #2 are all consults, and
// a club adding "PT Consult 3" tomorrow is classified correctly without a code
// change. A hardcoded list would silently reclassify it as a session.

const ADMIN = /^\s*(admin|floor\s*hour|unavailable|blocked|break|lunch|meeting)/i
const CONSULT = /consult/i

const KIND = {
  SESSION: 'session',
  CONSULT: 'consult',
  ADMIN: 'admin',
  CLASS: 'class',
}

/**
 * @param event { event_name, category } — an abc_calendar_events row, or the
 *              same two fields from anywhere else
 */
function classifyCalendarEvent(event) {
  const name = String(event?.event_name || '')
  // ABC's own category wins for classes: it is the one part of this it gets
  // right, and a class named "Small Group Training" would otherwise read as a
  // session.
  if (String(event?.category || '').toLowerCase() === 'class') return KIND.CLASS
  if (ADMIN.test(name)) return KIND.ADMIN
  if (CONSULT.test(name)) return KIND.CONSULT
  return KIND.SESSION
}

/** True for work delivered to a member — the thing "sessions" should mean. */
function isSession(event) {
  return classifyCalendarEvent(event) === KIND.SESSION
}

function isConsult(event) {
  return classifyCalendarEvent(event) === KIND.CONSULT
}

function isAdmin(event) {
  return classifyCalendarEvent(event) === KIND.ADMIN
}

/** Human label for a kind, for a column or a legend. */
const KIND_LABEL = {
  session: 'Session',
  consult: 'Consult',
  admin: 'Admin',
  class: 'Class',
}

module.exports = {
  classifyCalendarEvent, isSession, isConsult, isAdmin, KIND, KIND_LABEL,
}

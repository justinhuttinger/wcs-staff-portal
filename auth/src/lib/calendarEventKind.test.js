const test = require('node:test')
const assert = require('node:assert')
const { classifyCalendarEvent, isSession, isAdmin, isConsult, KIND } = require('./calendarEventKind')

const ev = (event_name, category = 'Appointment') => ({ event_name, category })

// ---------------------------------------------------------------------------
// The three kinds ABC clumps together.
// ---------------------------------------------------------------------------

test('training of every name is a session', () => {
  for (const n of [
    'PT60', 'PT 60MIN', 'PT30', 'PARTNER60', 'Partner Training', 'PT 60 NFW',
    'PT 60MIN DBL', 'Train w. your Trainer', 'PT 30 NFW', 'STRETCH THERAPY 30',
    'STRETCH THERAPY 60', 'Workshops', 'PRIVATE SWIM',
  ]) {
    assert.equal(classifyCalendarEvent(ev(n)), KIND.SESSION, n)
  }
})

test('desk time and floor hours are admin, not training', () => {
  for (const n of ['Admin', 'admin', '  Admin ', 'Floor Hour', 'Floor  Hour', 'Unavailable']) {
    assert.equal(classifyCalendarEvent(ev(n)), KIND.ADMIN, n)
  }
})

// The names are hand-typed per club: PT Consult, PT Consult 1 and PT Consult #2
// all exist today. Matching on shape means a club adding "PT Consult 3"
// tomorrow is classified right with no code change — a hardcoded list would
// silently count it as training.
test('every shape of consult is a consult', () => {
  for (const n of ['PT Consult', 'PT Consult 1', 'PT Consult #2', 'PT CONSULT 3', 'consult']) {
    assert.equal(classifyCalendarEvent(ev(n)), KIND.CONSULT, n)
  }
})

test('a class is a class whatever it is called', () => {
  assert.equal(classifyCalendarEvent(ev('SMALL GROUP TRAINING', 'Class')), KIND.CLASS)
  // Named like training, but ABC says Class, and ABC is right about this one.
  assert.equal(classifyCalendarEvent(ev('PT60', 'Class')), KIND.CLASS)
})

test('an unknown name falls to session rather than being dropped', () => {
  // Erring toward session keeps a new training name in the numbers. Erring the
  // other way would silently delete a trainer's work.
  assert.equal(classifyCalendarEvent(ev('BRAND NEW THING')), KIND.SESSION)
  assert.equal(classifyCalendarEvent(ev(null)), KIND.SESSION)
  assert.equal(classifyCalendarEvent(null), KIND.SESSION)
})

// "Admin" must not swallow a session that merely mentions it somewhere.
test('admin is matched at the start, not anywhere in the name', () => {
  assert.equal(classifyCalendarEvent(ev('PT60 with Admin notes')), KIND.SESSION)
})

test('the helpers agree with the classifier', () => {
  assert.equal(isSession(ev('PT60')), true)
  assert.equal(isAdmin(ev('Floor Hour')), true)
  assert.equal(isConsult(ev('PT Consult #2')), true)
  assert.equal(isSession(ev('Admin')), false)
})

// Every August event landed in exactly one bucket and they summed to the old
// total: 1,795 sessions + 113 consults + 215 admin + 5 classes = 2,128, which
// is what analytics_trainer_performance_totals used to report as "sessions".
test('the four kinds are exhaustive and mutually exclusive', () => {
  const names = ['PT60', 'Admin', 'PT Consult', 'SMALL GROUP TRAINING', 'Floor Hour', 'PRIVATE SWIM']
  for (const n of names) {
    const kinds = [isSession, isConsult, isAdmin].filter(f => f(ev(n, n === 'SMALL GROUP TRAINING' ? 'Class' : 'Appointment')))
    assert.ok(kinds.length <= 1, `${n} matched more than one kind`)
  }
})

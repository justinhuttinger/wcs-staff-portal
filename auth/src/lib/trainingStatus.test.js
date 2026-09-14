const test = require('node:test')
const assert = require('node:assert')
const { assignmentStatus, isCaughtUp, rollUp } = require('./trainingStatus')
const { assignedAtFromId } = require('./operandioApi')

const NOW = Date.parse('2026-09-14T12:00:00Z')
const row = (over = {}) => ({
  dueAt: '2026-09-20T12:00:00Z',
  status: { completedAt: null, percentComplete: 0 },
  ...over,
})

// ---------------------------------------------------------------------------
// The four states.
// ---------------------------------------------------------------------------

test('finished is complete, however late it was', () => {
  assert.equal(assignmentStatus(row({
    dueAt: '2026-08-06T00:00:00Z',
    status: { completedAt: '2026-09-01T00:00:00Z', percentComplete: 100 },
  }), NOW), 'complete')
})

test('past due and unfinished is overdue', () => {
  assert.equal(assignmentStatus(row({ dueAt: '2026-09-13T12:00:00Z' }), NOW), 'overdue')
})

// The distinction the report exists to draw: two people can both be behind and
// need completely different conversations.
test('overdue beats progress, but the progress is still on the row', () => {
  const started = row({ dueAt: '2026-08-05T22:28:16Z', status: { completedAt: null, percentComplete: 71 } })
  const untouched = row({ dueAt: '2026-08-05T22:28:16Z', status: { completedAt: null, percentComplete: 0 } })
  assert.equal(assignmentStatus(started, NOW), 'overdue')
  assert.equal(assignmentStatus(untouched, NOW), 'overdue')
  assert.equal(started.status.percentComplete, 71)
})

test('started and still in time is in progress', () => {
  assert.equal(assignmentStatus(row({ status: { completedAt: null, percentComplete: 28 } }), NOW), 'in_progress')
})

test('untouched and still in time is not started', () => {
  assert.equal(assignmentStatus(row(), NOW), 'not_started')
})

// Operandio allows a null due date and the live data has one. Nobody has been
// told when to finish, so it cannot be held against them.
test('an assignment with no due date is never overdue', () => {
  assert.equal(assignmentStatus(row({ dueAt: null }), NOW), 'not_started')
  assert.equal(assignmentStatus(row({ dueAt: null, status: { percentComplete: 50 } }), NOW), 'in_progress')
  assert.equal(assignmentStatus(row({ dueAt: 'not a date' }), NOW), 'not_started')
})

// ---------------------------------------------------------------------------
// Caught up.
// ---------------------------------------------------------------------------

test('caught up means nothing overdue, not everything done', () => {
  assert.equal(isCaughtUp([{ status: 'complete' }, { status: 'not_started' }]), true)
  assert.equal(isCaughtUp([{ status: 'complete' }, { status: 'overdue' }]), false)
  assert.equal(isCaughtUp([]), true)
})

// ---------------------------------------------------------------------------
// The roll-up.
// ---------------------------------------------------------------------------

const people = [{ user_id: 'a' }, { user_id: 'b' }, { user_id: 'c' }]
const assignments = [
  { user_id: 'a', status: 'complete' },
  { user_id: 'a', status: 'overdue' },
  { user_id: 'b', status: 'complete' },
]

test('a club counts its people and its work separately', () => {
  const r = rollUp(assignments, people)
  assert.equal(r.assignments, 3)
  assert.equal(r.complete, 2)
  assert.equal(r.overdue, 1)
  assert.equal(r.people, 3)
  assert.equal(r.people_behind, 1)          // a
  assert.equal(r.people_caught_up, 1)       // b
  assert.equal(r.people_unassigned, 1)      // c
})

// The headline this report was asked for. Someone with nothing assigned is not
// caught up and is not behind -- they are a third thing, and folding them into
// either one is what would make a club with no training read as 100%.
test('staff with nothing assigned are their own category, not compliance', () => {
  const r = rollUp([], [{ user_id: 'x' }, { user_id: 'y' }])
  assert.equal(r.people_unassigned, 2)
  assert.equal(r.people_caught_up, 0)
  assert.equal(r.people_behind, 0)
  assert.equal(r.percent_complete, null, 'no work due means no rate, not 0% and not 100%')
})

// Work that has not come due yet is excluded from both halves. Otherwise
// assigning a course to the whole company would drop the number on the spot.
test('the rate is over work that has come due', () => {
  const r = rollUp([
    { user_id: 'a', status: 'complete' },
    { user_id: 'a', status: 'overdue' },
    { user_id: 'a', status: 'not_started' },
    { user_id: 'a', status: 'in_progress' },
  ], [{ user_id: 'a' }])
  assert.equal(r.percent_complete, 50)
})

// ---------------------------------------------------------------------------
// The assigned date, which the API does not give us.
// ---------------------------------------------------------------------------

// This is the check that justified using it at all: a real assignment id from
// production, whose decoded timestamp sits exactly seven days before the dueAt
// the API reported for it.
test('the assigned date decodes out of the assignment id', () => {
  const assigned = assignedAtFromId('6a6b893e5ace27e65bd80686')
  assert.equal(assigned, '2026-07-30T17:26:22.000Z')
  const due = Date.parse('2026-08-06T17:26:22.547Z')
  const gapDays = (due - Date.parse(assigned)) / 86400000
  assert.ok(Math.abs(gapDays - 7) < 0.001, `expected a 7-day gap, got ${gapDays}`)
})

// Degrade to "unknown" rather than to 1970, so a future id format is visible as
// a gap instead of quietly dating every assignment to the Nixon administration.
test('anything that is not an ObjectId decodes to null', () => {
  for (const bad of [null, undefined, '', 'abc', '6a6b893e5ace27e65bd8068', 'zzzzzzzzzzzzzzzzzzzzzzzz']) {
    assert.equal(assignedAtFromId(bad), null, `${JSON.stringify(bad)} decoded to something`)
  }
})

test('a timestamp outside a sane range decodes to null', () => {
  assert.equal(assignedAtFromId('00000000' + '0'.repeat(16)), null, '1970 accepted')
  assert.equal(assignedAtFromId('ffffffff' + '0'.repeat(16)), null, 'year 2106 accepted')
})

const test = require('node:test')
const assert = require('node:assert')
const { buildGroupX } = require('./groupXAnalytics')

const att = (over = {}) => ({
  slug: 'salem', class_date: '2026-08-10', hour: 9, dow: 1, month: '2026-08-01',
  class_name: 'Barbell Strength', instructor_name: 'Baley Houldson',
  headcount: 11, max_attendees: 10, utilisation: 110, recorded_by: 'unknown',
  ...over,
})

const sch = (over = {}) => ({
  slug: 'salem', class_date: '2026-08-10', hour: 9, dow: 1, month: '2026-08-01',
  class_name: 'Barbell Strength', instructor_name: 'Baley Houldson', series_id: 'x',
  ...over,
})

test('a class over its capacity is reported over 100%, not clamped', () => {
  // 11 people in a room set for 10 is the interesting class, not an error.
  const out = buildGroupX([att()], [])
  assert.equal(out.summary.avgUtilisation, 110)
  assert.equal(out.summary.overCapacity, 1)
})

test('a class with no capacity counts for attendance but not utilisation', () => {
  // Treating a missing capacity as 0% would drag the average down with a number
  // nobody recorded.
  const out = buildGroupX([
    att({ utilisation: 80, max_attendees: 20, headcount: 16 }),
    att({ utilisation: null, max_attendees: null, headcount: 30 }),
  ], [])
  assert.equal(out.summary.totalAttendance, 46)
  assert.equal(out.summary.avgUtilisation, 80)
  assert.equal(out.summary.utilisationSample, 1)
})

// --- coverage ---------------------------------------------------------------

test('coverage counts scheduled classes that got a headcount', () => {
  const out = buildGroupX([att()], [sch(), sch({ class_date: '2026-08-11' })])
  assert.equal(out.summary.classesScheduled, 2)
  assert.equal(out.summary.scheduledCounted, 1)
  assert.equal(out.summary.coverage, 50)
  assert.equal(out.summary.missedCount, 1)
})

test('a recorded class that was never scheduled still counts', () => {
  // The first real row is at a club with no series at all. The attendance
  // happened whether or not a series existed.
  const out = buildGroupX([att()], [])
  assert.equal(out.summary.unscheduledCount, 1)
  assert.equal(out.summary.totalAttendance, 11)
  assert.match(out.notes.unscheduled, /not on the schedule/)
})

test('recorded is never assumed to be a subset of scheduled', () => {
  // One scheduled-and-counted, one scheduled-and-missed, one unscheduled.
  const out = buildGroupX(
    [att(), att({ class_date: '2026-08-12', class_name: 'Pop-up HIIT' })],
    [sch(), sch({ class_date: '2026-08-11' })],
  )
  assert.equal(out.summary.classesRecorded, 2)
  assert.equal(out.summary.classesScheduled, 2)
  assert.equal(out.summary.scheduledCounted, 1)
  assert.equal(out.summary.unscheduledCount, 1)
  // Coverage is of the SCHEDULE, so it cannot exceed 100% just because extra
  // classes were recorded.
  assert.equal(out.summary.coverage, 50)
})

test('a missed class is absent from the averages, not counted as zero', () => {
  const out = buildGroupX([att({ headcount: 10, max_attendees: 10, utilisation: 100 })],
    [sch(), sch({ class_date: '2026-08-11' })])
  assert.equal(out.summary.avgHeadcount, 10)
  assert.match(out.notes.coverage, /not counted as zero/)
})

test('with nothing scheduled there is no coverage claim', () => {
  const out = buildGroupX([att()], [])
  assert.equal(out.summary.coverage, null)
  assert.equal(out.notes.coverage, null)
})

// --- the dimensions ---------------------------------------------------------

test('time dimensions stay in clock order, not size order', () => {
  // A distribution read out of sequence is not a distribution.
  const out = buildGroupX([
    att({ hour: 18, dow: 3, headcount: 30 }),
    att({ hour: 5, dow: 1, headcount: 4 }),
    att({ hour: 9, dow: 6, headcount: 12 }),
  ], [])
  assert.deepEqual(out.byHour.map(h => h.key), [5, 9, 18])
  assert.deepEqual(out.byDow.map(d => d.key), [1, 3, 6])
  assert.equal(out.byDow[0].label, 'Monday')
})

test('class and instructor rollups are ordered by attendance', () => {
  const out = buildGroupX([
    att({ class_name: 'Small', instructor_name: 'A', headcount: 3 }),
    att({ class_name: 'Big', instructor_name: 'B', headcount: 40 }),
  ], [])
  assert.deepEqual(out.byClass.map(c => c.label), ['Big', 'Small'])
  assert.deepEqual(out.byInstructor.map(c => c.label), ['B', 'A'])
})

test('every average carries its class count', () => {
  // One class averaging 14 and thirty averaging 12 are not comparable, and a
  // bare average invites exactly that comparison.
  const out = buildGroupX([
    att({ instructor_name: 'A', headcount: 14 }),
    att({ instructor_name: 'B', headcount: 10 }),
    att({ instructor_name: 'B', headcount: 14, class_date: '2026-08-11' }),
  ], [])
  const a = out.byInstructor.find(x => x.label === 'A')
  const b = out.byInstructor.find(x => x.label === 'B')
  assert.equal(a.classes, 1)
  assert.equal(b.classes, 2)
  assert.equal(b.avgHeadcount, 12)
})

test('an empty window produces no rates and no false alarms', () => {
  const out = buildGroupX([], [])
  assert.equal(out.summary.classesRecorded, 0)
  assert.equal(out.summary.avgHeadcount, null)
  assert.equal(out.summary.avgUtilisation, null)
  assert.equal(out.notes.coverage, null)
  assert.equal(out.notes.unscheduled, null)
})

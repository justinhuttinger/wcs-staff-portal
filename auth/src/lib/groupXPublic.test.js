const test = require('node:test')
const assert = require('node:assert')
const { mondayOf, toPublicClass, buildWeek, isPublishable } = require('./groupXPublic')

const CLASS = {
  event_id: 'evt1',
  event_type_id: 'type1',
  class_name: 'Bootcamp',
  event_timestamp: '2026-07-28T13:00:00.000Z',
  event_timestamp_local: '2026-07-28 06:00:00',
  status: 'Pending',
  duration_minutes: 60,
  max_attendees: 12,
  employee_id: 'emp1',
  instructor_name: 'Matthew Astley',
  headcount: 9,
}

test('mondayOf returns the Monday of that week', () => {
  assert.strictEqual(mondayOf('2026-07-30'), '2026-07-27') // Thursday -> Monday
  assert.strictEqual(mondayOf('2026-07-27'), '2026-07-27') // Monday -> itself
  assert.strictEqual(mondayOf('2026-08-02'), '2026-07-27') // Sunday -> previous Monday
})

test('toPublicClass shortens the instructor to first name + last initial', () => {
  assert.strictEqual(toPublicClass(CLASS).instructor, 'Matthew A.')
})

test('toPublicClass formats a 12-hour time label', () => {
  const p = toPublicClass(CLASS)
  assert.strictEqual(p.time, '06:00')
  assert.strictEqual(p.time_label, '6:00 AM')
})

test('toPublicClass renders noon and midnight correctly', () => {
  assert.strictEqual(toPublicClass({ ...CLASS, event_timestamp_local: '2026-07-28 12:00:00' }).time_label, '12:00 PM')
  assert.strictEqual(toPublicClass({ ...CLASS, event_timestamp_local: '2026-07-28 00:30:00' }).time_label, '12:30 AM')
})

test('toPublicClass leaks no member, staff, or business data', () => {
  const p = toPublicClass(CLASS)
  assert.deepStrictEqual(
    Object.keys(p).sort(),
    ['class_name', 'duration_minutes', 'instructor', 'time', 'time_label'],
  )
  const json = JSON.stringify(p)
  assert.ok(!json.includes('emp1'), 'employee_id must not leak')
  assert.ok(!json.includes('evt1'), 'event_id must not leak')
  assert.ok(!json.includes('Astley'), 'full staff surname must not leak')
})

test('toPublicClass handles a missing instructor', () => {
  assert.strictEqual(toPublicClass({ ...CLASS, instructor_name: null }).instructor, null)
})

test('toPublicClass handles a single-word instructor name', () => {
  assert.strictEqual(toPublicClass({ ...CLASS, instructor_name: 'Cher' }).instructor, 'Cher')
})

test('isPublishable hides cancelled classes from the wall', () => {
  assert.strictEqual(isPublishable({ status: 'Pending', instructor_name: 'A B' }), true)
  assert.strictEqual(isPublishable({ status: 'Completed', instructor_name: 'A B' }), true)
  assert.strictEqual(isPublishable({ status: 'Canceled', instructor_name: 'A B' }), false)
  assert.strictEqual(isPublishable({ status: 'canceled-charge', instructor_name: 'A B' }), false)
})

test('isPublishable hides ABC unbooked placeholder slots', () => {
  // Real Salem data: Mon Jul 27 had two 9:30 AM Barbell Strength entries, one
  // staffed and one "Unbooked Unbooked". Publishing both shows members a
  // duplicate class with no instructor.
  assert.strictEqual(isPublishable({ status: 'Pending', unbooked: true, instructor_name: null }), false)
  assert.strictEqual(isPublishable({ status: 'Pending', instructor_name: null }), false)
})

test('buildWeek drops the unbooked duplicate but keeps the staffed class', () => {
  const staffed = { ...CLASS, event_timestamp_local: '2026-07-27 09:30:00', class_name: 'Barbell Strength' }
  const ghost = { ...staffed, instructor_name: null, unbooked: true }
  const w = buildWeek('2026-07-27', [ghost, staffed])
  const mon = w.days.find(d => d.date === '2026-07-27')
  assert.strictEqual(mon.classes.length, 1)
  assert.strictEqual(mon.classes[0].instructor, 'Matthew A.')
})

test('buildWeek produces seven Monday-first days', () => {
  const w = buildWeek('2026-07-27', [CLASS])
  assert.strictEqual(w.week_start, '2026-07-27')
  assert.strictEqual(w.week_end, '2026-08-02')
  assert.strictEqual(w.days.length, 7)
  assert.deepStrictEqual(w.days.map(d => d.weekday), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
})

test('buildWeek files each class under its local date and sorts by time', () => {
  const later = { ...CLASS, event_timestamp_local: '2026-07-28 18:00:00', class_name: 'Yoga' }
  const w = buildWeek('2026-07-27', [later, CLASS])
  const tue = w.days.find(d => d.date === '2026-07-28')
  assert.deepStrictEqual(tue.classes.map(c => c.class_name), ['Bootcamp', 'Yoga'])
  assert.strictEqual(w.days.find(d => d.date === '2026-07-27').classes.length, 0)
})

test('buildWeek drops classes outside the week', () => {
  const w = buildWeek('2026-07-27', [{ ...CLASS, event_timestamp_local: '2026-09-01 06:00:00' }])
  assert.strictEqual(w.days.reduce((n, d) => n + d.classes.length, 0), 0)
})

test('buildWeek excludes cancelled classes', () => {
  const w = buildWeek('2026-07-27', [{ ...CLASS, status: 'Canceled' }])
  assert.strictEqual(w.days.reduce((n, d) => n + d.classes.length, 0), 0)
})

test('buildWeek labels a range that spans two months', () => {
  assert.strictEqual(buildWeek('2026-07-27', []).range_label, 'Jul 27 - Aug 2')
  assert.strictEqual(buildWeek('2026-08-03', []).range_label, 'Aug 3 - 9')
})

test('buildWeek tolerates no classes at all', () => {
  const w = buildWeek('2026-07-27', [])
  assert.strictEqual(w.days.length, 7)
  assert.ok(w.days.every(d => d.classes.length === 0))
})

test('publicCacheKeysForDates maps dates to their week keys and dedupes', () => {
  const { publicCacheKeysForDates } = require('./groupXPublic')
  // Mon Jul 27 and Fri Jul 31 are the same week, so one key.
  assert.deepStrictEqual(
    publicCacheKeysForDates('30935', ['2026-07-27', '2026-07-31']),
    ['gx:public:30935:2026-07-27'],
  )
  // A date in the next week adds a second key.
  assert.strictEqual(publicCacheKeysForDates('30935', ['2026-07-31', '2026-08-05']).length, 2)
})

test('publicCacheKeysForDates ignores junk instead of building bad keys', () => {
  const { publicCacheKeysForDates } = require('./groupXPublic')
  assert.deepStrictEqual(publicCacheKeysForDates('30935', ['nonsense', null, undefined, '']), [])
  assert.deepStrictEqual(publicCacheKeysForDates('30935', null), [])
})

test('publicCacheKeysForDates accepts a full local timestamp', () => {
  const { publicCacheKeysForDates } = require('./groupXPublic')
  assert.deepStrictEqual(
    publicCacheKeysForDates('30935', ['2026-08-01 10:00:00']),
    ['gx:public:30935:2026-07-27'],
  )
})

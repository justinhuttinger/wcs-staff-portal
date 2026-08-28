const test = require('node:test')
const assert = require('node:assert')
const { mondayOf, toPublicClass, buildDays, isPublishable, publicCacheKeysForDates } = require('./groupXPublic')

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
    ['class_name', 'description', 'duration_minutes', 'instructor', 'is_new', 'time', 'time_label'],
  )
  const json = JSON.stringify(p)
  assert.ok(!json.includes('emp1'), 'employee_id must not leak')
  assert.ok(!json.includes('evt1'), 'event_id must not leak')
  assert.ok(!json.includes('Astley'), 'full staff surname must not leak')
})

test('toPublicClass exposes is_new as a real boolean, never undefined', () => {
  assert.strictEqual(toPublicClass({ ...CLASS, is_new: true }).is_new, true)
  assert.strictEqual(toPublicClass(CLASS).is_new, false)
  assert.strictEqual(toPublicClass({ ...CLASS, is_new: 'yes' }).is_new, false)
})

test('toPublicClass carries a class description through', () => {
  const p = toPublicClass({ ...CLASS, description: 'A high-intensity, full-body workout.' })
  assert.strictEqual(p.description, 'A high-intensity, full-body workout.')
})

test('toPublicClass nulls an absent or empty description', () => {
  // The board makes a card clickable off this, so an empty string would open a
  // popup with nothing in it.
  assert.strictEqual(toPublicClass(CLASS).description, null)
  assert.strictEqual(toPublicClass({ ...CLASS, description: '' }).description, null)
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
  const w = buildDays('2026-07-27', [ghost, staffed])
  const mon = w.days.find(d => d.date === '2026-07-27')
  assert.strictEqual(mon.classes.length, 1)
  assert.strictEqual(mon.classes[0].instructor, 'Matthew A.')
})

test('buildWeek produces seven Monday-first days', () => {
  const w = buildDays('2026-07-27', [CLASS])
  assert.strictEqual(w.week_start, '2026-07-27')
  assert.strictEqual(w.week_end, '2026-08-02')
  assert.strictEqual(w.days.length, 7)
  assert.deepStrictEqual(w.days.map(d => d.weekday), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
})

test('buildWeek files each class under its local date and sorts by time', () => {
  const later = { ...CLASS, event_timestamp_local: '2026-07-28 18:00:00', class_name: 'Yoga' }
  const w = buildDays('2026-07-27', [later, CLASS])
  const tue = w.days.find(d => d.date === '2026-07-28')
  assert.deepStrictEqual(tue.classes.map(c => c.class_name), ['Bootcamp', 'Yoga'])
  assert.strictEqual(w.days.find(d => d.date === '2026-07-27').classes.length, 0)
})

test('buildWeek drops classes outside the week', () => {
  const w = buildDays('2026-07-27', [{ ...CLASS, event_timestamp_local: '2026-09-01 06:00:00' }])
  assert.strictEqual(w.days.reduce((n, d) => n + d.classes.length, 0), 0)
})

test('buildWeek excludes cancelled classes', () => {
  const w = buildDays('2026-07-27', [{ ...CLASS, status: 'Canceled' }])
  assert.strictEqual(w.days.reduce((n, d) => n + d.classes.length, 0), 0)
})

test('buildWeek labels a range that spans two months', () => {
  assert.strictEqual(buildDays('2026-07-27', []).range_label, 'Jul 27 - Aug 2')
  assert.strictEqual(buildDays('2026-08-03', []).range_label, 'Aug 3 - 9')
})

test('buildWeek tolerates no classes at all', () => {
  const w = buildDays('2026-07-27', [])
  assert.strictEqual(w.days.length, 7)
  assert.ok(w.days.every(d => d.classes.length === 0))
})

test('publicCacheKeysForDates dedupes windows shared by nearby dates', () => {
  const { publicCacheKeysForDates } = require('./groupXPublic')
  // Jul 27 and Jul 31 are 4 days apart, so their 7-day windows overlap.
  // 7 keys each, minus the 3 they share = 11 distinct.
  const keys = publicCacheKeysForDates('30935', ['2026-07-27', '2026-07-31'])
  assert.strictEqual(keys.length, 11)
  assert.strictEqual(new Set(keys).size, keys.length, 'no duplicates')
})

test('publicCacheKeysForDates covers far-apart dates independently', () => {
  const { publicCacheKeysForDates } = require('./groupXPublic')
  // A month apart: no window overlap, so 7 + 7.
  assert.strictEqual(publicCacheKeysForDates('30935', ['2026-07-01', '2026-09-01']).length, 14)
})

test('publicCacheKeysForDates ignores junk instead of building bad keys', () => {
  const { publicCacheKeysForDates } = require('./groupXPublic')
  assert.deepStrictEqual(publicCacheKeysForDates('30935', ['nonsense', null, undefined, '']), [])
  assert.deepStrictEqual(publicCacheKeysForDates('30935', null), [])
})

test('publicCacheKeysForDates accepts a full local timestamp', () => {
  const { publicCacheKeysForDates } = require('./groupXPublic')
  const keys = publicCacheKeysForDates('30935', ['2026-08-01 10:00:00'])
  assert.strictEqual(keys.length, 7)
  assert.ok(keys.includes('gx:public:30935:2026-08-01'))
  assert.ok(keys.includes('gx:public:30935:2026-07-26'))
})

test('isPublishable can be told an instructor is not required', () => {
  // Lap swim and open gym have nobody assigned; that is not a reason to hide
  // them from members.
  const slot = { status: 'Pending', instructor_name: null }
  assert.strictEqual(isPublishable(slot), false)
  assert.strictEqual(isPublishable(slot, { requireInstructor: false }), true)
})

test('a cancelled slot stays hidden even when instructors are optional', () => {
  assert.strictEqual(
    isPublishable({ status: 'Canceled', instructor_name: null }, { requireInstructor: false }),
    false,
  )
})

test('buildDays passes the instructor rule through', () => {
  const slot = {
    class_name: 'Lap Swim', instructor_name: null, status: 'Pending',
    event_timestamp_local: '2026-07-31 06:00:00',
  }
  assert.strictEqual(buildDays('2026-07-31', [slot]).days[0].classes.length, 0)
  assert.strictEqual(
    buildDays('2026-07-31', [slot], { requireInstructor: false }).days[0].classes.length, 1,
  )
})

test('toPublicClass drops the length suffix members should not see', () => {
  const out = toPublicClass({ ...CLASS, class_name: 'Butts and Guts - 30', duration_minutes: 30 })
  assert.strictEqual(out.class_name, 'Butts and Guts')
  // The length still reaches the board, which renders it as its own "30 min"
  // tag. Dropping the suffix must not drop the fact.
  assert.strictEqual(out.duration_minutes, 30)
})

test('toPublicClass leaves an ordinary class name alone', () => {
  assert.strictEqual(
    toPublicClass({ ...CLASS, class_name: 'Bootcamp', duration_minutes: 60 }).class_name,
    'Bootcamp',
  )
  // Ends in a number, but it is the name, not a length.
  assert.strictEqual(
    toPublicClass({ ...CLASS, class_name: 'Zone 2', duration_minutes: 60 }).class_name,
    'Zone 2',
  )
  // Suffix disagrees with the real duration, so it is part of the name.
  assert.strictEqual(
    toPublicClass({ ...CLASS, class_name: 'Studio - 60', duration_minutes: 30 }).class_name,
    'Studio - 60',
  )
})

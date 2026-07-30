const test = require('node:test')
const assert = require('node:assert')
const { aggregate, TIME_BUCKETS } = require('./groupXReport')

const rows = [
  { class_name: 'Bootcamp', instructor_name: 'Matthew Astley', event_timestamp_local: '2026-07-27 06:00:00', headcount: 10, max_attendees: 12 },
  { class_name: 'Bootcamp', instructor_name: 'Matthew Astley', event_timestamp_local: '2026-07-29 06:00:00', headcount: 8, max_attendees: 12 },
  { class_name: 'Yoga', instructor_name: 'Jane Doe', event_timestamp_local: '2026-07-28 18:00:00', headcount: 3, max_attendees: 10 },
]

test('aggregate rolls up per class with avg headcount and fill rate', () => {
  const bootcamp = aggregate(rows).by_class.find(c => c.key === 'Bootcamp')
  assert.strictEqual(bootcamp.sessions, 2)
  assert.strictEqual(bootcamp.total_attendees, 18)
  assert.strictEqual(bootcamp.avg_headcount, 9)
  assert.strictEqual(bootcamp.fill_rate, 0.75) // 18 / (12*2)
})

test('aggregate sorts by_class by avg headcount descending', () => {
  assert.deepStrictEqual(aggregate(rows).by_class.map(c => c.key), ['Bootcamp', 'Yoga'])
})

test('fill_rate is null, not zero, when capacity is unknown', () => {
  // A dash is honest. A fabricated 0% would read as "nobody came".
  const r = aggregate([{ class_name: 'Mystery', instructor_name: 'X', event_timestamp_local: '2026-07-27 06:00:00', headcount: 5, max_attendees: null }])
  assert.strictEqual(r.by_class[0].fill_rate, null)
  assert.strictEqual(r.by_class[0].avg_headcount, 5)
})

test('unknown-capacity sessions do not drag the fill rate down', () => {
  // Only the session whose capacity we know counts toward the percentage.
  const r = aggregate([
    { class_name: 'Mix', instructor_name: 'X', event_timestamp_local: '2026-07-27 06:00:00', headcount: 10, max_attendees: 10 },
    { class_name: 'Mix', instructor_name: 'X', event_timestamp_local: '2026-07-28 06:00:00', headcount: 4, max_attendees: null },
  ])
  const mix = r.by_class[0]
  assert.strictEqual(mix.fill_rate, 1)
  assert.strictEqual(mix.sessions, 2)
  assert.strictEqual(mix.sessions_with_capacity, 1)
  assert.strictEqual(mix.avg_headcount, 7)
})

test('aggregate omits buckets with no logged sessions entirely', () => {
  const r = aggregate(rows)
  // Only Mon/Tue/Wed have data. The other four weekdays must not appear at all.
  assert.deepStrictEqual(r.by_weekday.map(d => d.key).sort(), ['Mon', 'Tue', 'Wed'])
  assert.ok(!r.by_weekday.some(d => d.sessions === 0))
})

test('aggregate buckets by time of day', () => {
  const keys = aggregate(rows).by_time_bucket.map(b => b.key)
  assert.ok(keys.includes('Morning (5a-11a)'))
  assert.ok(keys.includes('Evening (4p-9p)'))
  assert.strictEqual(keys.length, 2)
})

test('time buckets cover the whole day with no gaps or overlaps', () => {
  let cursor = 0
  for (const b of TIME_BUCKETS) {
    assert.strictEqual(b.from, cursor, `gap or overlap before ${b.key}`)
    cursor = b.to
  }
  assert.strictEqual(cursor, 24)
})

test('aggregate on an empty set returns empty buckets, not zero rows', () => {
  const r = aggregate([])
  assert.deepStrictEqual(r.by_class, [])
  assert.deepStrictEqual(r.by_instructor, [])
  assert.deepStrictEqual(r.by_weekday, [])
  assert.strictEqual(r.totals.sessions, 0)
  assert.strictEqual(r.totals.avg_headcount, 0)
})

test('aggregate skips rows with no usable headcount', () => {
  const r = aggregate([
    { class_name: 'A', instructor_name: 'X', event_timestamp_local: '2026-07-27 06:00:00', headcount: 4, max_attendees: 10 },
    { class_name: 'B', instructor_name: 'X', event_timestamp_local: '2026-07-27 06:00:00', headcount: null, max_attendees: 10 },
  ])
  assert.deepStrictEqual(r.by_class.map(c => c.key), ['A'])
  assert.strictEqual(r.totals.sessions, 1)
})

test('a zero headcount is real data and is counted', () => {
  // Nobody turning up is exactly the signal this report exists to surface.
  const r = aggregate([
    { class_name: 'Empty', instructor_name: 'X', event_timestamp_local: '2026-07-27 06:00:00', headcount: 0, max_attendees: 10 },
  ])
  assert.strictEqual(r.totals.sessions, 1)
  assert.strictEqual(r.by_class[0].avg_headcount, 0)
  assert.strictEqual(r.by_class[0].fill_rate, 0)
})

test('an instructor with no name does not create a blank row', () => {
  const r = aggregate([
    { class_name: 'A', instructor_name: null, event_timestamp_local: '2026-07-27 06:00:00', headcount: 4, max_attendees: 10 },
  ])
  assert.deepStrictEqual(r.by_instructor, [])
  assert.strictEqual(r.by_class.length, 1)
})

test('aggregate ignores a malformed timestamp instead of inventing a weekday', () => {
  const r = aggregate([
    { class_name: 'A', instructor_name: 'X', event_timestamp_local: 'not-a-date', headcount: 4, max_attendees: 10 },
  ])
  assert.deepStrictEqual(r.by_weekday, [])
  assert.strictEqual(r.by_class.length, 1)
})

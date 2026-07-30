const test = require('node:test')
const assert = require('node:assert')
const { isFlagActive, activeFlagMap, markNewClasses } = require('./groupXNewClasses')

const FLAG = { club_number: '30935', event_type_id: 'yoga1', class_name: 'Yoga', show_until: '2026-09-30' }

const CLASSES = [
  { event_id: 'a', event_type_id: 'yoga1', class_name: 'Yoga', event_timestamp_local: '2026-09-29 06:00:00' },
  { event_id: 'b', event_type_id: 'boot1', class_name: 'Bootcamp', event_timestamp_local: '2026-09-29 10:00:00' },
]

test('isFlagActive includes the expiry day itself', () => {
  // "New until Sept 30" has to include Sept 30, or the badge vanishes a day early.
  assert.strictEqual(isFlagActive(FLAG, '2026-09-30'), true)
  assert.strictEqual(isFlagActive(FLAG, '2026-09-29'), true)
  assert.strictEqual(isFlagActive(FLAG, '2026-10-01'), false)
})

test('isFlagActive is false for a missing or malformed flag', () => {
  assert.strictEqual(isFlagActive(null, '2026-09-01'), false)
  assert.strictEqual(isFlagActive({}, '2026-09-01'), false)
  assert.strictEqual(isFlagActive({ show_until: null }, '2026-09-01'), false)
})

test('activeFlagMap keeps only flags live on that day', () => {
  const flags = [FLAG, { event_type_id: 'old1', show_until: '2026-01-01' }]
  const map = activeFlagMap(flags, '2026-09-15')
  assert.ok(map.has('yoga1'))
  assert.ok(!map.has('old1'))
})

test('markNewClasses badges only the flagged class type', () => {
  const out = markNewClasses(CLASSES, [FLAG])
  assert.strictEqual(out.find(c => c.event_id === 'a').is_new, true)
  assert.strictEqual(out.find(c => c.event_id === 'b').is_new, false)
})

test('markNewClasses evaluates the flag per class date, not per request', () => {
  // A week spanning the expiry must badge only the days on or before it.
  const spanning = [
    { event_id: 'x', event_type_id: 'yoga1', event_timestamp_local: '2026-09-30 06:00:00' },
    { event_id: 'y', event_type_id: 'yoga1', event_timestamp_local: '2026-10-01 06:00:00' },
  ]
  const out = markNewClasses(spanning, [FLAG])
  assert.strictEqual(out.find(c => c.event_id === 'x').is_new, true)
  assert.strictEqual(out.find(c => c.event_id === 'y').is_new, false)
})

test('markNewClasses sets is_new false when there are no flags', () => {
  const out = markNewClasses(CLASSES, [])
  assert.ok(out.every(c => c.is_new === false))
  assert.ok(out.every(c => 'is_new' in c), 'the field is always present, never undefined')
})

test('markNewClasses does not mutate the input classes', () => {
  const input = [{ event_id: 'a', event_type_id: 'yoga1', event_timestamp_local: '2026-09-29 06:00:00' }]
  markNewClasses(input, [FLAG])
  assert.strictEqual(input[0].is_new, undefined)
})

test('markNewClasses tolerates a class with no timestamp', () => {
  const out = markNewClasses([{ event_id: 'z', event_type_id: 'yoga1', event_timestamp_local: null }], [FLAG])
  assert.strictEqual(out[0].is_new, false)
})

test('markNewClasses handles empty input', () => {
  assert.deepStrictEqual(markNewClasses([], [FLAG]), [])
  assert.deepStrictEqual(markNewClasses(null, [FLAG]), [])
})

// --- per-session flags -----------------------------------------------------

const EVENT_FLAG = { club_number: '30935', abc_event_id: 'sat1', class_name: 'Yoga', show_until: '2026-09-30' }

test('a session flag badges only that session, not the whole class type', () => {
  // The real case: Yoga already runs Friday, we add a Saturday Yoga. Same
  // event type, so only the new session may carry the badge.
  const yoga = [
    { event_id: 'fri1', event_type_id: 'yoga1', event_timestamp_local: '2026-09-04 06:00:00' },
    { event_id: 'sat1', event_type_id: 'yoga1', event_timestamp_local: '2026-09-05 09:00:00' },
  ]
  const out = markNewClasses(yoga, [], [EVENT_FLAG])
  assert.strictEqual(out.find(c => c.event_id === 'fri1').is_new, false)
  assert.strictEqual(out.find(c => c.event_id === 'sat1').is_new, true)
  assert.strictEqual(out.find(c => c.event_id === 'sat1').new_source, 'session')
})

test('a class-type flag still badges every session of that type', () => {
  const out = markNewClasses(CLASSES, [FLAG], [])
  assert.strictEqual(out.find(c => c.event_id === 'a').is_new, true)
  assert.strictEqual(out.find(c => c.event_id === 'a').new_source, 'class')
})

test('an expired session flag does not badge', () => {
  const out = markNewClasses(
    [{ event_id: 'sat1', event_type_id: 'yoga1', event_timestamp_local: '2026-10-03 09:00:00' }],
    [], [EVENT_FLAG],
  )
  assert.strictEqual(out[0].is_new, false)
})

test('session flag wins the source label when both apply', () => {
  const out = markNewClasses(
    [{ event_id: 'sat1', event_type_id: 'yoga1', event_timestamp_local: '2026-09-05 09:00:00' }],
    [{ event_type_id: 'yoga1', show_until: '2026-09-30' }], [EVENT_FLAG],
  )
  assert.strictEqual(out[0].is_new, true)
  assert.strictEqual(out[0].new_source, 'session')
})

test('new_source is always present, and null when not new', () => {
  const out = markNewClasses(CLASSES, [], [])
  assert.ok(out.every(c => 'new_source' in c))
  assert.ok(out.every(c => c.new_source === null))
})

test('markNewClasses still works when the session flag list is omitted', () => {
  const out = markNewClasses(CLASSES, [FLAG])
  assert.strictEqual(out.find(c => c.event_id === 'a').is_new, true)
})

const test = require('node:test')
const assert = require('node:assert')
const {
  _shapeClassType, _shapeInstructor, _shapeClassEvent,
  _chunkDateRange, _assertAbcOk,
  GX_DEPARTMENTS, EXCLUDED_NAMES, MAX_RANGE_DAYS,
} = require('./abcGroupX')

const RAW_TYPE = {
  eventTypeId: '481132d6f4f1477b89474c8052b5b972',
  name: 'Barbell Strength',
  category: 'class',
  description: 'Strengthen your foundation with expert guidance.',
  duration: '60',
  maxAttendees: '10',
  eventTrainingLevels: [{ levelId: 'xzxxxxxxxxxxxxxxxxxxxxxxxxxxx001', levelName: '1' }],
}

const RAW_EVENT = {
  eventId: '6b63633197d240eab24027463b4b829b',
  eventTypeId: 'f3430edede864e53aed5313e10d4bd14',
  eventName: 'Bootcamp',
  category: 'Class',
  eventTimestamp: '2026-07-28 10:00:00.000000',
  status: 'Completed',
  duration: '60',
  maxAttendees: '12',
  employeeId: '3b193d59a95c42c4b8ba5ac2351f192a',
  employeeFirstName: 'Matthew',
  employeeLastName: 'Astley',
}

const RAW_EMPLOYEE = {
  employeeId: 'abc123',
  personal: { firstName: 'Jane', lastName: 'Doe' },
  employment: { employeeStatus: 'active', departments: { department: ['Group Exercise'] } },
}

test('_shapeClassType coerces ABC string numbers to numbers', () => {
  const t = _shapeClassType(RAW_TYPE)
  assert.strictEqual(t.event_type_id, '481132d6f4f1477b89474c8052b5b972')
  assert.strictEqual(t.name, 'Barbell Strength')
  assert.strictEqual(t.duration_minutes, 60)
  assert.strictEqual(t.max_attendees, 10)
  assert.deepStrictEqual(t.training_levels, [
    { level_id: 'xzxxxxxxxxxxxxxxxxxxxxxxxxxxx001', level_name: '1' },
  ])
})

test('_shapeClassType tolerates a type with no training levels or capacity', () => {
  const t = _shapeClassType({ eventTypeId: 'x', name: 'Yoga', duration: '60' })
  assert.strictEqual(t.max_attendees, null)
  assert.deepStrictEqual(t.training_levels, [])
})

test('_shapeClassEvent maps the event and resolves the Pacific timestamp', () => {
  const e = _shapeClassEvent(RAW_EVENT)
  assert.strictEqual(e.event_id, '6b63633197d240eab24027463b4b829b')
  assert.strictEqual(e.class_name, 'Bootcamp')
  assert.strictEqual(e.event_timestamp, '2026-07-28T17:00:00.000Z')
  assert.strictEqual(e.event_timestamp_local, '2026-07-28 10:00:00')
  assert.strictEqual(e.instructor_name, 'Matthew Astley')
  assert.strictEqual(e.max_attendees, 12)
})

test('_shapeClassEvent collapses ABC double spaces in instructor names', () => {
  // ABC returns employeeName as "Matthew  Astley" with two spaces; we build the
  // name from the first/last fields instead, so it must come out single-spaced.
  const e = _shapeClassEvent({ ...RAW_EVENT, employeeName: 'Matthew  Astley' })
  assert.strictEqual(e.instructor_name, 'Matthew Astley')
})

test('_shapeInstructor extracts the department array', () => {
  const i = _shapeInstructor(RAW_EMPLOYEE)
  assert.strictEqual(i.display_name, 'Jane Doe')
  assert.strictEqual(i.department, 'Group Exercise')
})

test('_shapeInstructor returns null department when ABC has none', () => {
  const i = _shapeInstructor({
    employeeId: 'y',
    personal: { firstName: 'No', lastName: 'Dept' },
    employment: { employeeStatus: 'active', departments: { department: [] } },
  })
  assert.strictEqual(i.department, null)
})

test('GX_DEPARTMENTS is Group Exercise first, then Personal Trainers', () => {
  assert.deepStrictEqual(GX_DEPARTMENTS, ['Group Exercise', 'Personal Trainers'])
})

test('_shapeClassEvent treats an ABC "Unbooked" slot as having no instructor', () => {
  // ABC represents an open class slot with the literal name "Unbooked Unbooked".
  // Observed live at Salem. It must never reach the public board.
  const e = _shapeClassEvent({
    ...RAW_EVENT, employeeFirstName: 'Unbooked', employeeLastName: 'Unbooked',
  })
  assert.strictEqual(e.instructor_name, null)
  assert.strictEqual(e.unbooked, true)
})

test('_shapeClassEvent marks a real instructor as booked', () => {
  assert.strictEqual(_shapeClassEvent(RAW_EVENT).unbooked, false)
})

test('_chunkDateRange keeps every window inside ABC 31-day cap', () => {
  // ABC rejects eventDateRange spans over 31 days with API-CAL-EVT-0017.
  const chunks = _chunkDateRange('2026-01-01', '2026-12-31')
  assert.ok(chunks.length > 1, 'a year must be split')
  for (const c of chunks) {
    const days = (new Date(c.end + 'T00:00:00Z') - new Date(c.start + 'T00:00:00Z')) / 86400000
    assert.ok(days < 31, `window ${c.start}..${c.end} spans ${days} days`)
  }
  assert.strictEqual(chunks[0].start, '2026-01-01')
  assert.strictEqual(chunks[chunks.length - 1].end, '2026-12-31')
})

test('_chunkDateRange leaves a short range as a single window', () => {
  assert.deepStrictEqual(_chunkDateRange('2026-07-27', '2026-08-02'), [
    { start: '2026-07-27', end: '2026-08-02' },
  ])
})

test('_chunkDateRange covers every day with no gaps', () => {
  const chunks = _chunkDateRange('2026-01-01', '2026-03-15')
  for (let i = 1; i < chunks.length; i++) {
    const prevEnd = new Date(chunks[i - 1].end + 'T00:00:00Z')
    const thisStart = new Date(chunks[i].start + 'T00:00:00Z')
    assert.strictEqual((thisStart - prevEnd) / 86400000, 1, 'windows must be contiguous')
  }
})

test('_assertAbcOk throws on an error hidden inside a 200 response', () => {
  // ABC returns HTTP 200 with the failure in the body. Reading that as an empty
  // list silently turns a failed read into an empty calendar.
  assert.throws(
    () => _assertAbcOk({
      status: { message: 'Invalid time range for parameter eventDateRange - more than 31 days. ', count: '0', messageCode: 'API-CAL-EVT-0017' },
    }, 'test'),
    /API-CAL-EVT-0017/,
  )
})

test('_assertAbcOk accepts the success code', () => {
  assert.doesNotThrow(() => _assertAbcOk({ status: { messageCode: 'API-CAL-EVT-0000', count: '5' } }, 'test'))
})

test('MAX_RANGE_DAYS leaves room for the plus-minus-one-day padding', () => {
  assert.ok(MAX_RANGE_DAYS + 2 <= 31)
})

test('EXCLUDED_NAMES covers the bot accounts ABC tags into real departments', () => {
  // Salem's roster returns "ABC SUPPORT" under Personal Trainers.
  assert.ok(EXCLUDED_NAMES.has('abc support'))
  assert.ok(EXCLUDED_NAMES.has('easalytics bot'))
  assert.ok(!EXCLUDED_NAMES.has('matthew astley'))
})

const test = require('node:test')
const assert = require('node:assert')
const {
  employeeDepartments, isPersonalTrainer, sumSessionSummaries,
  isAbcSuccess, extractEventId, EVENT_STATUSES,
} = require('./ptScheduler')

test('employeeDepartments reads the array shape ABC returns', () => {
  const emp = { employment: { departments: { department: ['Front Desk', 'Personal Trainers'] } } }
  assert.deepStrictEqual(employeeDepartments(emp), ['Front Desk', 'Personal Trainers'])
})

test('employeeDepartments returns [] for staff with no department set', () => {
  assert.deepStrictEqual(employeeDepartments({ employment: { departments: { department: [] } } }), [])
  assert.deepStrictEqual(employeeDepartments({ employment: {} }), [])
  assert.deepStrictEqual(employeeDepartments({}), [])
  assert.deepStrictEqual(employeeDepartments(null), [])
})

test('employeeDepartments tolerates a bare string', () => {
  const emp = { employment: { departments: { department: 'Personal Trainers' } } }
  assert.deepStrictEqual(employeeDepartments(emp), ['Personal Trainers'])
})

test('isPersonalTrainer matches when PT is one of several departments', () => {
  assert.ok(isPersonalTrainer({ employment: { departments: { department: ['Management', 'Personal Trainers'] } } }))
  assert.ok(isPersonalTrainer({ employment: { departments: { department: ['Personal Trainers'] } } }))
})

test('isPersonalTrainer is case- and whitespace-insensitive', () => {
  assert.ok(isPersonalTrainer({ employment: { departments: { department: ['  personal trainers '] } } }))
})

test('isPersonalTrainer rejects non-trainers', () => {
  assert.ok(!isPersonalTrainer({ employment: { departments: { department: ['Front Desk', 'Child Care'] } } }))
  assert.ok(!isPersonalTrainer({ employment: { departments: { department: [] } } }))
  // "Personal Trainers" is the ABC value; the singular must not match loosely.
  assert.ok(!isPersonalTrainer({ employment: { departments: { department: ['Personal Trainer'] } } }))
})

test('sumSessionSummaries totals across every billing lot', () => {
  const payload = {
    members: [{
      serviceSummaries: [
        { purchased: '8', available: '7', scheduled: '1' },
        { purchased: '8', available: '0', scheduled: '0' },
        { purchased: '5', available: '2', scheduled: '3' },
      ],
    }],
  }
  assert.deepStrictEqual(sumSessionSummaries(payload), { available: 9, scheduled: 4, purchased: 21 })
})

test('sumSessionSummaries handles the flat shape and missing data', () => {
  assert.deepStrictEqual(
    sumSessionSummaries({ serviceSummaries: [{ available: '3' }] }),
    { available: 3, scheduled: 0, purchased: 0 },
  )
  assert.deepStrictEqual(sumSessionSummaries({}), { available: 0, scheduled: 0, purchased: 0 })
  assert.deepStrictEqual(sumSessionSummaries(null), { available: 0, scheduled: 0, purchased: 0 })
})

test('sumSessionSummaries ignores non-numeric values rather than yielding NaN', () => {
  const r = sumSessionSummaries({ serviceSummaries: [{ available: 'Open' }, { available: '4' }] })
  assert.strictEqual(r.available, 4)
})

test('isAbcSuccess requires the messageCode, not just HTTP 200', () => {
  assert.ok(isAbcSuccess(200, { status: { messageCode: 'API-CAL-EVT-0000' } }))
  // The trap: ABC rejects with HTTP 200 + count 0.
  assert.ok(!isAbcSuccess(200, { status: { messageCode: 'API-CAL-EVT-0011', count: '0' } }))
  assert.ok(!isAbcSuccess(200, {}))
  assert.ok(!isAbcSuccess(500, { status: { messageCode: 'API-CAL-EVT-0000' } }))
})

test('extractEventId pulls the id out of the HATEOAS link', () => {
  const body = { result: { links: [{ rel: 'events', href: '/rest/30935/calendars/events/abc123' }] } }
  assert.strictEqual(extractEventId(body), 'abc123')
})

test('extractEventId returns null when there is no link', () => {
  assert.strictEqual(extractEventId({}), null)
  assert.strictEqual(extractEventId({ result: { links: null } }), null)
  assert.strictEqual(extractEventId(null), null)
})

test('EVENT_STATUSES are the exact ABC strings', () => {
  assert.deepStrictEqual(EVENT_STATUSES, ['Completed', 'Pending', 'Canceled-Charge', 'Canceled-No Charge'])
})

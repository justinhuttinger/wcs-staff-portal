const test = require('node:test')
const assert = require('node:assert')
const { applyClassEdit } = require('./applyClassEdit')

// Fakes record call order in one shared array so ordering assertions read
// naturally, and each accepts a canned result so a test can drive it.
function fakes({ createResult, cancelResult, movedResult } = {}) {
  const calls = []
  return {
    calls,
    createClass: async (club, body) => {
      calls.push(['create', club, body])
      return createResult ?? { ok: true, event_id: 'new-1' }
    },
    cancelClass: async (club, eventId) => {
      calls.push(['cancel', club, eventId])
      return cancelResult ?? { ok: true }
    },
    moveRefs: async (club, oldId, newId, date, className) => {
      calls.push(['moveRefs', club, oldId, newId, date, className])
      return movedResult ?? { badge_error: null, link_error: null, attendance_error: null }
    },
  }
}

const baseParams = {
  clubNumber: '7655',
  oldEventId: 'old-1',
  eventTypeId: 'et-1',
  employeeId: 'emp-1',
  eventTimestampLocal: '2026-09-10 06:00:00',
  trainingLevelId: null,
  date: '2026-09-10',
  className: 'Yoga',
  isPast: false,
}

test('past classes never reach ABC: neither create nor cancel is called', async () => {
  const f = fakes()
  const result = await applyClassEdit(f, { ...baseParams, isPast: true })
  assert.deepStrictEqual(result, { kind: 'past' })
  assert.deepStrictEqual(f.calls, [])
})

test('create runs before cancel', async () => {
  const f = fakes()
  await applyClassEdit(f, baseParams)
  const kinds = f.calls.map(c => c[0])
  assert.deepStrictEqual(kinds, ['create', 'cancel', 'moveRefs'])
})

test('when create fails, cancel is never called and the original class is reported untouched', async () => {
  const f = fakes({ createResult: { ok: false, error: 'API-CAL-EVT-1 bad slot', http: 400 } })
  const result = await applyClassEdit(f, baseParams)
  assert.deepStrictEqual(result, { kind: 'create_failed', error: 'API-CAL-EVT-1 bad slot', http: 400 })
  assert.deepStrictEqual(f.calls.map(c => c[0]), ['create'])
})

test('when create succeeds and cancel fails, the result carries the new id and needs-manual-cleanup', async () => {
  const f = fakes({ cancelResult: { ok: false, error: 'ABC said no', http: 500 } })
  const result = await applyClassEdit(f, baseParams)
  assert.strictEqual(result.kind, 'cancel_failed')
  assert.strictEqual(result.eventId, 'new-1')
  assert.strictEqual(result.error, 'ABC said no')
  assert.strictEqual(result.http, 500)
  // moveRefs must not run against a class whose old copy is still live in ABC.
  assert.deepStrictEqual(f.calls.map(c => c[0]), ['create', 'cancel'])
})

test('when both succeed, moveRefs is called with the old and new ids in that order', async () => {
  const f = fakes()
  await applyClassEdit(f, baseParams)
  const moveCall = f.calls.find(c => c[0] === 'moveRefs')
  assert.deepStrictEqual(moveCall, ['moveRefs', '7655', 'old-1', 'new-1', '2026-09-10', 'Yoga'])
})

test('a moveRefs failure does not fail the edit', async () => {
  const f = fakes({ movedResult: { badge_error: 'boom', link_error: null, attendance_error: null } })
  const result = await applyClassEdit(f, baseParams)
  assert.strictEqual(result.kind, 'ok')
  assert.strictEqual(result.eventId, 'new-1')
  assert.deepStrictEqual(result.moved, { badge_error: 'boom', link_error: null, attendance_error: null })
})

test('create is called with the built timestamp and a null training level when omitted', async () => {
  const f = fakes()
  await applyClassEdit(f, { ...baseParams, trainingLevelId: undefined })
  const createCall = f.calls.find(c => c[0] === 'create')
  assert.deepStrictEqual(createCall[2], {
    event_type_id: 'et-1',
    employee_id: 'emp-1',
    event_timestamp_local: '2026-09-10 06:00:00',
    training_level_id: null,
  })
})

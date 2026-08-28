const test = require('node:test')
const assert = require('node:assert')
const { validateTourCompletion, toRow } = require('./tourCompletion')

const OUTCOMES = new Set(['joined', 'no_sale', 'thinking', 'not_a_fit', 'no_show', 'rescheduled'])

const good = (over = {}) => ({
  ghlContactId: 'ghl-123',
  abcMemberId: '4455',
  clubNumber: '30935',
  outcome: 'joined',
  givenByEmployeeId: 'emp-1',
  givenByName: 'Jane  Doe',
  completedAt: '2026-08-28T18:00:00.000Z',
  ...over,
})

test('a complete payload validates and normalises', () => {
  const { ok, value } = validateTourCompletion(good(), OUTCOMES)
  assert.equal(ok, true)
  // Whitespace collapsed, so "Jane  Doe" and "Jane Doe" are one person.
  assert.equal(value.givenByName, 'Jane Doe')
  assert.equal(value.clubNumber, '30935')
})

test('every problem is reported at once, not one per round trip', () => {
  const { ok, errors } = validateTourCompletion(
    { clubNumber: '99999', outcome: 'sold_it' }, OUTCOMES
  )
  assert.equal(ok, false)
  // Identity, club, and outcome are all wrong; all three come back together.
  assert.ok(errors.length >= 3, errors.join(' | '))
  assert.ok(errors.some(e => e.includes('tourIntakeId')))
  assert.ok(errors.some(e => e.includes('clubNumber')))
  assert.ok(errors.some(e => e.includes('outcome')))
})

test('an unknown outcome is rejected with the allowed list', () => {
  const { ok, errors } = validateTourCompletion(good({ outcome: 'maybe' }), OUTCOMES)
  assert.equal(ok, false)
  // The caller must be told what IS allowed, or they guess again.
  assert.ok(errors.some(e => e.includes('joined') && e.includes('no_sale')))
})

test('a tour must be attachable to somebody', () => {
  const { ok, errors } = validateTourCompletion(
    good({ ghlContactId: null, abcMemberId: null, tourIntakeId: null }), OUTCOMES
  )
  assert.equal(ok, false)
  assert.ok(errors.some(e => e.includes('tourIntakeId')))
  // Any ONE identifier is enough.
  assert.equal(validateTourCompletion(good({ ghlContactId: null, abcMemberId: '77' }), OUTCOMES).ok, true)
})

test('who gave the tour is required, by id or by name', () => {
  const { ok } = validateTourCompletion(
    good({ givenByEmployeeId: null, givenByName: null }), OUTCOMES
  )
  assert.equal(ok, false)
  assert.equal(validateTourCompletion(good({ givenByEmployeeId: null }), OUTCOMES).ok, true)
  assert.equal(validateTourCompletion(good({ givenByName: null }), OUTCOMES).ok, true)
})

test('a club outside the estate is refused', () => {
  assert.equal(validateTourCompletion(good({ clubNumber: '12345' }), OUTCOMES).ok, false)
  assert.equal(validateTourCompletion(good({ clubNumber: '32073' }), OUTCOMES).ok, true)
})

test('completedAt defaults, and a bad one is refused rather than silently now()', () => {
  const { value } = validateTourCompletion(good({ completedAt: null }), OUTCOMES)
  assert.ok(Date.parse(value.completedAt) > 0)
  // Silently substituting now() for garbage would file the tour on the wrong day.
  assert.equal(validateTourCompletion(good({ completedAt: 'yesterday' }), OUTCOMES).ok, false)
})

test('empty strings count as missing, not as values', () => {
  const { ok, errors } = validateTourCompletion(
    good({ outcome: '   ', givenByEmployeeId: '', givenByName: '  ' }), OUTCOMES
  )
  assert.equal(ok, false)
  assert.ok(errors.some(e => e.includes('outcome is required')))
})

test('the row keeps who GAVE the tour apart from who recorded it', () => {
  const { value } = validateTourCompletion(good(), OUTCOMES)
  const row = toRow(value, { staffId: 'staff-uuid-of-a-manager' })
  // A manager closing out a colleague's tour must not take the credit.
  assert.equal(row.given_by_employee_id, 'emp-1')
  assert.equal(row.completed_by, 'staff-uuid-of-a-manager')
  assert.equal(row.status, 'completed')
})

test('a row with no staff session still records the tour', () => {
  const { value } = validateTourCompletion(good(), OUTCOMES)
  assert.equal(toRow(value).completed_by, null)
  assert.equal(toRow(value).given_by_name, 'Jane Doe')
})

const test = require('node:test')
const assert = require('node:assert')
const { validateTourCompletion, toRow } = require('./tourCompletion')

// The five the front desk actually uses. They answer "what did this person
// leave with", and three of them carry a day count that writes real access into
// ABC -- which is why they were kept over a sales vocabulary that carries none.
const OUTCOMES = new Set([
  'Membership Sale', 'Started Trial', 'Started VIP Pass', 'Only Tour', 'Custom Pass',
])
const GRANTS = new Set(['Started Trial', 'Started VIP Pass', 'Custom Pass'])

const good = (over = {}) => ({
  ghlContactId: 'ghl-123',
  abcMemberId: '4455',
  clubNumber: '30935',
  outcome: 'Membership Sale',
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
  assert.ok(errors.some(e => e.includes('Membership Sale') && e.includes('Only Tour')))
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

// ---------------------------------------------------------------------------
// Pass length.
//
// Three of the five outcomes hand out gym access, and Custom Pass is the one
// whose length nothing else records: a 30-day pass and a 3-day pass are the
// same outcome and very different things to have given away.
// ---------------------------------------------------------------------------

const base = {
  clubNumber: '30935',
  givenByName: 'Jane Doe',
  abcMemberId: '4455',
}

test('a custom pass records the length it granted', () => {
  const r = validateTourCompletion(
    { ...base, outcome: 'Custom Pass', passDays: 30 }, OUTCOMES, GRANTS)
  assert.equal(r.ok, true)
  assert.equal(r.value.passDays, 30)
  assert.equal(toRow(r.value).pass_days, 30)
})

test('a custom pass with no length is rejected, not silently recorded as null', () => {
  const r = validateTourCompletion(
    { ...base, outcome: 'Custom Pass' }, OUTCOMES, GRANTS)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some(e => /passDays is required/.test(e)))
})

test('trial and VIP carry their length too', () => {
  for (const [outcome, days] of [['Started Trial', 7], ['Started VIP Pass', 14]]) {
    const r = validateTourCompletion({ ...base, outcome, passDays: days }, OUTCOMES, GRANTS)
    assert.equal(r.ok, true, `${outcome} should validate`)
    assert.equal(r.value.passDays, days)
  }
})

test('an outcome that grants nothing must not carry a length', () => {
  const r = validateTourCompletion(
    { ...base, outcome: 'Only Tour', passDays: 10 }, OUTCOMES, GRANTS)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some(e => /grants no access/.test(e)))
})

test('an outcome that grants nothing validates without one', () => {
  for (const outcome of ['Only Tour', 'Membership Sale']) {
    const r = validateTourCompletion({ ...base, outcome }, OUTCOMES, GRANTS)
    assert.equal(r.ok, true, `${outcome} should validate`)
    assert.equal(r.value.passDays, null)
    assert.equal(toRow(r.value).pass_days, null)
  }
})

test('rejects a fat-fingered length rather than writing it to ABC', () => {
  for (const bad of [0, 91, -1, 7.5, 'ten']) {
    const r = validateTourCompletion(
      { ...base, outcome: 'Custom Pass', passDays: bad }, OUTCOMES, GRANTS)
    assert.equal(r.ok, false, `${bad} should be rejected`)
    assert.ok(r.errors.some(e => /between 1 and 90/.test(e)))
  }
})

test('a sales disposition is no longer an outcome', () => {
  // 147 seeded joined / no_sale / thinking. Nothing ever recorded one, and the
  // check-in never offered them.
  const r = validateTourCompletion({ ...base, outcome: 'joined' }, OUTCOMES, GRANTS)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some(e => e.includes('Started VIP Pass')))
})
